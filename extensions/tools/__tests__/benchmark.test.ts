// ─── benchmark.test.ts ────── Tests for benchmark harness logic ─────────
// Tests the parsing, aggregation, and validation functions of
// the subagent benchmark runner without requiring live API/model access.
import { describe, it, expect } from "vitest";

// Import the exported functions from the benchmark runner
// (vitest handles .mjs imports natively)
import {
  parseArgs,
  readCases,
  resolveCase,
  processEvent,
  combineUsage,
  validateRun,
  computeMean,
  computeMin,
  computeMax,
  computeMeanElapsed,
} from "../../../scripts/benchmark-subagent.mjs";

// ─── Helpers ───

function makeUsage(overrides = {}) {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
    contextTokens: 0,
    ...overrides,
  };
}

function makeCollector() {
  return {
    root: makeUsage(),
    child: makeUsage(),
    combined: makeUsage(),
    toolCalls: {},
    subagentUsed: false,
    spawnModes: [],
    stderr: "",
    exitCode: -1,
    success: false,
  };
}

// ─── parseArgs ───

describe("parseArgs", () => {
  it("returns defaults with no arguments", () => {
    const args = parseArgs([]);
    expect(args.runs).toBe(1);
    expect(args.approve).toBe(true);
    expect(args.verbose).toBe(false);
    expect(args.model).toBeUndefined();
    expect(args.caseFilter).toEqual([]);
  });

  it("parses --runs", () => {
    expect(parseArgs(["--runs", "5"]).runs).toBe(5);
    expect(parseArgs(["--runs", "abc"]).runs).toBe(1); // NaN → default
  });

  it("parses --model", () => {
    expect(parseArgs(["--model", "provider/model"]).model).toBe("provider/model");
  });

  it("parses --case (single)", () => {
    expect(parseArgs(["--case", "direct-explore"]).caseFilter).toEqual(["direct-explore"]);
  });

  it("parses --case (multiple invocations)", () => {
    const args = parseArgs(["--case", "direct-explore", "--case", "subagent-explore-lean"]);
    expect(args.caseFilter).toEqual(["direct-explore", "subagent-explore-lean"]);
  });

  it("parses --case comma-separated values", () => {
    const args = parseArgs(["--case", "direct-explore,subagent-explore-lean"]);
    expect(args.caseFilter).toEqual(["direct-explore", "subagent-explore-lean"]);
  });

  it("parses --verbose", () => {
    expect(parseArgs(["--verbose"]).verbose).toBe(true);
  });

  it("parses --approve / --no-approve", () => {
    expect(parseArgs(["--approve"]).approve).toBe(true);
    expect(parseArgs(["--no-approve"]).approve).toBe(false);
  });

  it("parses --output", () => {
    expect(parseArgs(["--output", "/tmp/report.json"]).outputPath).toBe("/tmp/report.json");
  });

  it("parses --cwd", () => {
    const args = parseArgs(["--cwd", "/some/dir"]);
    expect(args.cwd).toBe("/some/dir");
  });

  it("parses --cases", () => {
    const args = parseArgs(["--cases", "/tmp/cases.json"]);
    expect(args.casesPath).toBe("/tmp/cases.json");
  });

  it("--help exits with code 0", () => {
    // Mock process.exit to prevent actual exit
    const oldExit = process.exit;
    let exitCode = undefined;
    process.exit = (code) => { exitCode = code; throw new Error("exit"); };
    try {
      parseArgs(["--help"]);
    } catch (e) {
      // expected
    }
    process.exit = oldExit;
    expect(exitCode).toBe(0);
  });
});

// ─── readCases ───

