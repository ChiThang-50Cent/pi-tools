// ─── subagent-output-contract.test.ts ──── Parent-facing output contract tests
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";

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
vi.mock("../tools/subagent/render.js", () => ({ renderCall: vi.fn(), renderResult: vi.fn() }));
vi.mock("../tools/subagent/schemas.js", () => ({ SubagentParams: {} }));

import registerSubagent from "../tools/subagent/index.js";
import type { AgentConfig } from "../lib/agents.js";

const agent: AgentConfig = {
  name: "test-agent",
  description: "A test agent.",
  systemPrompt: "You are a test agent.",
  source: "builtin",
  filePath: "(test)",
};

const baseResult = {
  agent: agent.name,
  agentSource: "builtin" as const,
  task: "test task",
  exitCode: 0,
  messages: [],
  stderr: "",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
};

function resultWithOutput(text: string, overrides: Record<string, unknown> = {}) {
  return {
    ...baseResult,
    messages: [{ role: "assistant", content: [{ type: "text", text }] }],
    ...overrides,
  };
}

function getTool() {
  const pi = { registerTool: vi.fn() } as any;
  registerSubagent(pi);
  return pi.registerTool.mock.calls[0][0] as { execute: (...args: any[]) => Promise<any> };
}

function makeContext() {
  return { cwd: "/repo", hasUI: false };
}

beforeEach(() => {
  process.env.PI_SUBAGENT_DEPTH = "0";
  mocks.discoverAgents.mockReset();
  mocks.discoverAgents.mockReturnValue({ agents: [agent], projectAgentsDir: null });
  mocks.runSingleAgent.mockReset();
});

afterEach(() => {
  delete process.env.PI_SUBAGENT_DEPTH;
});

describe("chain failure output contract", () => {
  it("compacts a large failure in summary mode", async () => {
    const failureText = "chain-failure-".repeat(1000);
    mocks.runSingleAgent
      .mockResolvedValueOnce(resultWithOutput("first step", { step: 1 }))
      .mockResolvedValueOnce(resultWithOutput("ignored transcript", {
        step: 2,
        exitCode: 1,
        stopReason: "error",
        errorMessage: failureText,
      }));

    const result = await getTool().execute("call-1", {
      chain: [
        { agent: agent.name, task: "first" },
        { agent: agent.name, task: "second" },
      ],
      returnMode: "summary",
      summaryMaxChars: 32,
    }, undefined, undefined, makeContext());

    expect(result.isError).toBe(true);
    expect(result.details.returnMode).toBe("summary");
    expect(result.content[0].text).toContain("...[truncated]");
    expect(result.content[0].text).not.toContain(failureText);
  });

  it("writes full chain failure output in artifact mode", async () => {
    const failureText = "chain-failure-".repeat(1000);
    mocks.runSingleAgent
      .mockResolvedValueOnce(resultWithOutput("first step", { step: 1 }))
      .mockResolvedValueOnce(resultWithOutput("ignored transcript", {
        step: 2,
        exitCode: 1,
        stopReason: "error",
        errorMessage: failureText,
      }));

    const result = await getTool().execute("call-1", {
      chain: [
        { agent: agent.name, task: "first" },
        { agent: agent.name, task: "second" },
      ],
      returnMode: "artifact",
    }, undefined, undefined, makeContext());

    expect(result.isError).toBe(true);
    expect(result.details.returnMode).toBe("artifact");
    expect(result.details.artifacts).toHaveLength(2);
    expect(result.content[0].text).toContain("Artifacts (full output)");
    expect(result.content[0].text).not.toContain(failureText);
    expect(fs.readFileSync(result.details.artifacts[1].path, "utf8")).toContain(failureText);
  });
});
