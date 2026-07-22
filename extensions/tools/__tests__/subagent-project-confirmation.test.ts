// ─── subagent-project-confirmation.test.ts ──── Project-agent confirmation tests
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  getEnabledModels: vi.fn(() => []),
  runSingleAgent: vi.fn(),
}));

vi.mock("../lib/agents.js", () => ({ discoverAgents: mocks.discoverAgents }));
vi.mock("../lib/config.js", () => ({
  loadConfig: mocks.loadConfig,
  getEnabledModels: mocks.getEnabledModels,
}));
vi.mock("../tools/subagent/runner.js", () => ({ runSingleAgent: mocks.runSingleAgent }));
vi.mock("../tools/subagent/render.js", () => ({
  renderCall: vi.fn(),
  renderResult: vi.fn(),
}));
vi.mock("../tools/subagent/schemas.js", () => ({ SubagentParams: {} }));

import registerSubagent from "../tools/subagent/index.js";
import type { AgentConfig } from "../lib/agents.js";

const projectAgent: AgentConfig = {
  name: "project-agent",
  description: "A project-local test agent.",
  systemPrompt: "You are a project-local test agent.",
  source: "project",
  filePath: "/repo/.pi/agents/project-agent.md",
};

const completedResult = {
  agent: projectAgent.name,
  agentSource: "project" as const,
  task: "test task",
  exitCode: 0,
  messages: [],
  stderr: "",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
};

function getTool() {
  const pi = { registerTool: vi.fn() } as any;
  registerSubagent(pi);
  return pi.registerTool.mock.calls[0][0] as { execute: (...args: any[]) => Promise<any> };
}

function makeContext(hasUI: boolean, approved = true) {
  return {
    cwd: "/repo",
    hasUI,
    ui: { confirm: vi.fn().mockResolvedValue(approved) },
  };
}

const initialSubagentDepth = process.env.PI_SUBAGENT_DEPTH;

beforeEach(() => {
  process.env.PI_SUBAGENT_DEPTH = "0";
  mocks.discoverAgents.mockReset();
  mocks.discoverAgents.mockReturnValue({
    agents: [projectAgent],
    projectAgentsDir: "/repo/.pi/agents",
  });
  mocks.runSingleAgent.mockReset();
  mocks.runSingleAgent.mockResolvedValue(completedResult);
});

afterEach(() => {
  if (initialSubagentDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
  else process.env.PI_SUBAGENT_DEPTH = initialSubagentDepth;
});

describe("project-local agent confirmation", () => {
  it("fails closed in headless mode before spawning when confirmation is required", async () => {
    const tool = getTool();
    const ctx = makeContext(false);

    const result = await tool.execute("call-1", {
      agent: projectAgent.name,
      task: "test task",
      agentScope: "project",
    }, undefined, undefined, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("without interactive confirmation");
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(mocks.runSingleAgent).not.toHaveBeenCalled();
  });

  it("allows headless spawning when confirmation is explicitly disabled", async () => {
    const tool = getTool();

    await tool.execute("call-1", {
      agent: projectAgent.name,
      task: "test task",
      agentScope: "project",
      confirmProjectAgents: false,
    }, undefined, undefined, makeContext(false));

    expect(mocks.runSingleAgent).toHaveBeenCalledTimes(1);
  });

  it("preserves interactive approval before spawning", async () => {
    const tool = getTool();
    const ctx = makeContext(true, true);

    await tool.execute("call-1", {
      agent: projectAgent.name,
      task: "test task",
      agentScope: "project",
    }, undefined, undefined, ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Run project-local agents?",
      expect.stringContaining("Agents: project-agent"),
    );
    expect(mocks.runSingleAgent).toHaveBeenCalledTimes(1);
  });

  it("preserves interactive denial without spawning", async () => {
    const tool = getTool();
    const ctx = makeContext(true, false);

    const result = await tool.execute("call-1", {
      agent: projectAgent.name,
      task: "test task",
      agentScope: "project",
    }, undefined, undefined, ctx);

    expect(result.content[0].text).toBe("Canceled: project-local agents not approved.");
    expect(mocks.runSingleAgent).not.toHaveBeenCalled();
  });
});