describe("readCases", () => {
  it("parses a valid case file", () => {
    const tmpFile = "/tmp/test-bench-cases.json";
    const fs = require("node:fs");
    fs.writeFileSync(tmpFile, JSON.stringify({
      version: 1,
      defaults: { cwd: "/test" },
      cases: [{ id: "test", prompt: "Hello" }],
    }));
    try {
      const result = readCases(tmpFile);
      expect(result.version).toBe(1);
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0].id).toBe("test");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("throws on missing version", () => {
    const tmpFile = "/tmp/test-bench-cases-no-version.json";
    const fs = require("node:fs");
    fs.writeFileSync(tmpFile, JSON.stringify({ cases: [] }));
    try {
      expect(() => readCases(tmpFile)).toThrow("version");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("throws on missing cases array", () => {
    const tmpFile = "/tmp/test-bench-cases-no-cases.json";
    const fs = require("node:fs");
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1 }));
    try {
      expect(() => readCases(tmpFile)).toThrow("cases");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("throws on empty cases", () => {
    const tmpFile = "/tmp/test-bench-cases-empty.json";
    const fs = require("node:fs");
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, cases: [] }));
    try {
      expect(() => readCases(tmpFile)).toThrow("cases");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ─── resolveCase ───

describe("resolveCase", () => {
  it("applies defaults when fields are missing", () => {
    const resolved = resolveCase(
      { id: "test", prompt: "test" },
      { cwd: "/default/dir", tools: ["read", "bash"] },
      "/case/dir",
    );
    expect(resolved.cwd).toBe("/default/dir");
    expect(resolved.tools).toEqual(["read", "bash"]);
  });

  it("does not override explicit fields", () => {
    const resolved = resolveCase(
      { id: "test", prompt: "test", cwd: "/explicit", tools: ["find"] },
      { cwd: "/default/dir", tools: ["read", "bash"] },
      "/case/dir",
    );
    expect(resolved.cwd).toBe("/explicit");
    expect(resolved.tools).toEqual(["find"]);
  });

  it("resolves relative explicit cwd against fileDir", () => {
    const resolved = resolveCase(
      { id: "test", prompt: "test", cwd: "./relative/project" },
      { cwd: "/default/dir", tools: ["read", "bash"] },
      "/case/dir",
    );
    expect(resolved.cwd).toBe("/case/dir/relative/project");
  });

  it("resolves relative cwd from defaults against fileDir", () => {
    const resolved = resolveCase(
      { id: "test", prompt: "test" },
      { cwd: "./project" },
      "/home/user/cases",
    );
    expect(resolved.cwd).toBe("/home/user/cases/project");
  });
});

// ─── processEvent ───

describe("processEvent", () => {
  it("ignores null/undefined events", () => {
    const collector = makeCollector();
    processEvent(null, collector);
    processEvent(undefined, collector);
    expect(collector.root.turns).toBe(0);
  });

  it("parses root usage from assistant message_end", () => {
    const collector = makeCollector();
    processEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 200,
          cacheRead: 50,
          cacheWrite: 25,
          cost: { total: 0.001 },
          totalTokens: 500,
        },
      },
    }, collector);

    expect(collector.root.input).toBe(100);
    expect(collector.root.output).toBe(200);
    expect(collector.root.cacheRead).toBe(50);
    expect(collector.root.cacheWrite).toBe(25);
    expect(collector.root.cost).toBe(0.001);
    expect(collector.root.turns).toBe(1);
    expect(collector.root.contextTokens).toBe(500);
  });

  it("ignores non-assistant message_end", () => {
    const collector = makeCollector();
    processEvent({
      type: "message_end",
      message: {
        role: "user",
        usage: { input: 100, output: 200 },
      },
    }, collector);

    expect(collector.root.turns).toBe(0);
    expect(collector.root.input).toBe(0);
  });

  it("accumulates usage across multiple assistant messages", () => {
    const collector = makeCollector();
    processEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 100, output: 200, cost: { total: 0.001 } },
      },
    }, collector);
    processEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 50, output: 75, cost: { total: 0.0005 } },
      },
    }, collector);

    expect(collector.root.input).toBe(150);
    expect(collector.root.output).toBe(275);
    expect(collector.root.cost).toBe(0.0015);
    expect(collector.root.turns).toBe(2);
  });

  it("tracks max contextTokens across messages", () => {
    const collector = makeCollector();
    processEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { totalTokens: 100 },
      },
    }, collector);
    processEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { totalTokens: 500 },
      },
    }, collector);
    processEvent({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { totalTokens: 300 },
      },
    }, collector);

    expect(collector.root.contextTokens).toBe(500);
  });

  it("handles missing usage gracefully", () => {
    const collector = makeCollector();
    processEvent({
      type: "message_end",
      message: { role: "assistant" },
    }, collector);

    expect(collector.root.turns).toBe(1);
    expect(collector.root.input).toBe(0);
  });

  it("tracks tool calls from tool_execution_start", () => {
    const collector = makeCollector();
    processEvent({ type: "tool_execution_start", toolName: "read" }, collector);
    processEvent({ type: "tool_execution_start", toolName: "read" }, collector);
    processEvent({ type: "tool_execution_start", toolName: "bash" }, collector);

    expect(collector.toolCalls).toEqual({ read: 2, bash: 1 });
  });

  it("extracts subagent child usage from tool_execution_end", () => {
    const collector = makeCollector();
    processEvent({
      type: "tool_execution_end",
      toolName: "subagent",
      result: {
        details: {
          mode: "single",
          results: [
            {
              agent: "explore",
              exitCode: 0,
              usage: {
                input: 500,
                output: 300,
                cacheRead: 100,
                cacheWrite: 50,
                cost: 0.002,
                contextTokens: 600,
                turns: 3,
              },
              spawnMode: "lean",
            },
          ],
        },
      },
    }, collector);

    expect(collector.subagentUsed).toBe(true);
    expect(collector.child.input).toBe(500);
    expect(collector.child.output).toBe(300);
    expect(collector.child.cacheRead).toBe(100);
    expect(collector.child.cacheWrite).toBe(50);
    expect(collector.child.cost).toBe(0.002);
    expect(collector.child.contextTokens).toBe(600);
    expect(collector.child.turns).toBe(3);
    expect(collector.spawnModes).toContain("lean");
  });

  it("aggregates child usage from multiple subagent results", () => {
    const collector = makeCollector();
    processEvent({
      type: "tool_execution_end",
      toolName: "subagent",
      result: {
        details: {
          mode: "parallel",
          results: [
            {
              agent: "explore",
              usage: { input: 100, output: 50, cost: 0.001, turns: 1 },
              spawnMode: "full",
            },
            {
              agent: "general",
              usage: { input: 200, output: 100, cost: 0.002, turns: 2 },
              spawnMode: "full",
            },
          ],
        },
      },
    }, collector);

    expect(collector.child.input).toBe(300);
    expect(collector.child.output).toBe(150);
    expect(collector.child.cost).toBe(0.003);
    expect(collector.child.turns).toBe(3);
    expect(collector.spawnModes).toEqual(["full", "full"]);
  });

  it("ignores non-subagent tool_execution_end", () => {
    const collector = makeCollector();
    processEvent({
      type: "tool_execution_end",
      toolName: "read",
      result: { details: { results: [{ usage: { input: 999 } }] } },
    }, collector);

    expect(collector.subagentUsed).toBe(false);
    expect(collector.child.input).toBe(0);
  });
});

