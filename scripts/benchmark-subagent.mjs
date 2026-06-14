#!/usr/bin/env node
/**
 * benchmark-subagent.mjs — Subagent Benchmark Harness
 *
 * Spawns `pi` in JSON mode to run benchmark cases, parses JSON events
 * to collect root usage and child subagent usage separately, aggregates
 * results across multiple runs, writes a JSON report, and prints a concise
 * human-readable summary to stdout.
 *
 * Usage:
 *   node scripts/benchmark-subagent.mjs [--cases <path>] [--case <id>]
 *     [--runs <n>] [--model <provider/model>] [--output <path>]
 *     [--cwd <path>] [--approve|--no-approve] [--verbose]
 *
 * Or via npm:
 *   npm run bench:subagent -- --model provider/model
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} UsageStats
 * @property {number} input
 * @property {number} output
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} cost
 * @property {number} turns
 * @property {number} contextTokens
 */

/**
 * @typedef {Object} RunMetrics
 * @property {UsageStats} root
 * @property {UsageStats} child
 * @property {UsageStats} combined
 * @property {number} elapsedMs
 * @property {Object<string,number>} toolCalls
 * @property {boolean} subagentUsed
 * @property {string[]} spawnModes
 * @property {string} stderr
 * @property {number} exitCode
 * @property {boolean} success
 * @property {Object} [validation]
 */

/**
 * @typedef {Object} BenchmarkCase
 * @property {string} id
 * @property {string} [description]
 * @property {string} prompt
 * @property {string} [cwd]
 * @property {string[]} [tools]
 * @property {boolean} [expectSubagent]
 * @property {string[]} [expectedToolNames]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} CaseFile
 * @property {number} version
 * @property {Object} defaults
 * @property {BenchmarkCase[]} cases
 */

/**
 * @typedef {Object} ParsedArgs
 * @property {string} casesPath
 * @property {string[]} caseFilter
 * @property {number} runs
 * @property {string} [model]
 * @property {string} [outputPath]
 * @property {string} cwd
 * @property {boolean} approve
 * @property {boolean} verbose
 */

// ─── Zero Usage ─────────────────────────────────────────────────────────

function zeroUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, contextTokens: 0 };
}

// ─── CLI Parser ─────────────────────────────────────────────────────────

/**
 * Parse CLI arguments into a structured options object.
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  const args = {
    casesPath: path.resolve("benchmarks/subagent-cases.json"),
    caseFilter: /** @type {string[]} */ ([]),
    runs: 1,
    model: undefined,
    outputPath: undefined,
    cwd: process.cwd(),
    approve: true,
    verbose: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--cases":
        args.casesPath = path.resolve(argv[++i]);
        break;
      case "--case": {
        const raw = argv[++i] || "";
        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
        args.caseFilter.push(...ids);
        break;
      }
      case "--runs": {
        const val = parseInt(argv[++i], 10);
        args.runs = Number.isFinite(val) && val > 0 ? val : 1;
        break;
      }
      case "--model":
        args.model = argv[++i];
        break;
      case "--output":
        args.outputPath = argv[++i];
        break;
      case "--cwd":
        args.cwd = path.resolve(argv[++i]);
        break;
      case "--approve":
        args.approve = true;
        break;
      case "--no-approve":
        args.approve = false;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        // Ignore unknown args passed through from npm
        break;
    }
    i++;
  }

  return args;
}

function printHelp() {
  console.log(`Subagent Benchmark Harness

Usage: node scripts/benchmark-subagent.mjs [options]

Options:
  --cases <path>      Path to cases JSON file (default: benchmarks/subagent-cases.json)
  --case <id>         Run only specific case(s), comma-separated (repeatable)
  --runs <n>          Number of runs per case (default: 1)
  --model <p/m>       Model override as provider/modelId (e.g. opencode-go/deepseek-v4-flash)
  --output <path>     Write JSON report to this path (auto-generates if omitted)
  --cwd <path>        Working directory for spawned pi (default: process.cwd())
  --approve           Auto-approve tool calls (default)
  --no-approve        Require manual approval (interactive)
  --verbose           Print per-run details
  --help              Show this help`);
}

