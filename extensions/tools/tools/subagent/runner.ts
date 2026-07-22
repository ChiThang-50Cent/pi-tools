// ─── runner.ts ────── Subagent process spawning & streaming ──────────────
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { withFileMutationQueue, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../lib/agents.js";
import { getAgentModelConfig } from "../../lib/config.js";
import { getPiInvocation } from "../../lib/invoke.js";
import { getFinalOutput } from "./types.js";
import type { SingleResult, SubagentDetails } from "./types.js";
import { zeroUsage } from "./types.js";
import { buildSpawnPlan } from "./spawn.js";

/**
 * Resolve a model string to provider/modelId format.
 * If the model already has a provider prefix (contains '/'), returns as-is.
 * Otherwise, searches the model registry for a matching modelId.
 */
function resolveModelString(
  modelStr: string,
  ctx: ExtensionContext,
): string {
  // Already has provider prefix
  if (modelStr.includes("/")) return modelStr;

  // Try to find in registry
  const allModels = ctx.modelRegistry.getAll();
  const matches = allModels.filter((m) => m.id === modelStr);

  if (matches.length === 1) {
    // Unique model - use it
    return `${matches[0].provider}/${matches[0].id}`;
  }

  if (matches.length > 1) {
    // Multiple providers have this model - prefer the first one with auth
    const withAuth = matches.filter((m) => ctx.modelRegistry.hasConfiguredAuth(m));
    if (withAuth.length > 0) {
      return `${withAuth[0].provider}/${withAuth[0].id}`;
    }
    // No auth - use first match
    return `${matches[0].provider}/${matches[0].id}`;
  }

  // No match found - return as-is (will fail at spawn time)
  return modelStr;
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_SUBAGENT_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 5_000;
const TERMINATION_GRACE_MS = 5_000;
export const MAX_SUBAGENT_CAPTURE_BYTES = 1 * 1024 * 1024;

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return new StringDecoder("utf8").write(Buffer.from(value, "utf8").subarray(0, maxBytes));
}

function clampTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SUBAGENT_TIMEOUT_MS;
  return Math.min(MAX_SUBAGENT_TIMEOUT_MS, Math.max(1_000, Math.floor(value)));
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function signalProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (!proc.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-proc.pid, signal);
    } else {
      proc.kill(signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  });
  return { dir: tmpDir, filePath };
}

