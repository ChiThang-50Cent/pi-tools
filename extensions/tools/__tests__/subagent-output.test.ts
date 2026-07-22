// ─── subagent-output.test.ts ────── Tests for output compaction helpers ──
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import {
  compactText,
  normalizeWhitespace,
  compactChainHandoff,
  getEffectiveReturnMode,
  getArtifactRoot,
  writeResultArtifact,
  writeArtifactsForResults,
  buildSingleRootContent,
  buildParallelRootContent,
  buildChainRootContent,
  buildChainFailureRootContent,
} from "../tools/subagent/output.js";
import { zeroUsage } from "../tools/subagent/types.js";
import type { SingleResult } from "../tools/subagent/types.js";

// ─── Helpers ───

function makeResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent: "test-agent",
    agentSource: "builtin",
    task: "test task",
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: overrides.messages?.[0]?.content?.[0]?.text ?? "test output" }],
      },
    ],
    stderr: "",
    usage: overrides.usage ?? zeroUsage(),
    step: overrides.step,
    stopReason: overrides.stopReason ?? "end",
    model: overrides.model,
    errorMessage: overrides.errorMessage,
  };
}

function failedResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return makeResult({
    exitCode: 1,
    stopReason: "error",
    errorMessage: "something went wrong",
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "error output" }],
      },
    ],
    ...overrides,
  });
}

// ─── compactText ───

describe("compactText", () => {
  it("returns unchanged text when within limit", () => {
    const { text, truncated } = compactText("hello", 100);
    expect(text).toBe("hello");
    expect(truncated).toBe(false);
  });

  it("trims whitespace", () => {
    const { text, truncated } = compactText("  hello world  \n", 100);
    expect(text).toBe("hello world");
    expect(truncated).toBe(false);
  });

  it("truncates text exceeding character limit", () => {
    const input = "a".repeat(100);
    const { text, truncated } = compactText(input, 50);
    expect(truncated).toBe(true);
    expect(text).toContain("...[truncated]");
    expect(text.length).toBe(50 + "...[truncated]".length);
  });

  it("handles exact limit", () => {
    const input = "a".repeat(10);
    const { text, truncated } = compactText(input, 10);
    expect(text).toBe(input);
    expect(truncated).toBe(false);
  });

  it("handles empty string", () => {
    const { text, truncated } = compactText("", 100);
    expect(text).toBe("");
    expect(truncated).toBe(false);
  });
});

// ─── normalizeWhitespace ───

describe("normalizeWhitespace", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normalizeWhitespace("  hello  ")).toBe("hello");
  });

  it("collapses 3+ blank lines to 2", () => {
    const input = "line1\n\n\n\n\nline2";
    expect(normalizeWhitespace(input)).toBe("line1\n\nline2");
  });

  it("preserves double blank lines", () => {
    const input = "line1\n\nline2";
    expect(normalizeWhitespace(input)).toBe("line1\n\nline2");
  });

  it("preserves single line breaks", () => {
    const input = "line1\nline2\nline3";
    expect(normalizeWhitespace(input)).toBe("line1\nline2\nline3");
  });
});

// ─── compactChainHandoff ───

describe("compactChainHandoff", () => {
  it("returns full output when mode is full", () => {
    const output = "a".repeat(5000);
    const result = compactChainHandoff(output, "full", 100);
    expect(result).toBe(output);
  });

  it("returns normalized output within limit", () => {
    const result = compactChainHandoff("short output", "compact", 100);
    expect(result).toBe("short output");
  });

  it("truncates output exceeding max chars", () => {
    const output = "a".repeat(100);
    const result = compactChainHandoff(output, "compact", 50);
    expect(result.length).toBe(50 + "...[previous output truncated]".length);
    expect(result).toContain("...[previous output truncated]");
  });

  it("normalizes whitespace before truncation", () => {
    const output = "line1\n\n\n\nline2";
    const result = compactChainHandoff(output, "compact", 100);
    expect(result).toBe("line1\n\nline2");
  });
});

// ─── getEffectiveReturnMode ───

