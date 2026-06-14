// ─── subagent-handoff.test.ts ────── Tests for handoff-context helpers ──
import { describe, it, expect } from "vitest";
import {
  normalizeHandoffContext,
  compactHandoffContext,
  buildDelegatedTask,
  DEFAULT_CONTEXT_MAX_CHARS,
} from "../tools/subagent/handoff.js";

// ─── normalizeHandoffContext ───

describe("normalizeHandoffContext", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normalizeHandoffContext("  hello world  ")).toBe("hello world");
  });

  it("collapses 3+ blank lines to double blank line", () => {
    const input = "line1\n\n\n\n\nline2";
    expect(normalizeHandoffContext(input)).toBe("line1\n\nline2");
  });

  it("collapses whitespace-only lines in runs", () => {
    const input = "line1\n\n  \n\n \t \n\nline2";
    expect(normalizeHandoffContext(input)).toBe("line1\n\nline2");
  });

  it("preserves double blank lines", () => {
    const input = "line1\n\nline2";
    expect(normalizeHandoffContext(input)).toBe("line1\n\nline2");
  });

  it("preserves single line breaks", () => {
    const input = "line1\nline2\nline3";
    expect(normalizeHandoffContext(input)).toBe("line1\nline2\nline3");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeHandoffContext("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeHandoffContext("   \n\n   ")).toBe("");
  });

  it("handles context with no blank lines", () => {
    expect(normalizeHandoffContext("Relevant files: src/a.ts, src/b.ts")).toBe(
      "Relevant files: src/a.ts, src/b.ts",
    );
  });
});

// ─── compactHandoffContext ───

describe("compactHandoffContext", () => {
  it("returns content unchanged when within maxChars", () => {
    const { text, truncated } = compactHandoffContext("short note", 100);
    expect(text).toBe("short note");
    expect(truncated).toBe(false);
  });

  it("truncates and appends marker when exceeding maxChars", () => {
    const input = "abc".repeat(50); // 150 chars
    const { text, truncated } = compactHandoffContext(input, 80);
    expect(truncated).toBe(true);
    expect(text).toContain("...[context truncated]");
    expect(text.length).toBe(80 + "...[context truncated]".length);
    // Should start with the normalized prefix
    expect(text.startsWith("abc".repeat(26))).toBe(true);
  });

  it("normalizes whitespace before measuring length", () => {
    const input = "  a\n\n\n\nb  ";
    const { text, truncated } = compactHandoffContext(input, 100);
    expect(text).toBe("a\n\nb");
    expect(truncated).toBe(false);
  });

  it("handles exact maxChars boundary", () => {
    const input = "x".repeat(10);
    const { text, truncated } = compactHandoffContext(input, 10);
    expect(text).toBe(input);
    expect(truncated).toBe(false);
  });
});

// ─── buildDelegatedTask ───

describe("buildDelegatedTask", () => {
  it("returns original task unchanged when no context", () => {
    const { task, contextChars, truncated } = buildDelegatedTask(
      "Do something",
      undefined,
      2000,
    );
    expect(task).toBe("Do something");
    expect(contextChars).toBe(0);
    expect(truncated).toBe(false);
  });

  it("returns original task unchanged when context is empty string", () => {
    const { task, contextChars, truncated } = buildDelegatedTask(
      "Do something",
      "",
      2000,
    );
    expect(task).toBe("Do something");
    expect(contextChars).toBe(0);
    expect(truncated).toBe(false);
  });

  it("returns original task unchanged when context is whitespace only", () => {
    const { task, contextChars, truncated } = buildDelegatedTask(
      "Do something",
      " \n\n  ",
      2000,
    );
    expect(task).toBe("Do something");
    expect(contextChars).toBe(0);
    expect(truncated).toBe(false);
  });

  it("prepends structured handoff block when context provided", () => {
    const ctx = "Relevant files: src/auth.ts\nFinding: logic is split";
    const { task, contextChars, truncated } = buildDelegatedTask(
      "Refactor auth module",
      ctx,
      2000,
    );
    expect(task).toContain("Parent handoff context:");
    expect(task).toContain("Relevant files: src/auth.ts");
    expect(task).toContain("Finding: logic is split");
    expect(task).toContain("Delegated task:");
    expect(task).toContain("Refactor auth module");
    expect(contextChars).toBe(ctx.length);
    expect(truncated).toBe(false);
  });

  it("truncates long context with marker", () => {
    const ctx = "long note ".repeat(200); // ~2000 chars
    const { task, contextChars, truncated } = buildDelegatedTask(
      "Do task",
      ctx,
      100,
    );
    expect(truncated).toBe(true);
    expect(task).toContain("Parent handoff context:");
    expect(task).toContain("...[context truncated]");
    expect(task).toContain("Delegated task:");
    expect(task).toContain("Do task");
    expect(contextChars).toBeLessThan(ctx.length);
  });

  it("orders context before delegated task", () => {
    const { task } = buildDelegatedTask("the task", "the context", 2000);
    const contextPos = task.indexOf("Parent handoff context:");
    const taskPos = task.indexOf("Delegated task:");
    expect(contextPos).toBeGreaterThanOrEqual(0);
    expect(taskPos).toBeGreaterThan(contextPos);
  });

  it("respects custom maxChars", () => {
    const ctx = "a".repeat(500);
    const { task, truncated, contextChars } = buildDelegatedTask(
      "task text",
      ctx,
      200,
    );
    expect(truncated).toBe(true);
    expect(contextChars).toBeLessThanOrEqual(200 + "...[context truncated]".length);
    expect(task).toContain("...[context truncated]");
  });

  it("uses DEFAULT_CONTEXT_MAX_CHARS (2000) when maxChars matches default", () => {
    expect(DEFAULT_CONTEXT_MAX_CHARS).toBe(2000);
    const ctx = "short";
    const { truncated } = buildDelegatedTask("task text", ctx, DEFAULT_CONTEXT_MAX_CHARS);
    expect(truncated).toBe(false);
  });
});

// ─── Integration-style: injection format ───

describe("injection format", () => {
  it("child task format separates context from delegated task clearly", () => {
    const ctx = "Known: function X is in src/x.ts\nConstraint: read only";
    const { task } = buildDelegatedTask("Find all callers of X", ctx, 2000);

    // Expected structure
    const lines = task.split("\n");
    expect(lines[0]).toBe("Parent handoff context:");
    expect(lines[1]).toBe("Known: function X is in src/x.ts");
    expect(lines[2]).toBe("Constraint: read only");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("Delegated task:");
    expect(lines[5]).toBe("Find all callers of X");
  });

  it("preserves task text verbatim (no trimming of task)", () => {
    const ctx = "context here";
    const rawTask = "  Find with leading spaces  ";
    const { task } = buildDelegatedTask(rawTask, ctx, 2000);
    expect(task).toContain(rawTask);
  });
});

// ─── Backward compatibility ───

describe("backward compatibility", () => {
  it("no context → task returned exactly as-is", () => {
    const original = "Refactor the auth module to use async/await";
    const { task, contextChars, truncated } = buildDelegatedTask(
      original,
      undefined,
      2000,
    );
    expect(task).toBe(original);
    expect(contextChars).toBe(0);
    expect(truncated).toBe(false);
  });

  it("falsy context (null equivalent) treated as no context", () => {
    // TypeScript doesn't allow null but undefined behaves the same
    const original = "Some task";
    const { task } = buildDelegatedTask(original, undefined, 2000);
    expect(task).toBe(original);
  });
});
