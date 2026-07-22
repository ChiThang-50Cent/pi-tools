import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());
const getPiInvocationMock = vi.hoisted(() => vi.fn(() => ({ command: "pi", args: [] })));

vi.mock("node:child_process", () => ({ spawn: spawnMock, execFile: execFileMock }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  withFileMutationQueue: async (_path: string, fn: () => Promise<void>) => fn(),
}));
vi.mock("../lib/config.js", () => ({
  getAgentModelConfig: () => ({}),
}));
vi.mock("../lib/invoke.js", () => ({
  getPiInvocation: getPiInvocationMock,
}));

import { MAX_SUBAGENT_CAPTURE_BYTES, runSingleAgent } from "../tools/subagent/runner.js";
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
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onUpdate?: (result: SingleResult) => void;
    model?: { provider: string; id: string };
    modelOverride?: string;
  } = {},
  runAgent: AgentConfig = agent,
): Promise<SingleResult> {
  spawnMock.mockReturnValueOnce(child);
  return runSingleAgent(
    process.cwd(),
    [runAgent],
    runAgent.name,
    "test task",
    undefined,
    undefined,
    options.signal,
    options.onUpdate
      ? (partial) => options.onUpdate!(partial.details.results[0])
      : undefined,
    makeDetails,
    { modelRegistry: { getAll: () => [] }, model: options.model } as any,
    options.modelOverride,
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
    execFileMock.mockReset();
    getPiInvocationMock.mockClear();
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

  it("cleans up the prompt directory when prompt setup fails", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-test-"));
    const setupError = new Error("prompt setup failed");
    const mkdtempSpy = vi.spyOn(fs.promises, "mkdtemp").mockResolvedValue(tempDir);
    const writeFileSpy = vi.spyOn(fs.promises, "writeFile").mockRejectedValue(setupError);
    const promptAgent = { ...agent, systemPrompt: "system prompt" };

    try {
      await expect(run(new FakeChild(), {}, promptAgent)).rejects.toThrow(setupError);
      await expect(fs.promises.stat(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      mkdtempSpy.mockRestore();
      writeFileSpy.mockRestore();
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not spawn when aborted during awaited prompt setup and cleans up late setup", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-test-"));
    const promptAgent = { ...agent, systemPrompt: "system prompt" };
    const controller = new AbortController();
    let setupStarted!: () => void;
    let releaseSetup!: () => void;
    let setupFinished!: () => void;
    const setupStartedPromise = new Promise<void>((resolve) => { setupStarted = resolve; });
    const setupReleasePromise = new Promise<void>((resolve) => { releaseSetup = resolve; });
    const setupFinishedPromise = new Promise<void>((resolve) => { setupFinished = resolve; });
    const mkdtempSpy = vi.spyOn(fs.promises, "mkdtemp").mockResolvedValue(tempDir);
    const writeFileSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async () => {
      setupStarted();
      await setupReleasePromise;
      setupFinished();
    });

    try {
      const resultPromise = run(new FakeChild(), { signal: controller.signal }, promptAgent);
      await setupStartedPromise;
      controller.abort();

      const result = await resultPromise;
      expect(spawnMock).not.toHaveBeenCalled();
      expect(result.status).toBe("aborted");
      expect(result.errorMessage).toBe("Subagent was cancelled before it started.");
      await expect(fs.promises.stat(tempDir)).resolves.toBeDefined();

      releaseSetup();
      await setupFinishedPromise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fs.existsSync(tempDir)).toBe(false);
      await expect(fs.promises.stat(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      mkdtempSpy.mockRestore();
      writeFileSpy.mockRestore();
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("times out during blocked prompt setup without spawning and cleans up the late temp directory", async () => {
    vi.useFakeTimers();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-test-"));
    const promptAgent = { ...agent, systemPrompt: "system prompt" };
    let setupStarted!: () => void;
    let releaseSetup!: () => void;
    let setupFinished!: () => void;
    const setupStartedPromise = new Promise<void>((resolve) => { setupStarted = resolve; });
    const setupReleasePromise = new Promise<void>((resolve) => { releaseSetup = resolve; });
    const setupFinishedPromise = new Promise<void>((resolve) => { setupFinished = resolve; });
    const mkdtempSpy = vi.spyOn(fs.promises, "mkdtemp").mockResolvedValue(tempDir);
    const writeFileSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async () => {
      setupStarted();
      await setupReleasePromise;
      setupFinished();
    });

    try {
      const resultPromise = run(new FakeChild(), { timeoutMs: 1_000 }, promptAgent);
      await setupStartedPromise;
      await vi.advanceTimersByTimeAsync(1_000);

      const result = await resultPromise;
      expect(spawnMock).not.toHaveBeenCalled();
      expect(result.status).toBe("timed_out");
      expect(result.stopReason).toBe("timeout");
      expect(result.exitCode).toBe(124);
      await expect(fs.promises.stat(tempDir)).resolves.toBeDefined();

      releaseSetup();
      await setupFinishedPromise;
      await vi.runAllTimersAsync();
      expect(fs.existsSync(tempDir)).toBe(false);
      await expect(fs.promises.stat(tempDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      mkdtempSpy.mockRestore();
      writeFileSpy.mockRestore();
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("starts the child with only the remaining timeout after prompt setup", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const promptAgent = { ...agent, systemPrompt: "system prompt" };
    let setupStarted!: () => void;
    let releaseSetup!: () => void;
    const setupStartedPromise = new Promise<void>((resolve) => { setupStarted = resolve; });
    const setupReleasePromise = new Promise<void>((resolve) => { releaseSetup = resolve; });
    const writeFileSpy = vi.spyOn(fs.promises, "writeFile").mockImplementation(async () => {
      setupStarted();
      await setupReleasePromise;
    });

    try {
      const resultPromise = run(child, { timeoutMs: 1_000 }, promptAgent);
      await setupStartedPromise;
      await vi.advanceTimersByTimeAsync(600);
      releaseSetup();
      await vi.advanceTimersByTimeAsync(0);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(399);
      expect(killSpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM");

      child.emit("close", null, "SIGTERM");
      const result = await resultPromise;
      expect(result.status).toBe("timed_out");
      expect(result.exitCode).toBe(124);
    } finally {
      writeFileSpy.mockRestore();
    }
  });

  it("inherits the active parent model when no model override is configured", async () => {
    const child = new FakeChild();
    const resultPromise = run(child, { model: { provider: "parent-provider", id: "parent-model" } });
    child.emit("close", 0);

    await resultPromise;
    expect(getPiInvocationMock.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      "--model",
      "parent-provider/parent-model",
    ]));
  });

  it("preserves an explicit model override over the active parent model", async () => {
    const child = new FakeChild();
    const resultPromise = run(child, {
      model: { provider: "parent-provider", id: "parent-model" },
      modelOverride: "override-provider/override-model",
    });
    child.emit("close", 0);

    await resultPromise;
    expect(getPiInvocationMock.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      "--model",
      "override-provider/override-model",
    ]));
    expect(getPiInvocationMock.mock.calls[0]?.[0]).not.toContain("parent-provider/parent-model");
  });

  it("streams split UTF-8 output without replacement characters", async () => {
    const child = new FakeChild();
    const resultPromise = run(child);
    const stdout = Buffer.from(`${JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "split 🚀" }] },
    })}\n`);
    const stdoutEmoji = Buffer.from("🚀");
    const stdoutSplit = stdout.indexOf(stdoutEmoji) + 1;
    child.stdout.write(stdout.subarray(0, stdoutSplit));
    child.stdout.write(stdout.subarray(stdoutSplit));

    const stderr = Buffer.from("diagnostic 🚀");
    const stderrEmoji = Buffer.from("🚀");
    const stderrSplit = stderr.indexOf(stderrEmoji) + 1;
    child.stderr.write(stderr.subarray(0, stderrSplit));
    child.stderr.write(stderr.subarray(stderrSplit));
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.status).toBe("completed");
    expect(result.messages[0]?.content[0]).toEqual({ type: "text", text: "split 🚀" });
    expect(result.stderr).toBe("diagnostic 🚀");
  });

  it("classifies an externally signal-terminated child as failed", async () => {
    const child = new FakeChild();
    const resultPromise = run(child);
    child.emit("close", null, "SIGTERM");

    const result = await resultPromise;
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toBe("Subagent terminated by signal SIGTERM.");
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

    const result = await resultPromise;
    expect(result.exitCode).toBe(124);
    expect(result.status).toBe("timed_out");
    expect(result.stopReason).toBe("timeout");
    expect(result.errorMessage).toContain("timeout");
  });

  it("uses taskkill to terminate the Windows child process tree", async () => {
    vi.useFakeTimers();
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      const child = new FakeChild();
      const resultPromise = run(child, { timeoutMs: 1_000 });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(execFileMock).toHaveBeenNthCalledWith(
        1,
        "taskkill",
        ["/PID", String(child.pid), "/T"],
        { shell: false, windowsHide: true },
        expect.any(Function),
      );
      expect(killSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(execFileMock).toHaveBeenNthCalledWith(
        2,
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true },
        expect.any(Function),
      );

      const result = await resultPromise;
      expect(result.status).toBe("timed_out");
      expect(result.exitCode).toBe(124);
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("settles on child exit after abort even when descendants keep stdio pipes open", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const resultPromise = run(child, { signal: controller.signal });

    controller.abort();
    child.emit("exit", 143);

    const result = await resultPromise;
    expect(result.status).toBe("aborted");
    expect(result.stopReason).toBe("aborted");
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
  });

  it("bounds stdout, stderr, and transcript captures with diagnostics", async () => {
    const child = new FakeChild();
    const message = (text: string) => ({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });

    const resultPromise = run(child);
    child.stdout.write(`${"x".repeat(MAX_SUBAGENT_CAPTURE_BYTES + 1)}\n${JSON.stringify(message("kept"))}\n`);
    child.stderr.write("🚀".repeat(Math.ceil((MAX_SUBAGENT_CAPTURE_BYTES + 1) / 4)));
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.messages).toHaveLength(1);
    expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(MAX_SUBAGENT_CAPTURE_BYTES);
    expect(result.stderr).toContain("[subagent stdout truncated");
    expect(result.stderr).toContain("[subagent stderr truncated");

    const transcriptChild = new FakeChild();
    const largeText = "t".repeat(Math.floor(MAX_SUBAGENT_CAPTURE_BYTES * 0.6));
    const transcriptPromise = run(transcriptChild);
    transcriptChild.stdout.write(`${JSON.stringify(message(largeText))}\n${JSON.stringify(message(largeText))}\n`);
    transcriptChild.emit("close", 0);

    const transcriptResult = await transcriptPromise;
    expect(transcriptResult.messages).toHaveLength(1);
    expect(transcriptResult.stderr).toContain("[subagent transcript truncated");
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