describe("getEffectiveReturnMode", () => {
  it("returns explicit mode when not auto", () => {
    expect(getEffectiveReturnMode("inline", "single", [100], 4000)).toBe("inline");
    expect(getEffectiveReturnMode("summary", "single", [100], 4000)).toBe("summary");
    expect(getEffectiveReturnMode("artifact", "single", [100], 4000)).toBe("artifact");
  });

  it("single auto: small output → inline", () => {
    expect(getEffectiveReturnMode("auto", "single", [100], 4000)).toBe("inline");
  });

  it("single auto: large output → artifact", () => {
    expect(getEffectiveReturnMode("auto", "single", [5000], 4000)).toBe("artifact");
  });

  it("parallel auto: all small → summary", () => {
    expect(getEffectiveReturnMode("auto", "parallel", [100, 200, 300], 4000)).toBe("summary");
  });

  it("parallel auto: any large → artifact", () => {
    expect(getEffectiveReturnMode("auto", "parallel", [100, 5000, 300], 4000)).toBe("artifact");
  });

  it("chain auto: small final → inline", () => {
    expect(getEffectiveReturnMode("auto", "chain", [5000, 5000, 100], 4000)).toBe("inline");
  });

  it("chain auto: large final → artifact", () => {
    expect(getEffectiveReturnMode("auto", "chain", [100, 5000], 4000)).toBe("artifact");
  });

  it("handles empty text lengths", () => {
    expect(getEffectiveReturnMode("auto", "single", [], 4000)).toBe("inline");
  });
});

// ─── writeResultArtifact ───

describe("writeResultArtifact", () => {
  afterAll(() => {
    // Cleanup
    const root = getArtifactRoot();
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates an artifact file with metadata", () => {
    const result = makeResult({ step: 1 });
    const entry = writeResultArtifact(result);

    expect(entry.agent).toBe("test-agent");
    expect(entry.step).toBe(1);
    expect(entry.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(entry.path)).toBe(true);

    const content = fs.readFileSync(entry.path, "utf8");
    expect(content).toContain("=== Subagent Artifact ===");
    expect(content).toContain("agent: test-agent");
    expect(content).toContain("task: test task");
    expect(content).toContain("exitCode: 0");
    expect(content).toContain("--- OUTPUT ---");
    expect(content).toContain("test output");
  });

  it("writes repeated single invocations to distinct files", () => {
    const first = writeResultArtifact(makeResult());
    const second = writeResultArtifact(makeResult());

    expect(second.path).not.toBe(first.path);
    expect(fs.readFileSync(first.path, "utf8")).toContain("test output");
    expect(fs.readFileSync(second.path, "utf8")).toContain("test output");
  });

  it("writes to a temp directory", () => {
    const entry = writeResultArtifact(makeResult());
    expect(entry.path).toContain("pi-subagent-artifacts-");
  });
});

// ─── writeArtifactsForResults ───

describe("writeArtifactsForResults", () => {
  afterAll(() => {
    const root = getArtifactRoot();
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes artifacts only for results exceeding threshold", () => {
    const smallResult = makeResult({
      messages: [{ role: "assistant", content: [{ type: "text", text: "small" }] }],
    });
    const largeResult = makeResult({
      messages: [{ role: "assistant", content: [{ type: "text", text: "x".repeat(5000) }] }],
    });

    const { artifacts, textLengths } = writeArtifactsForResults(
      [smallResult, largeResult],
      4000,
    );

    expect(textLengths).toEqual([5, 5000]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].agent).toBe("test-agent");
    expect(fs.existsSync(artifacts[0].path)).toBe(true);
  });

  it("returns empty artifacts when all outputs small", () => {
    const { artifacts } = writeArtifactsForResults([makeResult()], 4000);
    expect(artifacts).toHaveLength(0);
  });

  it("writes artifacts for all results when forceAll is true", () => {
    const { artifacts } = writeArtifactsForResults([makeResult()], 4000, true);
    expect(artifacts).toHaveLength(1);
    expect(fs.existsSync(artifacts[0].path)).toBe(true);
  });
});

// ─── buildSingleRootContent ───