// ─── Case File Reader ───────────────────────────────────────────────────

/**
 * Read and parse the benchmark case file.
 * @param {string} filePath
 * @returns {CaseFile}
 */
export function readCases(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!parsed.version) {
    throw new Error(`Case file missing "version" field: ${filePath}`);
  }
  if (!parsed.cases || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`Case file missing "cases" array: ${filePath}`);
  }

  return parsed;
}

/**
 * Apply defaults to a case and resolve relative paths.
 * @param {BenchmarkCase} caseDef
 * @param {Object} defaults
 * @param {string} fileDir - directory of the case file for resolving paths
 * @returns {BenchmarkCase}
 */
export function resolveCase(caseDef, defaults, fileDir) {
  const resolved = { ...caseDef };
  const cwdValue = resolved.cwd ?? defaults.cwd;
  if (cwdValue) {
    resolved.cwd = path.isAbsolute(cwdValue) ? cwdValue : path.resolve(fileDir, cwdValue);
  }
  if (!resolved.tools && defaults.tools) {
    resolved.tools = defaults.tools;
  }
  return resolved;
}

// ─── Pi Invocation ──────────────────────────────────────────────────────

/**
 * Determine how to invoke pi for benchmarks.
 *
 * Benchmarks are expected to run against a real `pi` binary on PATH.
 * Override with PI_BENCHMARK_PI if needed.
 *
 * @param {string[]} args
 * @returns {{ command: string, args: string[] }}
 */
function getPiInvocation(args) {
  const command = process.env.PI_BENCHMARK_PI || "pi";
  return { command, args };
}

// ─── Event Parsing ──────────────────────────────────────────────────────

/**
 * Parse a single raw event object from pi's JSON output.
 * Extracts usage from message_end (assistant) and tool_execution_end (subagent).
 *
 * @param {any} event - parsed JSON event object
 * @param {Object} collector - mutable collector for this run
 */
export function processEvent(event, collector) {
  if (!event || typeof event !== "object") return;

  // Root assistant message_end — aggregate usage
  if (event.type === "message_end" && event.message) {
    const msg = event.message;
    if (msg.role === "assistant") {
      collector.root.turns++;
      if (msg.usage) {
        collector.root.input += msg.usage.input || 0;
        collector.root.output += msg.usage.output || 0;
        collector.root.cacheRead += msg.usage.cacheRead || 0;
        collector.root.cacheWrite += msg.usage.cacheWrite || 0;
        collector.root.cost += msg.usage.cost?.total || 0;
      }
      if (msg.usage?.totalTokens) {
        collector.root.contextTokens = Math.max(collector.root.contextTokens, msg.usage.totalTokens);
      }
    }
  }

  // Tool execution start — track tool name
  if (event.type === "tool_execution_start" && event.toolName) {
    collector.toolCalls[event.toolName] = (collector.toolCalls[event.toolName] || 0) + 1;
  }

  // Tool execution end — extract subagent usage
  if (event.type === "tool_execution_end" && event.toolName === "subagent" && event.result) {
    const details = event.result.details;
    if (details && details.results) {
      for (const r of details.results) {
        collector.child.turns += r.usage?.turns || 0;
        collector.child.input += r.usage?.input || 0;
        collector.child.output += r.usage?.output || 0;
        collector.child.cacheRead += r.usage?.cacheRead || 0;
        collector.child.cacheWrite += r.usage?.cacheWrite || 0;
        collector.child.cost += r.usage?.cost || 0;
        collector.child.contextTokens = Math.max(collector.child.contextTokens, r.usage?.contextTokens || 0);
        if (r.spawnMode) {
          collector.spawnModes.push(r.spawnMode);
        }
      }
      collector.subagentUsed = true;
    }
  }
}

/**
 * Compute combined totals from root and child usage.
 * @param {UsageStats} root
 * @param {UsageStats} child
 * @returns {UsageStats}
 */
export function combineUsage(root, child) {
  return {
    input: root.input + child.input,
    output: root.output + child.output,
    cacheRead: root.cacheRead + child.cacheRead,
    cacheWrite: root.cacheWrite + child.cacheWrite,
    cost: root.cost + child.cost,
    turns: root.turns + child.turns,
    contextTokens: Math.max(root.contextTokens, child.contextTokens),
  };
}