export async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  ctx: ExtensionContext,
  modelOverride?: string,
  thinkingOverride?: string,
  spawnModeOverride?: string,
  handoffContextChars?: number,
  handoffContextTruncated?: boolean,
  timeoutMs?: number,
): Promise<SingleResult> {
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: zeroUsage(),
      step,
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  // Phase 3: lean-spawn plan — add spawn flags before model/tools args
  const spawnPlan = buildSpawnPlan(agent, spawnModeOverride);
  if (spawnPlan.flags.length > 0) args.push(...spawnPlan.flags);

  // Model resolution: task override > tool-level override > tools.json config > agent frontmatter > inherit
  const agentCfg = getAgentModelConfig(agentName, agent.model, agent.thinking);
  const rawModel = modelOverride ?? agentCfg.model;
  const resolvedThinking = thinkingOverride ?? agentCfg.thinking;
  // Resolve model to provider/modelId format
  const resolvedModel = rawModel ? resolveModelString(rawModel, ctx) : undefined;
  if (resolvedModel) {
    args.push("--model", resolvedModel);
  }
  if (resolvedThinking) {
    args.push("--thinking", resolvedThinking);
  }

  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  const currentResult: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: zeroUsage(),
    model: resolvedModel ?? agent.model,
    step,
    spawnMode: spawnPlan.mode,
    spawnFlags: spawnPlan.flags.length > 0 ? spawnPlan.flags : undefined,
    spawnNotes: spawnPlan.notes.length > 0 ? spawnPlan.notes : undefined,
    handoffContextChars,
    handoffContextTruncated,
    status: "running",
    activity: "starting",
    elapsedMs: 0,
    timeoutMs: clampTimeoutMs(timeoutMs),
  };
  const startedAt = Date.now();
  let lastProgressEmitAt = 0;

  const emitUpdate = () => {
    if (!onUpdate) return;
    lastProgressEmitAt = Date.now();
    currentResult.elapsedMs = Date.now() - startedAt;
    const progress = `Running for ${formatElapsed(currentResult.elapsedMs)} — ${currentResult.activity ?? "working"}`;
    const latestOutput = getFinalOutput(currentResult.messages);
    onUpdate({
      content: [{ type: "text", text: latestOutput ? `${progress}\n\nLatest assistant output:\n${latestOutput}` : progress }],
      details: makeDetails([currentResult]),
    });
  };

  if (signal?.aborted) {
    currentResult.exitCode = 1;
    currentResult.status = "aborted";
    currentResult.stopReason = "aborted";
    currentResult.errorMessage = "Subagent was cancelled before it started.";
    currentResult.activity = "cancelled before start";
    currentResult.elapsedMs = Date.now() - startedAt;
    return currentResult;
  }

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);

    const outcome = await new Promise<{ exitCode: number; reason?: "aborted" | "timed_out" }>((resolve) => {
      const invocation = getPiInvocation(args);
      const parentDepth = parseInt(process.env.PI_SUBAGENT_DEPTH ?? "", 10);
      const childDepth = (Number.isFinite(parentDepth) ? parentDepth : 0) + 1;
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_SUBAGENT_DEPTH: String(childDepth) },
      });
      let buffer = "";
      let bufferBytes = 0;
      let discardCurrentLine = false;
      let stdoutTruncated = false;
      let transcriptBytes = 0;
      let transcriptTruncated = false;
      let stderrTruncated = false;
      let stderrCapture = "";
      const truncationNotices: string[] = [];
      const stderrTruncationMarker = `[subagent stderr truncated after ${MAX_SUBAGENT_CAPTURE_BYTES} bytes]\n`;
      let settled = false;
      let terminationReason: "aborted" | "timed_out" | undefined;
      let lastActivityAt = Date.now();
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout>;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const updateActivity = (activity: string, forceUpdate = true) => {
        currentResult.activity = activity;
        lastActivityAt = Date.now();
        if (forceUpdate || Date.now() - lastProgressEmitAt >= 500) emitUpdate();
      };

      const refreshStderr = () => {
        const notices = truncationNotices.join("");
        let captureLimit = MAX_SUBAGENT_CAPTURE_BYTES - Buffer.byteLength(notices, "utf8");
        if (!stderrTruncated && Buffer.byteLength(stderrCapture, "utf8") > captureLimit) {
          stderrTruncated = true;
        }
        if (stderrTruncated) captureLimit -= Buffer.byteLength(stderrTruncationMarker, "utf8");
        currentResult.stderr = `${truncateUtf8(stderrCapture, Math.max(0, captureLimit))}${stderrTruncated ? stderrTruncationMarker : ""}${notices}`;
      };

      const appendStderr = (text: string) => {
        if (!text || stderrTruncated) return;
        const noticesBytes = Buffer.byteLength(truncationNotices.join(""), "utf8");
        if (Buffer.byteLength(stderrCapture, "utf8") + Buffer.byteLength(text, "utf8") <= MAX_SUBAGENT_CAPTURE_BYTES - noticesBytes) {
          stderrCapture += text;
        } else {
          stderrCapture = truncateUtf8(
            `${stderrCapture}${text}`,
            MAX_SUBAGENT_CAPTURE_BYTES - noticesBytes - Buffer.byteLength(stderrTruncationMarker, "utf8"),
          );
          stderrTruncated = true;
        }
        refreshStderr();
      };

      const appendTruncationNotice = (kind: "stdout" | "transcript") => {
        const notice = `[subagent ${kind} truncated after ${MAX_SUBAGENT_CAPTURE_BYTES} bytes]\n`;
        if (!truncationNotices.includes(notice)) truncationNotices.push(notice);
        refreshStderr();
      };

      const recordMessage = (message: Message) => {
        if (transcriptTruncated) return;
        let messageBytes = MAX_SUBAGENT_CAPTURE_BYTES + 1;
        try {
          messageBytes = Buffer.byteLength(JSON.stringify(message) ?? "", "utf8");
        } catch {
          // Messages come from JSON, so this is only a defensive fallback.
        }
        if (transcriptBytes + messageBytes > MAX_SUBAGENT_CAPTURE_BYTES) {
          transcriptTruncated = true;
          appendTruncationNotice("transcript");
          return;
        }
        currentResult.messages.push(message);
        transcriptBytes += messageBytes;
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "agent_start" || event.type === "turn_start") updateActivity("thinking");
        if (event.type === "message_update") updateActivity("streaming response", false);
        if (event.type === "tool_execution_start") updateActivity(`running tool: ${String(event.toolName ?? "unknown")}`);
        if (event.type === "tool_execution_update") updateActivity(`receiving update from tool: ${String(event.toolName ?? "unknown")}`, false);
        if (event.type === "tool_execution_end") updateActivity(`${event.isError ? "tool failed" : "tool finished"}: ${String(event.toolName ?? "unknown")}`);
        if (event.type === "agent_end") updateActivity("finalizing result");

        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          recordMessage(msg);

          if (msg.role === "assistant") {
            currentResult.usage.turns++;
            const usage = msg.usage;
            if (usage) {
              currentResult.usage.input += usage.input || 0;
              currentResult.usage.output += usage.output || 0;
              currentResult.usage.cacheRead += usage.cacheRead || 0;
              currentResult.usage.cacheWrite += usage.cacheWrite || 0;
              currentResult.usage.cost += usage.cost?.total || 0;
              currentResult.usage.contextTokens = usage.totalTokens || 0;
            }
            if (!currentResult.model && msg.model) currentResult.model = msg.model;
            if (msg.stopReason) currentResult.stopReason = msg.stopReason;
            if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
          }
          updateActivity("processing completed message");
        }

        // Older pi JSON streams may use this event instead of message_end for tool results.
        if (event.type === "tool_result_end" && event.message) {
          recordMessage(event.message as Message);
          updateActivity("processing tool result");
        }
      };

      const processStdoutChunk = (data: Buffer | string) => {
        const chunk = data.toString();
        let offset = 0;
        while (offset <= chunk.length) {
          const newline = chunk.indexOf("\n", offset);
          const linePart = chunk.slice(offset, newline === -1 ? chunk.length : newline);

          if (discardCurrentLine) {
            if (newline === -1) return;
            discardCurrentLine = false;
            offset = newline + 1;
            continue;
          }

          const linePartBytes = Buffer.byteLength(linePart, "utf8");
          if (bufferBytes + linePartBytes > MAX_SUBAGENT_CAPTURE_BYTES) {
            if (!stdoutTruncated) {
              stdoutTruncated = true;
              appendTruncationNotice("stdout");
            }
            buffer = "";
            bufferBytes = 0;
            if (newline === -1) discardCurrentLine = true;
            else offset = newline + 1;
            continue;
          }

          buffer += linePart;
          bufferBytes += linePartBytes;
          if (newline === -1) return;

          processLine(buffer);
          buffer = "";
          bufferBytes = 0;
          offset = newline + 1;
        }
      };

      const onStdoutData = (data: Buffer | string) => processStdoutChunk(data);
      const onStderrData = (data: Buffer | string) => {
        appendStderr(data.toString());
        updateActivity("receiving process diagnostics");
      };

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (heartbeat) clearInterval(heartbeat);
        signal?.removeEventListener("abort", abortChild);
        proc.stdout?.removeListener("data", onStdoutData);
        proc.stderr?.removeListener("data", onStderrData);
        proc.removeListener("close", onClose);
        proc.removeListener("exit", onExit);
        proc.removeListener("error", onError);
        proc.stdout?.destroy();
        proc.stderr?.destroy();
      };

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ exitCode, reason: terminationReason });
      };

      const terminate = (reason: "aborted" | "timed_out") => {
        if (settled || terminationReason) return;
        terminationReason = reason;
        updateActivity(reason === "timed_out" ? "timed out; stopping process" : "cancelled; stopping process");
        forceKillTimer = setTimeout(() => {
          if (settled) return;
          try {
            signalProcessTree(proc, "SIGKILL");
          } catch (error) {
            appendStderr(`Failed to send SIGKILL: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          // Do not wait for `close`: descendants can keep inherited pipes open.
          finish(137);
        }, TERMINATION_GRACE_MS);
        try {
          signalProcessTree(proc, "SIGTERM");
        } catch (error) {
          appendStderr(`Failed to send SIGTERM: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      };

      const abortChild = () => terminate("aborted");
      timeoutTimer = setTimeout(() => terminate("timed_out"), currentResult.timeoutMs);
      heartbeat = onUpdate
        ? setInterval(() => {
            if (settled) return;
            const quietFor = Date.now() - lastActivityAt;
            const quietNote = quietFor >= HEARTBEAT_MS ? `; no child event for ${formatElapsed(quietFor)}` : "";
            currentResult.elapsedMs = Date.now() - startedAt;
            const progress = `Running for ${formatElapsed(currentResult.elapsedMs)} — ${currentResult.activity ?? "working"}${quietNote}`;
            const latestOutput = getFinalOutput(currentResult.messages);
            onUpdate({
              content: [{ type: "text", text: latestOutput ? `${progress}\n\nLatest assistant output:\n${latestOutput}` : progress }],
              details: makeDetails([currentResult]),
            });
          }, HEARTBEAT_MS)
        : undefined;

      const onClose = (code: number | null) => {
        if (!discardCurrentLine && buffer.trim()) processLine(buffer);
        finish(code ?? 0);
      };
      const onExit = (code: number | null) => {
        if (terminationReason) finish(code ?? 0);
      };
      const onError = (error: Error) => {
        appendStderr(`${error.message}\n`);
        finish(1);
      };

      proc.stdout.on("data", onStdoutData);
      proc.stderr.on("data", onStderrData);
      proc.on("close", onClose);
      proc.on("exit", onExit);
      proc.on("error", onError);

      if (signal?.aborted) abortChild();
      else signal?.addEventListener("abort", abortChild, { once: true });
      updateActivity("starting agent process");
    });

    currentResult.elapsedMs = Date.now() - startedAt;
    currentResult.exitCode = outcome.reason === "timed_out" ? 124 : outcome.exitCode;
    if (outcome.reason === "timed_out") {
      currentResult.status = "timed_out";
      currentResult.stopReason = "timeout";
      currentResult.errorMessage = `Subagent exceeded its ${formatElapsed(currentResult.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS)} timeout.`;
    } else if (outcome.reason === "aborted") {
      currentResult.status = "aborted";
      currentResult.stopReason = "aborted";
      currentResult.errorMessage = "Subagent was cancelled.";
    } else {
      currentResult.status = outcome.exitCode === 0 ? "completed" : "failed";
    }
    return currentResult;
  } finally {
    if (tmpPromptPath)
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    if (tmpPromptDir)
      try {
        fs.rmSync(tmpPromptDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
  }
}
