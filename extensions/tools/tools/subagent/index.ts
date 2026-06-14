// ─── index.ts ────── Subagent tool registration ─────────────────────────
/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 *
 * Return modes (Phase 1 — compact return):
 *   - auto: heuristic based on output size (default)
 *   - inline: current behavior — full output in content
 *   - summary: compact preview in content, full data in details
 *   - artifact: write full output to temp file, return path in content
 *
 * Chain handoff (Phase 4 — compact chain handoff):
 *   - compact (default): truncated {previous} to reduce token blow-up
 *   - full: current behavior — unbounded {previous}
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentScope, AgentConfig } from "../../lib/agents.js";
import { discoverAgents } from "../../lib/agents.js";
import { loadConfig } from "../../lib/config.js";
import { mapWithConcurrencyLimit } from "../../lib/concurrency.js";
import { buildAgentDescription, buildPromptGuidelines } from "./descriptors.js";
import { renderCall, renderResult } from "./render.js";
import { runSingleAgent } from "./runner.js";
import { SubagentParams } from "./schemas.js";
import type { OnUpdateCallback } from "./runner.js";
import { getFinalOutput, getResultOutput, isFailedResult } from "./types.js";
import type { SingleResult, SubagentDetails } from "./types.js";
import {
  compactChainHandoff,
  getEffectiveReturnMode,
  writeArtifactsForResults,
  buildSingleRootContent,
  buildParallelRootContent,
  buildChainRootContent,
} from "./output.js";
import { buildDelegatedTask, DEFAULT_CONTEXT_MAX_CHARS } from "./handoff.js";
import type { ArtifactEntry } from "./types.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

/** Default constants for compact output */
const DEFAULT_SUMMARY_MAX_CHARS = 1200;
const DEFAULT_ARTIFACT_THRESHOLD_CHARS = 4000;
const DEFAULT_CHAIN_HANDOFF_MAX_CHARS = 4000;

/** Max subagent nesting depth. Env var PI_MAX_SUBAGENT_DEPTH takes priority over tools.json maxSubagentDepth. Default 1. */
function getMaxSubagentDepth(): number {
  const env = parseInt(process.env.PI_MAX_SUBAGENT_DEPTH ?? "", 10);
  if (Number.isFinite(env) && env >= 0) return env;
  const config = loadConfig().maxSubagentDepth;
  if (config !== undefined && Number.isFinite(config) && config >= 0) return config;
  return 1;
}

function getCurrentSubagentDepth(): number {
  const depth = parseInt(process.env.PI_SUBAGENT_DEPTH ?? "", 10);
  return Number.isFinite(depth) && depth >= 0 ? depth : 0;
}