// ─── Case Runner ────────────────────────────────────────────────────────

/**
 * Run a single benchmark case by spawning `pi` in JSON mode.
 *
 * @param {BenchmarkCase} caseDef - resolved case definition
 * @param {string} [model] - optional model override
 * @param {string} cwd - working directory for spawned pi
 * @param {boolean} approve - whether to auto-approve tool calls
 * @returns {Promise<RunMetrics>}
 */
export function runCase(caseDef, model, cwd, approve) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const collector = {
      root: zeroUsage(),
      child: zeroUsage(),
      combined: zeroUsage(),
      toolCalls: /** @type {Object<string,number>} */ ({}),
      subagentUsed: false,
      spawnModes: /** @type {string[]} */ ([]),
      stderr: "",
      exitCode: -1,
      success: false,
    };

    const args = ["--mode", "json", "-p", "--no-session"];

    if (model) {
      args.push("--model", model);
    }
    if (approve) {
      args.push("--approve");
    }
    if (caseDef.tools && caseDef.tools.length > 0) {
      args.push("--tools", caseDef.tools.join(","));
    }

    args.push(caseDef.prompt);

    const invocation = getPiInvocation(args);
    const workDir = caseDef.cwd ? path.resolve(cwd, caseDef.cwd) : cwd;

    const proc = spawn(invocation.command, invocation.args, {
      cwd: workDir,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let buffer = "";

    const processLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return; // Skip malformed lines
      }
      processEvent(event, collector);
    };

    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data) => {
      collector.stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);

      collector.exitCode = code ?? -1;
      collector.success = code === 0;
      collector.elapsedMs = Date.now() - startTime;
      collector.combined = combineUsage(collector.root, collector.child);

      // Validation
      const validation = validateRun(caseDef, collector);
      if (Object.keys(validation).length > 0) {
        collector.validation = validation;
      }

      resolve(collector);
    });

    proc.on("error", (err) => {
      collector.stderr += err.message;
      collector.exitCode = 1;
      collector.elapsedMs = Date.now() - startTime;
      collector.combined = combineUsage(collector.root, collector.child);
      resolve(collector);
    });
  });
}

/**
 * Validate a run against case expectations.
 * @param {BenchmarkCase} caseDef
 * @param {Object} collector
 * @returns {Object} validation results with warnings/failures
 */
export function validateRun(caseDef, collector) {
  /** @type {Object} */
  const validation = {};

  if (caseDef.expectSubagent === true && !collector.subagentUsed) {
    validation.subagentMissing = "Expected subagent to be used but none was detected";
  }
  if (caseDef.expectSubagent === false && collector.subagentUsed) {
    validation.subagentUnexpected = "Subagent was used unexpectedly";
  }
  if (caseDef.expectedToolNames && caseDef.expectedToolNames.length > 0) {
    const used = new Set(Object.keys(collector.toolCalls));
    const missing = caseDef.expectedToolNames.filter((t) => !used.has(t));
    if (missing.length > 0) {
      validation.toolsMissing = `Expected tools not used: ${missing.join(", ")}`;
    }
  }

  return validation;
}

// ─── Aggregation ────────────────────────────────────────────────────────

/**
 * Compute mean of numeric fields across metric objects.
 * @param {UsageStats[]} metrics
 * @returns {UsageStats}
 */
export function computeMean(metrics) {
  if (metrics.length === 0) return zeroUsage();
  const keys = ["input", "output", "cacheRead", "cacheWrite", "cost", "turns", "contextTokens"];
  const result = zeroUsage();
  for (const key of keys) {
    result[key] = metrics.reduce((sum, m) => sum + (m[key] || 0), 0) / metrics.length;
  }
  return result;
}

/**
 * Compute min of numeric fields across metric objects.
 * @param {UsageStats[]} metrics
 * @returns {UsageStats}
 */
export function computeMin(metrics) {
  if (metrics.length === 0) return zeroUsage();
  const keys = ["input", "output", "cacheRead", "cacheWrite", "cost", "turns", "contextTokens"];
  const result = { ...metrics[0] };
  for (const key of keys) {
    for (const m of metrics) {
      result[key] = Math.min(result[key], m[key] || 0);
    }
  }
  return result;
}