// ─── combineUsage ───

describe("combineUsage", () => {
  it("sums root and child usage fields", () => {
    const combined = combineUsage(
      makeUsage({ input: 100, output: 200, cacheRead: 30, cacheWrite: 15, cost: 0.01, turns: 2, contextTokens: 500 }),
      makeUsage({ input: 300, output: 400, cacheRead: 20, cacheWrite: 10, cost: 0.02, turns: 3, contextTokens: 600 }),
    );
    expect(combined.input).toBe(400);
    expect(combined.output).toBe(600);
    expect(combined.cacheRead).toBe(50);
    expect(combined.cacheWrite).toBe(25);
    expect(combined.cost).toBe(0.03);
    expect(combined.turns).toBe(5);
    expect(combined.contextTokens).toBe(600); // max
  });
});

// ─── validateRun ───

describe("validateRun", () => {
  it("detects missing subagent when expected", () => {
    const collector = makeCollector();
    collector.subagentUsed = false;

    const result = validateRun({ id: "test", prompt: "", expectSubagent: true }, collector);
    expect(result.subagentMissing).toBeDefined();
  });

  it("passes when subagent used as expected", () => {
    const collector = makeCollector();
    collector.subagentUsed = true;

    const result = validateRun({ id: "test", prompt: "", expectSubagent: true }, collector);
    expect(result.subagentMissing).toBeUndefined();
  });

  it("detects unexpected subagent usage", () => {
    const collector = makeCollector();
    collector.subagentUsed = true;

    const result = validateRun({ id: "test", prompt: "", expectSubagent: false }, collector);
    expect(result.subagentUnexpected).toBeDefined();
  });

  it("detects missing expected tools", () => {
    const collector = makeCollector();
    collector.toolCalls = { read: 1, bash: 1 };

    const result = validateRun(
      { id: "test", prompt: "", expectedToolNames: ["read", "bash", "grep"] },
      collector,
    );
    expect(result.toolsMissing).toContain("grep");
  });

  it("passes when all expected tools are used", () => {
    const collector = makeCollector();
    collector.toolCalls = { read: 1, bash: 1, grep: 1 };

    const result = validateRun(
      { id: "test", prompt: "", expectedToolNames: ["read", "bash", "grep"] },
      collector,
    );
    expect(result.toolsMissing).toBeUndefined();
  });

  it("returns empty object when no issues", () => {
    const collector = makeCollector();
    const result = validateRun({ id: "test", prompt: "" }, collector);
    expect(result).toEqual({});
  });
});

