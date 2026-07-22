// ─── output.ts ────── Output compaction & artifact helpers ───────────────
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SingleResult, ArtifactEntry } from "./types.js";
import { getResultOutput, getFinalOutput, isFailedResult } from "./types.js";

// ─── Defaults ───
const DEFAULT_SUMMARY_MAX_CHARS = 1200;
const DEFAULT_ARTIFACT_THRESHOLD_CHARS = 4000;
const DEFAULT_CHAIN_HANDOFF_MAX_CHARS = 4000;

// ─── Compaction ───

/**
 * Deterministically compact text by character budget.
 * - Trims leading/trailing whitespace
 * - Preserves line breaks
 * - Truncates to maxChars, appending a clear marker
 */
export function compactText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };

  const truncated = trimmed.slice(0, maxChars);
  return {
    text: `${truncated}...[truncated]`,
    truncated: true,
  };
}

/** Normalize whitespace conservatively: collapse multiple blank lines, trim. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Compact chain handoff text for {previous} replacement.
 * When chainHandoffMode=compact, truncate the previous step's output.
 */
export function compactChainHandoff(
  previousOutput: string,
  mode: "full" | "compact",
  maxChars: number,
): string {
  if (mode === "full") return previousOutput;
  const normalized = normalizeWhitespace(previousOutput);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...[previous output truncated]`;
}

// ─── Return mode selection ───

/** Resolve effective return mode based on the explicit mode, mode of operation, and output size. */
export function getEffectiveReturnMode(
  explicitMode: "auto" | "inline" | "summary" | "artifact",
  opMode: "single" | "parallel" | "chain",
  textLengths: number[],
  thresholdChars: number,
): "inline" | "summary" | "artifact" {
  if (explicitMode !== "auto") return explicitMode;

  if (opMode === "parallel") {
    // Always avoid dumping full task outputs into root context
    const anyLarge = textLengths.some((len) => len > thresholdChars);
    return anyLarge ? "artifact" : "summary";
  }

  if (opMode === "chain") {
    // If final output is small, inline it; if large, use artifact
    const finalLen = textLengths[textLengths.length - 1] ?? 0;
    return finalLen > thresholdChars ? "artifact" : "inline";
  }

  // single
  const len = textLengths[0] ?? 0;
  return len > thresholdChars ? "artifact" : "inline";
}

// ─── Artifact writing ───

let _artifactRoot: string | null = null;

/** Lazily create the artifact temp directory. */
export function getArtifactRoot(): string {
  if (_artifactRoot && fs.existsSync(_artifactRoot)) return _artifactRoot;
  _artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-artifacts-"));
  return _artifactRoot;
}

/** Write a single result's full output to an artifact file. Returns the artifact entry. */
export function writeResultArtifact(
  result: SingleResult,
  index?: number,
): ArtifactEntry {
  const root = getArtifactRoot();
  const safeName = result.agent.replace(/[^\w.-]+/g, "_");
  const suffix = result.step !== undefined ? `-step${result.step}` : index !== undefined ? `-${index}` : "";
  const baseName = `${safeName}${suffix}`;
  let collisionIndex = 0;
  let filePath: string;
  while (true) {
    const collisionSuffix = collisionIndex === 0 ? "" : `-${collisionIndex}`;
    filePath = path.join(root, `${baseName}${collisionSuffix}.txt`);
    try {
      const fd = fs.openSync(filePath, "wx");
      fs.closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      collisionIndex++;
    }
  }

  const lines: string[] = [];
  lines.push(`=== Subagent Artifact ===`);
  lines.push(`agent: ${result.agent}`);
  lines.push(`agentSource: ${result.agentSource}`);
  lines.push(`task: ${result.task}`);
  if (result.model) lines.push(`model: ${result.model}`);
  if (result.stopReason) lines.push(`stopReason: ${result.stopReason}`);
  if (result.step !== undefined) lines.push(`step: ${result.step}`);
  lines.push(`exitCode: ${result.exitCode}`);
  lines.push(`usage: input=${result.usage.input} output=${result.usage.output} cost=${result.usage.cost} turns=${result.usage.turns}`);
  lines.push("");
  lines.push(`--- OUTPUT ---`);
  lines.push("");
  lines.push(getResultOutput(result));
  if (result.stderr) {
    lines.push("");
    lines.push("--- STDERR ---");
    lines.push("");
    lines.push(result.stderr);
  }

  const content = lines.join("\n");
  fs.writeFileSync(filePath, content, "utf-8");

  return {
    agent: result.agent,
    path: filePath,
    bytes: Buffer.byteLength(content, "utf8"),
    step: result.step,
  };
}

/** Write artifacts for a list of results, optionally filtered by a threshold. */
export function writeArtifactsForResults(
  results: SingleResult[],
  thresholdChars: number,
  forceAll: boolean = false,
): { artifacts: ArtifactEntry[]; textLengths: number[] } {
  const artifacts: ArtifactEntry[] = [];
  const textLengths: number[] = [];
  for (let i = 0; i < results.length; i++) {
    const output = getResultOutput(results[i]);
    textLengths.push(output.length);
    if (forceAll || output.length > thresholdChars) {
      artifacts.push(writeResultArtifact(results[i], i));
    }
  }
  return { artifacts, textLengths };
}

// ─── Root content builders ───

/** Build a compact summary line for a single result. */
function resultSummaryLine(result: SingleResult, summaryMaxChars: number, idx?: number): string {
  const output = getResultOutput(result);
  const status = isFailedResult(result)
    ? `failed${result.stopReason && result.stopReason !== "end" ? ` (${result.stopReason})` : ""}`
    : "completed";
  const prefix = idx !== undefined ? `[${idx + 1}] ` : "";
  const compact = compactText(output, summaryMaxChars);
  return `${prefix}**${result.agent}** ${status}: ${compact.text}`;
}

/** Build root-facing content for single mode. */
export function buildSingleRootContent(
  result: SingleResult,
  returnMode: "inline" | "summary" | "artifact",
  artifacts: ArtifactEntry[],
  summaryMaxChars: number = DEFAULT_SUMMARY_MAX_CHARS,
): string {
  const rawOutput = getResultOutput(result);

  if (returnMode === "inline") {
    return rawOutput;
  }

  if (returnMode === "artifact" && artifacts.length > 0) {
    const artifact = artifacts[0];
    const preview = compactText(rawOutput, summaryMaxChars);
    return (
      `[Subagent: ${result.agent} — full output saved to artifact]\n` +
      `Artifact: ${artifact.path}\n` +
      `Bytes: ${artifact.bytes}\n\n` +
      `**Preview:**\n${preview.text}`
    );
  }

  // summary mode
  return resultSummaryLine(result, summaryMaxChars);
}

/** Build root-facing content for parallel mode. */
export function buildParallelRootContent(
  results: SingleResult[],
  returnMode: "inline" | "summary" | "artifact",
  artifacts: ArtifactEntry[],
  summaryMaxChars: number = DEFAULT_SUMMARY_MAX_CHARS,
): string {
  const successCount = results.filter((r) => !isFailedResult(r)).length;
  const header = `Parallel: ${successCount}/${results.length} succeeded`;

  if (returnMode === "inline") {
    const summaries = results.map((r) => {
      const output = getResultOutput(r);
      const status = isFailedResult(r) ? "failed" : "completed";
      return `### [${r.agent}] ${status}\n\n${output}`;
    });
    return `${header}\n\n${summaries.join("\n\n---\n\n")}`;
  }

  const lines = [header];
  for (let i = 0; i < results.length; i++) {
    lines.push(resultSummaryLine(results[i], summaryMaxChars, i));
  }

  if (returnMode === "artifact" && artifacts.length > 0) {
    lines.push("");
    lines.push("**Artifacts (full output):**");
    for (const a of artifacts) {
      lines.push(`- \`${a.path}\` (${a.bytes} bytes)`);
    }
  }

  return lines.join("\n");
}