/**
 * Compute max of numeric fields across metric objects.
 * @param {UsageStats[]} metrics
 * @returns {UsageStats}
 */
export function computeMax(metrics) {
  if (metrics.length === 0) return zeroUsage();
  const keys = ["input", "output", "cacheRead", "cacheWrite", "cost", "turns", "contextTokens"];
  const result = { ...metrics[0] };
  for (const key of keys) {
    for (const m of metrics) {
      result[key] = Math.max(result[key], m[key] || 0);
    }
  }
  return result;
}

/**
 * Compute mean of elapsed times.
 * @param {number[]} times
 * @returns {number}
 */
export function computeMeanElapsed(times) {
  if (times.length === 0) return 0;
  return times.reduce((sum, t) => sum + t, 0) / times.length;
}

// ─── Report Writing ─────────────────────────────────────────────────────

/**
 * Sanitize usage stats for serialization (round floats to 6 decimals).
 * @param {UsageStats} usage
 * @returns {UsageStats}
 */
function sanitizeUsage(usage) {
  const round = (v) => typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v;
  return {
    input: round(usage.input),
    output: round(usage.output),
    cacheRead: round(usage.cacheRead),
    cacheWrite: round(usage.cacheWrite),
    cost: round(usage.cost),
    turns: usage.turns,
    contextTokens: usage.contextTokens,
  };
}

/**
 * Build and write the JSON report.
 * @param {Object} options
 * @param {BenchmarkCase[]} cases
 * @param {RunMetrics[][]} allRuns - array of run arrays per case (parallel to cases)
 * @param {ParsedArgs} cliArgs
 * @returns {string} report path
 */
export function writeReport(cases, allRuns, cliArgs) {
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: cliArgs.model || "(default)",
    runsPerCase: cliArgs.runs,
    cwd: cliArgs.cwd,
    cases: cases.map((c, idx) => {
      const runs = allRuns[idx];
      const rootUsages = runs.map((r) => r.root);
      const childUsages = runs.map((r) => r.child);
      const combinedUsages = runs.map((r) => r.combined);
      const elapsedTimes = runs.map((r) => r.elapsedMs);

      return {
        id: c.id,
        description: c.description || "",
        tags: c.tags || [],
        runs: runs.map((r) => ({
          elapsedMs: r.elapsedMs,
          exitCode: r.exitCode,
          success: r.success,
          subagentUsed: r.subagentUsed,
          spawnModes: r.spawnModes,
          toolCalls: r.toolCalls,
          root: sanitizeUsage(r.root),
          child: sanitizeUsage(r.child),
          combined: sanitizeUsage(r.combined),
          stderr: r.stderr ? r.stderr.trim().slice(-2000) : undefined,
          validation: r.validation,
        })),
        aggregate: {
          mean: {
            elapsedMs: computeMeanElapsed(elapsedTimes),
            root: sanitizeUsage(computeMean(rootUsages)),
            child: sanitizeUsage(computeMean(childUsages)),
            combined: sanitizeUsage(computeMean(combinedUsages)),
          },
          min: {
            elapsedMs: Math.min(...elapsedTimes),
            root: sanitizeUsage(computeMin(rootUsages)),
            child: sanitizeUsage(computeMin(childUsages)),
            combined: sanitizeUsage(computeMin(combinedUsages)),
          },
          max: {
            elapsedMs: Math.max(...elapsedTimes),
            root: sanitizeUsage(computeMax(rootUsages)),
            child: sanitizeUsage(computeMax(childUsages)),
            combined: sanitizeUsage(computeMax(combinedUsages)),
          },
        },
      };
    }),
  };

  let outputPath = cliArgs.outputPath;
  if (!outputPath) {
    const resultsDir = path.resolve("benchmarks/results");
    fs.mkdirSync(resultsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    outputPath = path.join(resultsDir, `benchmark-${ts}.json`);
  }

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  return outputPath;
}

// ─── Summary Printer ────────────────────────────────────────────────────

/**
 * Format a number for display.
 * @param {number} n
 * @param {number} [decimals=1]
 * @returns {string}
 */
