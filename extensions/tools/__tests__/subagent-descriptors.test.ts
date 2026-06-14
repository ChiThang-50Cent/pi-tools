// ─── subagent-descriptors.test.ts ────── Tests for subagent routing policy ──
import { describe, it, expect } from "vitest";
import { buildAgentDescription, buildPromptGuidelines } from "../tools/subagent/descriptors.js";
import type { AgentConfig } from "../lib/agents.js";

// ─── Helpers ───

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "A test agent for routing policy tests.",
    systemPrompt: "You are a test agent.",
    source: "builtin",
    filePath: "(test)",
    ...overrides,
  };
}

function exploreAgent(): AgentConfig {
  return makeAgent({
    name: "explore",
    description: "Read-only codebase explorer.",
    taskCategories: ["code exploration", "file discovery", "pattern search"],
  });
}

function generalAgent(): AgentConfig {
  return makeAgent({
    name: "general",
    description: "Multi-step tasks, implementation, refactoring.",
    taskCategories: ["implementation", "refactoring", "debugging"],
  });
}

// ─── buildAgentDescription routing-policy section ───

describe("buildAgentDescription routing-policy", () => {
  const desc = buildAgentDescription([exploreAgent(), generalAgent()]);

  it("includes a routing-policy section", () => {
    expect(desc).toContain("Routing policy:");
  });

  it("discourages delegation for trivial reads, greps, and listings", () => {
    expect(desc).toContain("one direct file read");
    expect(desc).toContain("simple grep/find/bash listing");
  });

  it("discourages delegation when root already has enough context", () => {
    expect(desc).toContain("the root already has enough context to answer directly");
  });

  it("distinguishes explore vs general agents", () => {
    expect(desc).toContain('Use "explore" for read-only investigation');
    expect(desc).toContain('Use "general" for implementation');
  });

  it("mentions parallel and chain mode selection rules", () => {
    expect(desc).toContain("Parallel: only when subtasks are independent");
    expect(desc).toContain("Chain: only when step N genuinely depends on step N-1");
  });

  it("recommends explore defaults: spawnMode lean + returnMode summary", () => {
    expect(desc).toContain('explore: prefer spawnMode:"lean" + returnMode:"summary"');
  });

  it("recommends general defaults: spawnMode full + returnMode summary/artifact", () => {
    expect(desc).toContain('general: prefer spawnMode:"full"');
    expect(desc).toContain('returnMode:"summary" for orchestration, "artifact" for long outputs');
  });
});

// ─── buildPromptGuidelines routing policy ───

describe("buildPromptGuidelines routing-policy", () => {
  const guidelines = buildPromptGuidelines([exploreAgent(), generalAgent()]);

  it("discourages delegation for trivial reads and greps", () => {
    const hasTrivialGuideline = guidelines.some(
      (g) => g.includes("trivial one-step tasks") && g.includes("read/bash/grep directly"),
    );
    expect(hasTrivialGuideline).toBe(true);
  });

  it("discourages delegation when root already has enough context", () => {
    const hasContextGuideline = guidelines.some(
      (g) => g.includes("Do NOT delegate when the root already has enough context"),
    );
    expect(hasContextGuideline).toBe(true);
  });

  it("recommends explore for read-only investigation", () => {
    const hasExploreGuideline = guidelines.some(
      (g) =>
        g.includes("explore") &&
        g.includes("read-only investigation"),
    );
    expect(hasExploreGuideline).toBe(true);
  });

  it("recommends general for implementation/refactoring/debugging", () => {
    const hasGeneralGuideline = guidelines.some(
      (g) =>
        g.includes("general") &&
        (g.includes("implementation") || g.includes("refactoring") || g.includes("debugging")),
    );
    expect(hasGeneralGuideline).toBe(true);
  });

  it("mentions spawnMode guidance", () => {
    const hasSpawnGuideline = guidelines.some(
      (g) => g.includes("spawnMode"),
    );
    expect(hasSpawnGuideline).toBe(true);
  });

  it("mentions returnMode guidance", () => {
    const hasReturnGuideline = guidelines.some(
      (g) => g.includes("returnMode"),
    );
    expect(hasReturnGuideline).toBe(true);
  });

  it("mentions context for passing relevant files/findings", () => {
    const hasContextGuideline = guidelines.some(
      (g) => g.includes("context") && g.includes("save"),
    );
    expect(hasContextGuideline).toBe(true);
  });

  it("mentions parallel vs chain selection rules", () => {
    const hasParallelGuideline = guidelines.some(
      (g) => g.includes("parallel") && g.includes("independent"),
    );
    const hasChainGuideline = guidelines.some(
      (g) => g.includes("chain") && g.includes("depends on"),
    );
    expect(hasParallelGuideline).toBe(true);
    expect(hasChainGuideline).toBe(true);
  });

  it("mentions that returnMode:artifact is preferred for long outputs", () => {
    const hasArtifactGuideline = guidelines.some(
      (g) => g.includes("artifact") && g.includes("long outputs"),
    );
    expect(hasArtifactGuideline).toBe(true);
  });

  it("mentions that returnMode:inline is only for when root truly needs raw output", () => {
    const hasInlineGuideline = guidelines.some(
      (g) => g.includes("inline") && g.includes("raw") || g.includes("full raw"),
    );
    expect(hasInlineGuideline).toBe(true);
  });
});