/** Build root-facing content for chain mode. */
export function buildChainRootContent(
  results: SingleResult[],
  returnMode: "inline" | "summary" | "artifact",
  artifacts: ArtifactEntry[],
  summaryMaxChars: number = DEFAULT_SUMMARY_MAX_CHARS,
): string {
  if (results.length === 0) return "(no output)";

  const finalResult = results[results.length - 1];
  const finalOutput = getFinalOutput(finalResult.messages) || "(no output)";

  if (returnMode === "inline") {
    return finalOutput;
  }

  const compact = compactText(finalOutput, summaryMaxChars);
  let text = `Chain completed (${results.length} step${results.length > 1 ? "s" : ""})\n\n`;
  text += `**Final output:**\n${compact.text}`;

  if (returnMode === "artifact" && artifacts.length > 0) {
    text += `\n\n**Artifacts (full output):**`;
    for (const a of artifacts) {
      text += `\n- \`${a.path}\` (${a.bytes} bytes)`;
    }
  }

  return text;
}

/** Build root-facing content when a chain stops on a failed step. */
export function buildChainFailureRootContent(
  results: SingleResult[],
  returnMode: "inline" | "summary" | "artifact",
  artifacts: ArtifactEntry[],
  summaryMaxChars: number = DEFAULT_SUMMARY_MAX_CHARS,
): string {
  if (results.length === 0) return "(no output)";

  const failedResult = results[results.length - 1];
  const step = failedResult.step ?? results.length;
  const failureOutput = getResultOutput(failedResult);
  const prefix = `Chain stopped at step ${step} (${failedResult.agent}): `;

  if (returnMode === "inline") {
    return `${prefix}${failureOutput}`;
  }

  const compact = compactText(failureOutput, summaryMaxChars);
  let text = `${prefix}${compact.text}`;

  if (returnMode === "artifact" && artifacts.length > 0) {
    text += `\n\n**Artifacts (full output):**`;
    for (const a of artifacts) {
      text += `\n- \`${a.path}\` (${a.bytes} bytes)`;
    }
  }

  return text;
}