// ─── Aggregation ───

describe("computeMean", () => {
  it("computes mean of usage stats", () => {
    const metrics = [
      makeUsage({ input: 100, output: 200, cost: 0.01, turns: 2 }),
      makeUsage({ input: 300, output: 100, cost: 0.02, turns: 4 }),
    ];
    const mean = computeMean(metrics);
    expect(mean.input).toBe(200);
    expect(mean.output).toBe(150);
    expect(mean.cost).toBe(0.015);
    expect(mean.turns).toBe(3);
  });

  it("returns zero usage for empty array", () => {
    const mean = computeMean([]);
    expect(mean.input).toBe(0);
    expect(mean.output).toBe(0);
  });
});

describe("computeMin", () => {
  it("finds minimum of each field", () => {
    const metrics = [
      makeUsage({ input: 100, output: 200, cost: 0.02 }),
      makeUsage({ input: 50, output: 300, cost: 0.01 }),
    ];
    const min = computeMin(metrics);
    expect(min.input).toBe(50);
    expect(min.output).toBe(200);
    expect(min.cost).toBe(0.01);
  });

  it("returns zero usage for empty array", () => {
    const min = computeMin([]);
    expect(min.input).toBe(0);
  });
});

describe("computeMax", () => {
  it("finds maximum of each field", () => {
    const metrics = [
      makeUsage({ input: 100, output: 200, cost: 0.02 }),
      makeUsage({ input: 50, output: 300, cost: 0.01 }),
    ];
    const max = computeMax(metrics);
    expect(max.input).toBe(100);
    expect(max.output).toBe(300);
    expect(max.cost).toBe(0.02);
  });

  it("returns zero usage for empty array", () => {
    const max = computeMax([]);
    expect(max.input).toBe(0);
  });
});

describe("computeMeanElapsed", () => {
  it("computes mean of elapsed times", () => {
    expect(computeMeanElapsed([100, 200, 300])).toBe(200);
  });

  it("returns 0 for empty array", () => {
    expect(computeMeanElapsed([])).toBe(0);
  });
});

// ─── Edge Cases ───

describe("edge cases", () => {
  it("handles malformed JSON lines gracefully", () => {
    const collector = makeCollector();
    // processEvent expects already-parsed objects, so malformed lines
    // are caught by the JSON.parse try/catch in the runner itself.
    // The function should just not crash on unexpected shapes.
    processEvent({ type: "unknown_type" }, collector);
    processEvent({}, collector);
    processEvent([], collector);
    processEvent("string", collector);
    processEvent(123, collector);

    // Collector should remain unchanged
    expect(collector.root.turns).toBe(0);
    expect(collector.root.input).toBe(0);
  });

  it("combineUsage handles zero usage on both sides", () => {
    const combined = combineUsage(makeUsage(), makeUsage());
    expect(combined.input).toBe(0);
    expect(combined.cost).toBe(0);
  });

  it("multiple subagent invocations in one run", () => {
    const collector = makeCollector();

    // First subagent
    processEvent({
      type: "tool_execution_end",
      toolName: "subagent",
      result: {
        details: {
          mode: "single",
          results: [{ agent: "explore", usage: { input: 100, output: 50, cost: 0.001, turns: 1 }, spawnMode: "lean" }],
        },
      },
    }, collector);

    // Second subagent
    processEvent({
      type: "tool_execution_end",
      toolName: "subagent",
      result: {
        details: {
          mode: "single",
          results: [{ agent: "general", usage: { input: 200, output: 100, cost: 0.002, turns: 2 }, spawnMode: "full" }],
        },
      },
    }, collector);

    expect(collector.child.input).toBe(300);
    expect(collector.child.turns).toBe(3);
    expect(collector.spawnModes).toEqual(["lean", "full"]);
  });
});