describe("buildSingleRootContent", () => {
  it("inline mode returns raw output", () => {
    const result = makeResult();
    const content = buildSingleRootContent(result, "inline", []);
    expect(content).toBe("test output");
  });

  it("summary mode returns compact preview", () => {
    const result = makeResult();
    const content = buildSingleRootContent(result, "summary", []);
    expect(content).toContain("test-agent");
    expect(content).toContain("completed");
    expect(content).toContain("test output");
  });

  it("summary mode respects summaryMaxChars", () => {
    const result = makeResult({
      messages: [{ role: "assistant", content: [{ type: "text", text: "abcdefghijklmnopqrstuvwxyz" }] }],
    });
    const content = buildSingleRootContent(result, "summary", [], 5);
    expect(content).toContain("abcde...[truncated]");
  });

  it("artifact mode returns artifact path + preview", () => {
    const result = makeResult();
    const artifact = { agent: "test-agent", path: "/tmp/test.txt", bytes: 100 };
    const content = buildSingleRootContent(result, "artifact", [artifact]);
    expect(content).toContain("full output saved to artifact");
    expect(content).toContain("/tmp/test.txt");
    expect(content).toContain("Preview");
  });

  it("handles failed result", () => {
    const result = failedResult();
    const content = buildSingleRootContent(result, "summary", []);
    expect(content).toContain("failed");
    expect(content).toContain("something went wrong");
  });
});

// ─── buildParallelRootContent ───

describe("buildParallelRootContent", () => {
  it("inline mode returns full summaries (legacy)", () => {
    const results = [makeResult(), makeResult()];
    const content = buildParallelRootContent(results, "inline", []);
    expect(content).toContain("Parallel: 2/2 succeeded");
    expect(content).toContain("[test-agent] completed");
  });

  it("summary mode returns compact lines", () => {
    const results = [makeResult(), failedResult()];
    const content = buildParallelRootContent(results, "summary", []);
    expect(content).toContain("Parallel: 1/2 succeeded");
    expect(content).toContain("[1]");
    expect(content).toContain("[2]");
    expect(content).toContain("failed");
  });

  it("summary mode respects summaryMaxChars for parallel results", () => {
    const results = [makeResult({
      messages: [{ role: "assistant", content: [{ type: "text", text: "abcdefghijklmnopqrstuvwxyz" }] }],
    })];
    const content = buildParallelRootContent(results, "summary", [], 5);
    expect(content).toContain("abcde...[truncated]");
  });

  it("artifact mode includes artifact paths", () => {
    const results = [makeResult()];
    const artifacts = [{ agent: "test-agent", path: "/tmp/art.txt", bytes: 500 }];
    const content = buildParallelRootContent(results, "artifact", artifacts);
    expect(content).toContain("Artifacts (full output)");
    expect(content).toContain("/tmp/art.txt");
  });
});

// ─── buildChainRootContent ───

describe("buildChainFailureRootContent", () => {
  it("compacts a large failure in summary mode", () => {
    const failure = failedResult({ errorMessage: "failure-".repeat(1000), step: 2 });
    const content = buildChainFailureRootContent([makeResult({ step: 1 }), failure], "summary", [], 20);

    expect(content).toContain("Chain stopped at step 2");
    expect(content).toContain("...[truncated]");
    expect(content).not.toContain("failure-".repeat(1000));
  });

  it("writes and links full output in artifact mode", () => {
    const failure = failedResult({ errorMessage: "failure-".repeat(1000), step: 2 });
    const results = [makeResult({ step: 1 }), failure];
    const { artifacts } = writeArtifactsForResults(results, 4000, true);
    const content = buildChainFailureRootContent(results, "artifact", artifacts, 20);

    expect(artifacts).toHaveLength(2);
    expect(content).toContain("Artifacts (full output)");
    expect(content).not.toContain("failure-".repeat(1000));
    expect(fs.readFileSync(artifacts[1].path, "utf8")).toContain("failure-".repeat(1000));
  });
});

describe("buildChainRootContent", () => {
  it("inline mode returns final output", () => {
    const results = [
      makeResult({ step: 1 }),
      makeResult({
        step: 2,
        messages: [{ role: "assistant", content: [{ type: "text", text: "final output" }] }],
      }),
    ];
    const content = buildChainRootContent(results, "inline", []);
    expect(content).toBe("final output");
  });

  it("summary mode returns compact final output", () => {
    const results = [makeResult({ step: 1 })];
    const content = buildChainRootContent(results, "summary", []);
    expect(content).toContain("Chain completed (1 step)");
    expect(content).toContain("Final output");
    expect(content).toContain("test output");
  });

  it("artifact mode includes artifact paths", () => {
    const results = [makeResult({ step: 1 })];
    const artifacts = [{ agent: "test-agent", path: "/tmp/art.txt", bytes: 500, step: 1 }];
    const content = buildChainRootContent(results, "artifact", artifacts);
    expect(content).toContain("Artifacts (full output)");
    expect(content).toContain("/tmp/art.txt");
  });
});
