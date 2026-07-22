// ─── subagent-spawn.test.ts ────── Tests for lean-spawn planner ─────────
import { describe, it, expect } from "vitest";
import {
  isBuiltinTool,
  canDisableExtensions,
  resolveSpawnMode,
  buildSpawnPlan,
} from "../tools/subagent/spawn.js";
import type { AgentConfig } from "../lib/agents.js";

// ─── Helpers ───

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "test",
    systemPrompt: "You are a test agent.",
    source: "builtin",
    filePath: "(test)",
    ...overrides,
  };
}

function exploreAgent(): AgentConfig {
  return makeAgent({
    name: "explore",
    tools: ["read", "grep", "find", "ls", "bash"],
    spawnMode: "lean",
  });
}

function generalAgent(): AgentConfig {
  return makeAgent({
    name: "general",
    tools: ["read", "bash", "edit", "write"],
  });
}

// ─── isBuiltinTool ───

describe("isBuiltinTool", () => {
  it("returns true for built-in tools", () => {
    expect(isBuiltinTool("read")).toBe(true);
    expect(isBuiltinTool("bash")).toBe(true);
    expect(isBuiltinTool("edit")).toBe(true);
    expect(isBuiltinTool("write")).toBe(true);
    expect(isBuiltinTool("grep")).toBe(true);
    expect(isBuiltinTool("find")).toBe(true);
    expect(isBuiltinTool("ls")).toBe(true);
  });

  it("returns false for non-built-in tools", () => {
    expect(isBuiltinTool("web_search")).toBe(false);
    expect(isBuiltinTool("fetch_content")).toBe(false);
    expect(isBuiltinTool("subagent")).toBe(false);
  });

  it("returns false for unknown tools", () => {
    expect(isBuiltinTool("")).toBe(false);
    expect(isBuiltinTool("nonexistent")).toBe(false);
  });
});

// ─── canDisableExtensions ───

describe("canDisableExtensions", () => {
  it("returns true when all agent tools are built-in", () => {
    const agent = makeAgent({ tools: ["read", "bash", "edit", "write"] });
    expect(canDisableExtensions(agent)).toBe(true);
  });

  it("returns false when any agent tool is not built-in", () => {
    const agent = makeAgent({ tools: ["read", "web_search", "bash"] });
    expect(canDisableExtensions(agent)).toBe(false);
  });

  it("returns false when tools list is empty", () => {
    const agent = makeAgent({ tools: [] });
    expect(canDisableExtensions(agent)).toBe(false);
  });

  it("returns false when tools is undefined", () => {
    const agent = makeAgent();
    expect(canDisableExtensions(agent)).toBe(false);
  });
});

// ─── resolveSpawnMode ───

describe("resolveSpawnMode", () => {
  it("returns 'lean' when explicitly requested", () => {
    expect(resolveSpawnMode("lean", generalAgent())).toBe("lean");
  });

  it("returns 'full' when explicitly requested", () => {
    expect(resolveSpawnMode("full", exploreAgent())).toBe("full");
  });

  it("falls back to agent default when mode is undef/auto", () => {
    expect(resolveSpawnMode(undefined, exploreAgent())).toBe("lean");
    expect(resolveSpawnMode("auto", exploreAgent())).toBe("lean");
  });

  it("uses heuristic: explore -> lean, others -> full", () => {
    expect(resolveSpawnMode(undefined, generalAgent())).toBe("full");
    expect(resolveSpawnMode(undefined, exploreAgent())).toBe("lean");
    expect(resolveSpawnMode(undefined, makeAgent({ name: "custom" }))).toBe("full");
  });
});

// ─── buildSpawnPlan ───

describe("buildSpawnPlan", () => {
  it("full mode produces an empty plan (no flags, no notes)", () => {
    const plan = buildSpawnPlan(generalAgent(), "full");
    expect(plan.mode).toBe("full");
    expect(plan.flags).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.extensionsDisabled).toBe(false);
  });

  it("lean mode for explore disables extensions", () => {
    const plan = buildSpawnPlan(exploreAgent(), undefined);
    expect(plan.mode).toBe("lean");
    expect(plan.flags).toContain("--no-skills");
    expect(plan.flags).toContain("--no-context-files");
    expect(plan.flags).toContain("--no-prompt-templates");
    expect(plan.flags).toContain("--no-themes");
    expect(plan.flags).toContain("--no-extensions");
    expect(plan.extensionsDisabled).toBe(true);
    expect(plan.notes.length).toBeGreaterThan(0);
  });

  it("lean mode keeps extensions enabled for agents with non-built-in tools", () => {
    const agent = makeAgent({ tools: ["read", "web_search"] });
    const plan = buildSpawnPlan(agent, "lean");
    expect(plan.mode).toBe("lean");
    expect(plan.flags).toContain("--no-skills");
    expect(plan.flags).not.toContain("--no-extensions");
    expect(plan.extensionsDisabled).toBe(false);
    expect(plan.notes.length).toBeGreaterThan(0);
    expect(plan.notes[0]).toContain("extensions kept enabled");
  });

  it("lean mode keeps extensions enabled when tools undefined", () => {
    const agent = makeAgent(); // no tools
    const plan = buildSpawnPlan(agent, "lean");
    expect(plan.mode).toBe("lean");
    expect(plan.flags).toContain("--no-skills");
    expect(plan.flags).not.toContain("--no-extensions");
    expect(plan.extensionsDisabled).toBe(false);
    expect(plan.notes[0]).toContain("no explicit tool allowlist");
  });

  it("lean mode always includes the four lean flags", () => {
    const plan = buildSpawnPlan(exploreAgent(), "lean");
    expect(plan.flags).toContain("--no-skills");
    expect(plan.flags).toContain("--no-context-files");
    expect(plan.flags).toContain("--no-prompt-templates");
    expect(plan.flags).toContain("--no-themes");
  });

  it("auto mode resolves explore to lean with extensions disabled", () => {
    const plan = buildSpawnPlan(exploreAgent(), "auto");
    expect(plan.mode).toBe("lean");
    expect(plan.flags).toContain("--no-extensions");
  });

  it("auto mode resolves general to full", () => {
    const plan = buildSpawnPlan(generalAgent(), "auto");
    expect(plan.mode).toBe("full");
    expect(plan.flags).toEqual([]);
  });
});