export default function (pi: ExtensionAPI) {
  // Discover agents at registration time (files are static, /reload picks up changes)
  const userAgents = discoverAgents(process.cwd(), "both");
  const agents = userAgents.agents;

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: buildAgentDescription(agents),
    // Agent list is sorted by name for prompt-cache stability (see agents.ts discoverAgents)
    promptSnippet: `Delegate tasks to subagents (${agents.length > 0 ? agents.map(a => a.name).join(", ") : "none available"}) with isolated context windows`,
    promptGuidelines: buildPromptGuidelines(agents),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const currentDepth = getCurrentSubagentDepth();
      const maxDepth = getMaxSubagentDepth();
      if (currentDepth >= maxDepth) {
        return {
          content: [
            {
              type: "text",
              text: `Subagent nesting limit reached (depth ${currentDepth}, max ${maxDepth}). Cannot spawn subagent from within a subagent.`,
            },
          ],
          details: { mode: "single", agentScope: "user", projectAgentsDir: null, results: [] },
          isError: true,
        };
      }

      const agentScope: AgentScope = params.agentScope ?? "user";
      const discovery = discoverAgents(ctx.cwd, agentScope);
      const agents = discovery.agents;
      const confirmProjectAgents = params.confirmProjectAgents ?? true;

      // Parse new compact-output params with defaults
      const returnMode = params.returnMode ?? "auto";
      const summaryMaxChars = params.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS;
      const artifactThresholdChars = params.artifactThresholdChars ?? DEFAULT_ARTIFACT_THRESHOLD_CHARS;
      const chainHandoffMode = params.chainHandoffMode ?? "compact";
      const chainHandoffMaxChars = params.chainHandoffMaxChars ?? DEFAULT_CHAIN_HANDOFF_MAX_CHARS;

      // Handoff context: top-level fallback + character budget
      const topContext = params.context;
      const contextMaxChars = params.contextMaxChars ?? DEFAULT_CONTEXT_MAX_CHARS;

      const hasChain = (params.chain?.length ?? 0) > 0;
      const hasTasks = (params.tasks?.length ?? 0) > 0;
      const hasSingle = Boolean(params.agent && params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

      const makeDetails =
        (mode: "single" | "parallel" | "chain") =>
        (results: SingleResult[], extra?: Partial<SubagentDetails>): SubagentDetails => ({
          mode,
          agentScope,
          projectAgentsDir: discovery.projectAgentsDir,
          results,
          ...extra,
        });

      if (modeCount !== 1) {
        const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
        return {
          content: [
            {
              type: "text",
              text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
            },
          ],
          details: makeDetails("single")([]),
        };
      }

      if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
        const requestedAgentNames = new Set<string>();
        if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
        if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
        if (params.agent) requestedAgentNames.add(params.agent);

        const projectAgentsRequested = Array.from(requestedAgentNames)
          .map((name) => agents.find((a) => a.name === name))
          .filter((a): a is AgentConfig => a?.source === "project");

        if (projectAgentsRequested.length > 0) {
          const names = projectAgentsRequested.map((a) => a.name).join(", ");
          const dir = discovery.projectAgentsDir ?? "(unknown)";
          const ok = await ctx.ui.confirm(
            "Run project-local agents?",
            `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
          );
          if (!ok)
            return {
              content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
              details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
            };
        }
      }

      // ──────── CHAIN MODE ────────
      if (params.chain && params.chain.length > 0) {
        const results: SingleResult[] = [];
        let previousOutput = "";

        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i];

          // Phase 4: compact chain handoff — truncate {previous} if needed
          const handoffText = compactChainHandoff(previousOutput, chainHandoffMode, chainHandoffMaxChars);
          let taskWithContext = step.task.replace(/\{previous\}/g, handoffText);

          // Handoff context: per-step override > top-level
          const stepContext = step.context ?? topContext;
          const { task: builtTask, contextChars, truncated } = buildDelegatedTask(
            taskWithContext, stepContext, contextMaxChars,
          );

          const chainUpdate: OnUpdateCallback | undefined = onUpdate
            ? (partial) => {
                const currentResult = partial.details?.results[0];
                if (currentResult) {
                  const allResults = [...results, currentResult];
                  onUpdate({
                    content: partial.content,
                    details: makeDetails("chain")(allResults),
                  });
                }
              }
            : undefined;

          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            step.agent,
            builtTask,
            step.cwd,
            i + 1,
            signal,
            chainUpdate,
            makeDetails("chain"),
            ctx,
            step.model ?? params.model,
            step.thinking ?? params.thinking,
            step.spawnMode ?? params.spawnMode,
            contextChars > 0 ? contextChars : undefined,
            contextChars > 0 ? truncated : undefined,
          );
          results.push(result);

          const isError = isFailedResult(result);
          if (isError) {
            const errorMsg = getResultOutput(result);
            return {
              content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
              details: makeDetails("chain")(results),
              isError: true,
            };
          }
          previousOutput = getFinalOutput(result.messages);
        }

        // Phase 1/2: Build chain root content based on return mode
        const effectiveChainMode = getEffectiveReturnMode(
          returnMode, "chain",
          results.map((r) => getResultOutput(r).length),
          artifactThresholdChars,
        );

        let chainArtifacts: ArtifactEntry[] = [];
        if (effectiveChainMode === "artifact") {
          const { artifacts } = writeArtifactsForResults(results, artifactThresholdChars, returnMode === "artifact");
          chainArtifacts = artifacts;
        }

        const chainContent = buildChainRootContent(
          results, effectiveChainMode, chainArtifacts, summaryMaxChars,
        );

        return {
          content: [{ type: "text", text: chainContent }],
          details: makeDetails("chain")(results, {
            returnMode: effectiveChainMode,
            artifacts: chainArtifacts,
            summary: effectiveChainMode !== "inline" ? chainContent : undefined,
          }),
        };
      }

      // ──────── PARALLEL MODE ────────
      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > MAX_PARALLEL_TASKS)
          return {
            content: [
              {
                type: "text",
                text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
              },
            ],
            details: makeDetails("parallel")([]),
          };

        const allResults: SingleResult[] = new Array(params.tasks.length);
        for (let i = 0; i < params.tasks.length; i++) {
          allResults[i] = {
            agent: params.tasks[i].agent,
            agentSource: "unknown",
            task: params.tasks[i].task,
            exitCode: -1,
            messages: [],
            stderr: "",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          };
        }

        const emitParallelUpdate = () => {
          if (onUpdate) {
            const running = allResults.filter((r) => r.exitCode === -1).length;
            const done = allResults.filter((r) => r.exitCode !== -1).length;
            onUpdate({
              content: [
                { type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
              ],
              details: makeDetails("parallel")([...allResults]),
            });
          }
        };

        const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
          // Handoff context: per-task override > top-level
          const taskCtx = t.context ?? topContext;
          const { task: builtTask, contextChars, truncated } = buildDelegatedTask(
            t.task, taskCtx, contextMaxChars,
          );
          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            t.agent,
            builtTask,
            t.cwd,
            undefined,
            signal,
            (partial) => {
              if (partial.details?.results[0]) {
                allResults[index] = partial.details.results[0];
                emitParallelUpdate();
              }
            },
            makeDetails("parallel"),
            ctx,
            t.model ?? params.model,
            t.thinking ?? params.thinking,
            t.spawnMode ?? params.spawnMode,
            contextChars > 0 ? contextChars : undefined,
            contextChars > 0 ? truncated : undefined,
          );
          allResults[index] = result;
          emitParallelUpdate();
          return result;
        });

        // Phase 1/2: Determine effective return mode and build content
        const effectiveParallelMode = getEffectiveReturnMode(
          returnMode, "parallel",
          results.map((r) => getResultOutput(r).length),
          artifactThresholdChars,
        );

        let parallelArtifacts: ArtifactEntry[] = [];
        if (effectiveParallelMode === "artifact") {
          const { artifacts } = writeArtifactsForResults(results, artifactThresholdChars, returnMode === "artifact");
          parallelArtifacts = artifacts;
        }

        const parallelContent = buildParallelRootContent(
          results, effectiveParallelMode, parallelArtifacts, summaryMaxChars,
        );

        return {
          content: [{ type: "text", text: parallelContent }],
          details: makeDetails("parallel")(results, {
            returnMode: effectiveParallelMode,
            artifacts: parallelArtifacts,
            summary: effectiveParallelMode !== "inline" ? parallelContent : undefined,
          }),
        };
      }

      // ──────── SINGLE MODE ────────
      if (params.agent && params.task) {
        // Handoff context: top-level only (no per-task override in single mode)
        const { task: builtTask, contextChars, truncated } = buildDelegatedTask(
          params.task, topContext, contextMaxChars,
        );
        const result = await runSingleAgent(
          ctx.cwd,
          agents,
          params.agent,
          builtTask,
          params.cwd,
          undefined,
          signal,
          onUpdate,
          makeDetails("single"),
          ctx,
          params.model,
          params.thinking,
          params.spawnMode,
          contextChars > 0 ? contextChars : undefined,
          contextChars > 0 ? truncated : undefined,
        );
        const isError = isFailedResult(result);

        // Phase 1/2: Determine effective return mode
        const rawOutput = getResultOutput(result);
        const effectiveSingleMode = getEffectiveReturnMode(
          returnMode, "single",
          [rawOutput.length],
          artifactThresholdChars,
        );

        let singleArtifacts: ArtifactEntry[] = [];
        if (effectiveSingleMode === "artifact") {
          const { artifacts } = writeArtifactsForResults([result], artifactThresholdChars, returnMode === "artifact");
          singleArtifacts = artifacts;
        }

        const singleContent = buildSingleRootContent(
          result, effectiveSingleMode, singleArtifacts, summaryMaxChars,
        );

        if (isError) {
          return {
            content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${singleContent}` }],
            details: makeDetails("single")([result], {
              returnMode: effectiveSingleMode,
              artifacts: singleArtifacts,
            }),
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: singleContent }],
          details: makeDetails("single")([result], {
            returnMode: effectiveSingleMode,
            artifacts: singleArtifacts,
            summary: effectiveSingleMode !== "inline" ? singleContent : undefined,
          }),
        };
      }

      const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
      return {
        content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
        details: makeDetails("single")([]),
      };
    },

    renderCall,
    renderResult,
  });
}