// ─── Backward-compatibility checks ───

describe("backward compatibility", () => {
  it("buildAgentDescription still works with empty agents", () => {
    const desc = buildAgentDescription([]);
    expect(desc).toContain("No agents found");
    expect(desc).toContain("Routing policy:");
  });

  it("buildPromptGuidelines still works with empty agents", () => {
    const guidelines = buildPromptGuidelines([]);
    expect(guidelines.length).toBeGreaterThan(0);
    // Should not crash or add agent-specific lines
    const hasAgentSpecific = guidelines.some((g) => g.includes("pick the most specific agent from:"));
    expect(hasAgentSpecific).toBe(false);
  });

  it("buildAgentDescription includes all previous sections", () => {
    const desc = buildAgentDescription([exploreAgent()]);
    expect(desc).toContain("Available subagents:");
    expect(desc).toContain("Modes:");
    expect(desc).toContain("Output compaction");
    expect(desc).toContain("Spawn mode");
    expect(desc).toContain("Handoff context");
    expect(desc).toContain("Routing policy:");
  });

  it("buildPromptGuidelines includes all previous core guidelines", () => {
    const guidelines = buildPromptGuidelines([generalAgent()]);
    const hasModelGuideline = guidelines.some((g) => g.includes("provider prefix"));
    const hasThinkingGuideline = guidelines.some((g) => g.includes("thinking levels"));
    const hasTaskLangGuideline = guidelines.some((g) => g.includes("write the task text in English"));
    expect(hasModelGuideline).toBe(true);
    expect(hasThinkingGuideline).toBe(true);
    expect(hasTaskLangGuideline).toBe(true);
  });
});

// ─── Cache-stability (deterministic output) ───