function fmt(n, decimals = 1) {
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

/**
 * Print a concise human-readable summary table.
 * @param {Object} report - the full report object
 */
export function printSummary(report) {
  const cases = report.cases;

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Subagent Benchmark Summary");
  console.log(`  Model: ${report.model}  |  Runs per case: ${report.runsPerCase}`);
  console.log(`  Generated: ${report.generatedAt}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  // Table header
  const pad = (s, n) => String(s).padEnd(n);
  const hdr =
    pad("Case", 28) +
    pad("OK", 4) +
    pad("Elapsed", 10) +
    pad("R-In", 8) +
    pad("R-Out", 8) +
    pad("R-Cost$", 10) +
    pad("C-In", 8) +
    pad("C-Out", 8) +
    pad("C-Cost$", 10) +
    pad("T-In", 8) +
    pad("T-Out", 8) +
    pad("T-Cost$", 10);
  console.log(hdr);
  console.log("─".repeat(hdr.length));

  // Table rows
  for (const c of cases) {
    const agg = c.aggregate.mean;
    const successAll = c.runs.filter((r) => r.success).length;
    const elapsed = `${agg.elapsedMs.toFixed(0)}ms`.padEnd(10);

    const row =
      pad(c.id, 28) +
      pad(`${successAll}/${c.runs.length}`, 4) +
      elapsed +
      pad(fmt(agg.root.input), 8) +
      pad(fmt(agg.root.output), 8) +
      pad(`$${agg.root.cost.toFixed(4)}`, 10) +
      pad(fmt(agg.child.input), 8) +
      pad(fmt(agg.child.output), 8) +
      pad(`$${agg.child.cost.toFixed(4)}`, 10) +
      pad(fmt(agg.combined.input), 8) +
      pad(fmt(agg.combined.output), 8) +
      pad(`$${agg.combined.cost.toFixed(4)}`, 10);
    console.log(row);
  }

  // Column legend
  console.log("\n  Columns: R=Root agent  C=Child subagent(s)  T=Combined total");
  console.log("  In=Input tokens  Out=Output tokens  Cost$=Cost in USD\n");

  // Validation warnings
  let hasWarnings = false;
  for (const c of cases) {
    for (const r of c.runs) {
      if (r.validation && Object.keys(r.validation).length > 0) {
        if (!hasWarnings) {
          console.log("  Validation Warnings:");
          console.log("  ───────────────────");
          hasWarnings = true;
        }
        console.log(`  [${c.id}] run (${r.elapsedMs}ms):`);
        for (const [key, val] of Object.entries(r.validation)) {
          console.log(`    - ${key}: ${val}`);
        }
      }
    }
  }

  // Deltas for the three default cases
  const hasDirect = cases.find((c) => c.id === "direct-explore");
  const hasFull = cases.find((c) => c.id === "subagent-explore-full");
  const hasLean = cases.find((c) => c.id === "subagent-explore-lean");

  if (hasDirect && hasFull && hasLean) {
    console.log("\n  Cost Deltas (mean combined cost):");
    console.log("  ─────────────────────────────────");

    const directCost = hasDirect.aggregate.mean.combined.cost;
    const fullCost = hasFull.aggregate.mean.combined.cost;
    const leanCost = hasLean.aggregate.mean.combined.cost;

    if (directCost > 0) {
      console.log(`  full vs direct:  +${(((fullCost - directCost) / directCost) * 100).toFixed(1)}%  ($${fullCost.toFixed(4)} vs $${directCost.toFixed(4)})`);
      console.log(`  lean vs direct:  +${(((leanCost - directCost) / directCost) * 100).toFixed(1)}%  ($${leanCost.toFixed(4)} vs $${directCost.toFixed(4)})`);
    }
    if (fullCost > 0) {
      console.log(`  lean vs full:    ${(((leanCost - fullCost) / fullCost) * 100).toFixed(1)}%  ($${leanCost.toFixed(4)} vs $${fullCost.toFixed(4)})`);
    }
  }

}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  // Read case file
  let caseFile;
  try {
    caseFile = readCases(cliArgs.casesPath);
  } catch (err) {
    console.error(`Error reading cases file: ${err.message}`);
    process.exit(1);
  }

  const fileDir = path.dirname(cliArgs.casesPath);
  const defaults = caseFile.defaults || {};

  // Filter cases
  let selectedCases = caseFile.cases;
  const filterIds = cliArgs.caseFilter;

  if (filterIds.length > 0) {
    selectedCases = selectedCases.filter((c) => filterIds.includes(c.id));
    if (selectedCases.length === 0) {
      console.error(`No cases match --case filter: ${filterIds.join(", ")}`);
      console.error(`Available: ${caseFile.cases.map((c) => c.id).join(", ")}`);
      process.exit(1);
    }
  }

  // Resolve cases
  const cases = selectedCases.map((c) => resolveCase(c, defaults, fileDir));

  console.log(`Running ${cases.length} case(s) × ${cliArgs.runs} run(s) each...`);
  if (cliArgs.model) console.log(`Model: ${cliArgs.model}`);
  console.log(`CWD: ${cliArgs.cwd}\n`);

  // Run all cases
  /** @type {RunMetrics[][]} */
  const allRuns = [];
  for (const c of cases) {
    if (cliArgs.verbose) {
      console.log(`\n── ${c.id} ──`);
      console.log(`  ${c.description || "(no description)"}`);
    }

    const caseRuns = [];
    for (let run = 0; run < cliArgs.runs; run++) {
      if (cliArgs.verbose) {
        process.stdout.write(`  Run ${run + 1}/${cliArgs.runs}... `);
      }
      const metrics = await runCase(c, cliArgs.model, cliArgs.cwd, cliArgs.approve);
      caseRuns.push(metrics);

      if (cliArgs.verbose) {
        const status = metrics.success ? "OK" : "FAIL";
        const subagent = metrics.subagentUsed ? " [subagent]" : "";
        console.log(`${status} ${metrics.elapsedMs}ms${subagent}`);
      }
    }
    allRuns.push(caseRuns);
  }

  // Build and write report
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: cliArgs.model || "(default)",
    runsPerCase: cliArgs.runs,
    cwd: cliArgs.cwd,
    cases: cases.map((c, idx) => {
      const runs = allRuns[idx];
      const rootUsages = runs.map((r) => r.root);
      const childUsages = runs.map((r) => r.child);
      const combinedUsages = runs.map((r) => r.combined);
      const elapsedTimes = runs.map((r) => r.elapsedMs);

      return {
        id: c.id,
        description: c.description || "",
        tags: c.tags || [],
        runs: runs.map((r) => ({
          elapsedMs: r.elapsedMs,
          exitCode: r.exitCode,
          success: r.success,
          subagentUsed: r.subagentUsed,
          spawnModes: r.spawnModes,
          toolCalls: r.toolCalls,
          root: sanitizeUsage(r.root),
          child: sanitizeUsage(r.child),
          combined: sanitizeUsage(r.combined),
          stderr: r.stderr ? r.stderr.trim().slice(-2000) : undefined,
          validation: r.validation,
        })),
        aggregate: {
          mean: {
            elapsedMs: computeMeanElapsed(elapsedTimes),
            root: sanitizeUsage(computeMean(rootUsages)),
            child: sanitizeUsage(computeMean(childUsages)),
            combined: sanitizeUsage(computeMean(combinedUsages)),
          },
          min: {
            elapsedMs: Math.min(...elapsedTimes),
            root: sanitizeUsage(computeMin(rootUsages)),
            child: sanitizeUsage(computeMin(childUsages)),
            combined: sanitizeUsage(computeMin(combinedUsages)),
          },
          max: {
            elapsedMs: Math.max(...elapsedTimes),
            root: sanitizeUsage(computeMax(rootUsages)),
            child: sanitizeUsage(computeMax(childUsages)),
            combined: sanitizeUsage(computeMax(combinedUsages)),
          },
        },
      };
    }),
  };

  const reportPath = writeReport(cases, allRuns, cliArgs);
  printSummary(report);

  console.log(`\nReport written: ${reportPath}\n`);
}

// Run if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith("benchmark-subagent.mjs") ||
  process.argv[1].endsWith("benchmark-subagent")
);

if (isMain) {
  main().catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
