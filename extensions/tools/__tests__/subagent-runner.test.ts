import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  withFileMutationQueue: async (_path: string, fn: () => Promise<void>) => fn(),
}));
vi.mock("../lib/config.js", () => ({
  getAgentModelConfig: () => ({}),
}));
vi.mock("../lib/invoke.js", () => ({
  getPiInvocation: () => ({ command: "pi", args: [] }),
}));

import { runSingleAgent } from "../tools/subagent/runner.js";
import type { AgentConfig } from "../lib/agents.js";
import type { SingleResult, SubagentDetails } from "../tools/subagent/types.js";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 43_210;
}

const agent: AgentConfig = {
  name: "test-agent",
  description: "test",
  systemPrompt: "",
  source: "builtin",
  filePath: "(test)",
};

function makeDetails(results: SingleResult[]): SubagentDetails {
  return { mode: "single", agentScope: "user", projectAgentsDir: null, results };
}

function run(
  child: FakeChild,
  options: { signal?: AbortSignal; timeoutMs?: number; onUpdate?: (result: SingleResult) => void } = {},
): Promise<SingleResult> {
  spawnMock.mockReturnValueOnce(child);
  return runSingleAgent(
    process.cwd(),
    [agent],
    agent.name,
    "test task",
    undefined,
    undefined,
    options.signal,
    options.onUpdate
      ? (partial) => options.onUpdate!(partial.details.results[0])
      : undefined,
    makeDetails,
    { modelRegistry: { getAll: () => [] } } as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options.timeoutMs,
  );
}

describe("runSingleAgent lifecycle", () => {
  let killSpy: any;

  beforeEach(() => {
    spawnMock.mockReset();
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    killSpy.mockRestore();
  });

  it("returns before spawning when the parent signal was already aborted", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    controller.abort();

    const result = await run(child, { signal: controller.signal });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.status).toBe("aborted");
    expect(result.errorMessage).toBe("Subagent was cancelled before it started.");
  });

  it("streams tool activity and heartbeats while the child is still running", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const updates: SingleResult[] = [];
    const resultPromise = run(child, { onUpdate: (result) => updates.push({ ...result }) });

    child.stdout.write(`${JSON.stringify({ type: "tool_execution_start", toolName: "bash" })}\n`);
    expect(updates[updates.length - 1]?.activity).toBe("running tool: bash");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(updates[updates.length - 1]?.elapsedMs).toBeGreaterThanOrEqual(5_000);
    expect(updates[updates.length - 1]?.activity).toBe("running tool: bash");

    child.emit("close", 0);
    const result = await resultPromise;
    expect(result.status).toBe("completed");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(5_000);
  });

  it("terminates the entire child process group on timeout and returns a controlled failure", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const resultPromise = run(child, { timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGKILL");

    child.emit("close", 143);
    const result = await resultPromise;
    expect(result.exitCode).toBe(124);
    expect(result.status).toBe("timed_out");
    expect(result.stopReason).toBe("timeout");
    expect(result.errorMessage).toContain("timeout");
  });

  it("returns an aborted result instead of throwing when the parent signal aborts", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const resultPromise = run(child, { signal: controller.signal });

    controller.abort();
    expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM");

    child.emit("close", 143);
    const result = await resultPromise;
    expect(result.status).toBe("aborted");
    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("Subagent was cancelled.");
  });
});