describe("cache-stability: deterministic output", () => {
  it("buildAgentDescription produces identical output regardless of input agent order", () => {
    const a1 = makeAgent({ name: "alpha", description: "Agent A" });
    const a2 = makeAgent({ name: "beta", description: "Agent B" });
    const a3 = makeAgent({ name: "gamma", description: "Agent C" });

    const desc1 = buildAgentDescription([a1, a2, a3]);
    const desc2 = buildAgentDescription([a3, a2, a1]);
    const desc3 = buildAgentDescription([a2, a1, a3]);

    // All permutations should produce identical output
    expect(desc1).toBe(desc2);
    expect(desc2).toBe(desc3);
  });

  it("buildPromptGuidelines produces identical output regardless of input agent order", () => {
    const a1 = makeAgent({
      name: "alpha",
      taskCategories: ["code exploration"],
    });
    const a2 = makeAgent({
      name: "beta",
      taskCategories: ["implementation", "refactoring"],
    });

    const g1 = buildPromptGuidelines([a1, a2]);
    const g2 = buildPromptGuidelines([a2, a1]);

    expect(g1).toEqual(g2);
  });

  it("buildAgentDescription cache-stable comment is present", () => {
    // Read the source file to verify the cache-stability note exists
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../tools/subagent/descriptors.ts"),
      "utf-8",
    );
    expect(src).toContain("CACHE-STABILITY NOTE");
    expect(src).toContain("Agents are iterated in a stable, deterministic order");
    expect(src).toContain("Model lists are sorted alphabetically");
    expect(src).toContain("Dynamic sections (e.g. depth-limited warnings) appear at the end");
  });

  it("buildPromptGuidelines places cache-breaking depth warning after stable routing content", () => {
    const oldDepth = process.env.PI_SUBAGENT_DEPTH;
    const oldMaxDepth = process.env.PI_MAX_SUBAGENT_DEPTH;
    process.env.PI_SUBAGENT_DEPTH = "1";
    process.env.PI_MAX_SUBAGENT_DEPTH = "1";

    try {
      const guidelines = buildPromptGuidelines([exploreAgent(), generalAgent()]);
      const depthIdx = guidelines.findIndex((g) => g.includes("subagent depth"));
      const delegateIdx = guidelines.findIndex((g) => g.includes("Do NOT use subagent for trivial"));
      const contextIdx = guidelines.findIndex((g) => g.includes("This saves tokens"));

      expect(depthIdx).toBeGreaterThan(delegateIdx);
      expect(depthIdx).toBeGreaterThan(contextIdx);
    } finally {
      if (oldDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
      else process.env.PI_SUBAGENT_DEPTH = oldDepth;
      if (oldMaxDepth === undefined) delete process.env.PI_MAX_SUBAGENT_DEPTH;
      else process.env.PI_MAX_SUBAGENT_DEPTH = oldMaxDepth;
    }
  });

  it("agent names in description are sorted alphabetically", () => {
    const agents = [
      makeAgent({ name: "zed", description: "Z" }),
      makeAgent({ name: "alpha", description: "A" }),
      makeAgent({ name: "mike", description: "M" }),
    ];
    const desc = buildAgentDescription(agents);

    // Find positions of agent names in the description
    const alphaPos = desc.indexOf('"alpha"');
    const mikePos = desc.indexOf('"mike"');
    const zedPos = desc.indexOf('"zed"');

    expect(alphaPos).toBeLessThan(mikePos);
    expect(mikePos).toBeLessThan(zedPos);
  });

  it("agent names in guidelines are sorted alphabetically", () => {
    const agents = [
      makeAgent({
        name: "zed",
        taskCategories: ["testing"],
      }),
      makeAgent({
        name: "alpha",
        taskCategories: ["code exploration"],
      }),
      makeAgent({
        name: "mike",
        taskCategories: ["debugging"],
      }),
    ];
    const guidelines = buildPromptGuidelines(agents);

    // "When delegating, pick the most specific agent from: ..."
    const agentListLine = guidelines.find((g) => g.includes("pick the most specific agent from:"));
    expect(agentListLine).toBeDefined();
    if (agentListLine) {
      const alphaPos = agentListLine.indexOf('"alpha"');
      const mikePos = agentListLine.indexOf('"mike"');
      const zedPos = agentListLine.indexOf('"zed"');
      expect(alphaPos).toBeLessThan(mikePos);
      expect(mikePos).toBeLessThan(zedPos);
    }

    // Per-agent "excels at" lines should also be sorted
    const excelsLines = guidelines.filter((g) => g.includes("excels at:"));
    expect(excelsLines[0]).toContain('"alpha"');
    expect(excelsLines[1]).toContain('"mike"');
    expect(excelsLines[2]).toContain('"zed"');
  });

  it("task categories are formatted in deterministic alphabetical order", () => {
    const agent = makeAgent({
      name: "alpha",
      taskCategories: ["zeta", "beta", "alpha"],
    });

    const desc = buildAgentDescription([agent]);
    const guidelines = buildPromptGuidelines([agent]);

    expect(desc).toContain('[tasks: alpha, beta, zeta]');
    expect(guidelines.some((g) => g.includes('"alpha" excels at: alpha, beta, zeta'))).toBe(true);
  });
});
