// ─── descriptors.ts ────── Agent descriptions & prompt guidelines ───────
//
// CACHE-STABILITY NOTE
// ────────────────────
// The output of these functions becomes part of the tool description and
// prompt guidelines that Pi embeds in the system prompt.  LLM providers
// (Anthropic, OpenAI) cache the system prompt prefix — the more stable
// and deterministic the text, the higher the cache-hit rate.
//
// To keep the prompt cache-friendly:
//   • Agents are iterated in a stable, deterministic order (sorted by name).
//   • Model lists are sorted alphabetically.
//   • Dynamic sections (e.g. depth-limited warnings) appear at the end.
//   • No timestamps, random IDs, or non-deterministic values are emitted.
//
// When adding new sections, place cache-stable content first and
// cache-breaking / per-session content last.

import type { AgentConfig } from "../../lib/agents.js";
import { getAgentModelConfig, getEnabledModels } from "../../lib/config.js";

function formatTaskCategories(taskCategories: string[] | undefined): string | undefined {
  if (!taskCategories || taskCategories.length === 0) return undefined;
  return [...taskCategories].sort((a, b) => a.localeCompare(b)).join(", ");
}

export function buildAgentDescription(agents: AgentConfig[]): string {
  // Sort deterministically for cache stability — the same set of agents
  // must always produce identical description text.
  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  // Cache-stable header: fixed text that rarely changes
  const lines: string[] = [
    "Delegate tasks to specialized subagents with isolated context windows. Each subagent runs in a separate pi process with its own tools and system prompt.",
    "",
  ];

  // Cache-stable: model list (sorted by getEnabledModels for deterministic output)
  const enabledModels = getEnabledModels();
  if (enabledModels.length > 0) {
    lines.push("Available models:");
    for (const m of enabledModels) {
      lines.push(`  - ${m}`);
    }
    lines.push("");
  }

  if (agents.length === 0) {
    lines.push(
      "No agents found. Create markdown agents in ~/.pi/agent/agents/ (user) or .pi/agents/ (project). Each .md file = one agent, with YAML frontmatter (name, description) + body as system prompt.",
    );
  } else {
    // Cache-stable: agent list (sorted by name for deterministic output)
    lines.push("Available subagents:");
    for (const a of sorted) {
      const agentCfg = getAgentModelConfig(a.name, a.model, a.thinking);
      let entry = `  - "${a.name}" (${a.source})`;
      const taskCategories = formatTaskCategories(a.taskCategories);
      if (taskCategories) {
        entry += ` [tasks: ${taskCategories}]`;
      }
      if (agentCfg.model) {
        entry += ` — prefer: ${agentCfg.model}`;
        if (agentCfg.thinking) entry += ` (thinking: ${agentCfg.thinking})`;
      }
      entry += `: ${a.description}`;
      lines.push(entry);
    }
  }

  lines.push(
    "",
    "Modes:",
    '  - Single: { agent: "name", task: "..." }',
    '    → One agent, one task. Use for focused work.',
    "",
    '  - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }',
    '    → Multiple independent tasks run simultaneously (max 8).',
    '    → Each task has its own agent and runs in parallel.',
    "",
    '  - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }',
    '    → Sequential tasks where each step depends on the previous.',
    '    → Use {previous} to reference output from the prior step.',
    "",
    "Output compaction (optional):",
    '  - returnMode: "auto" (default) — heuristically selects inline, summary, or artifact mode based on output size.',
    '  - returnMode: "inline" — full output in content (legacy behavior).',
    '  - returnMode: "summary" — compact preview in content, full data preserved in details.',
    '  - returnMode: "artifact" — full output written to temp files, short summary + paths in content.',
    '  - chainHandoffMode: "compact" (default) — truncates {previous} output to reduce token blow-up between chain steps.',
    '  - chainHandoffMode: "full" — passes complete {previous} output (legacy behavior).',
    '  - summaryMaxChars / artifactThresholdChars / chainHandoffMaxChars — tune size thresholds (defaults: 1200 / 4000 / 4000).',
    '',
    'Spawn mode (optional):',
    '  - spawnMode: "auto" (default) — heuristically resolves ("explore" → lean, others → full).',
    '  - spawnMode: "full" — current behavior with full bootstrap.',
    '  - spawnMode: "lean" — reduced child bootstrap (skips skills, context-files, prompt-templates, themes; also skips extensions when agent tools are all built-in).',
    '  - Per-task/per-chain-step spawnMode overrides the top-level setting.',
    '  - Agents can declare a default spawnMode via frontmatter (spawnMode or spawn_mode).',
    '',
    'Handoff context (optional — deterministic, no LLM calls):',
    '  - context: string — concise parent→child notes (relevant files, symbols, findings, constraints).',
    '  - contextMaxChars: number (default 2000) — character budget for handoff context; truncated deterministically if exceeded.',
    '  - Per-task/per-chain-step context overrides the top-level context.',
    '  - Handoff metadata (handoffContextChars, handoffContextTruncated) preserved in details.results for debugging.',
    '',
    'Routing policy:',
    '  Do NOT use subagent when:',
    '    • task can be solved with one direct file read (use read instead)',
    '    • task can be solved with one simple grep/find/bash listing',
    '    • the root already has enough context to answer directly',
    '    • the task is a tiny follow-up on the immediately preceding result',
    '',
    '  Agent selection:',
    '    • Use "explore" for read-only investigation: file/symbol/pattern discovery, dependency tracing, repo structure.',
    '    • Use "general" for implementation, refactoring, debugging, code generation, or multi-step edits.',
    '',
    '  When to use each mode:',
    '    • Parallel: only when subtasks are independent and each can produce concise output.',
    '    • Chain: only when step N genuinely depends on step N-1.',
    '',
    '  Recommended defaults by agent:',
    '    • explore: prefer spawnMode:"lean" + returnMode:"summary"',
    '    • general: prefer spawnMode:"full" (unless clearly lean-safe) + returnMode:"summary" for orchestration, "artifact" for long outputs',
    '    • For both: prefer returnMode:"inline" only when the root truly needs full raw child output in-context.',
  );

  return lines.join("\n");
}

export function buildPromptGuidelines(agents: AgentConfig[]): string[] {
  // Sort deterministically for cache stability
  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  // Cache-stable core guidelines (placed first for best cache hit rate)
  const guidelines = [
    "Use subagent to delegate self-contained work to an agent with fresh, isolated context. This keeps the main conversation focused.",
    "If the user explicitly asks you to 'use a subagent' or 'delegate to an agent', you MUST call this tool.",
    "When delegating tasks, ALWAYS write the task text in English regardless of the user's language. This ensures consistent behavior across all subagents.",
  ];

  // Cache-stable: agent list (sorted by name for deterministic output)
  if (sorted.length > 0) {
    const names = sorted.map((a) => `"${a.name}"`).join(", ");
    guidelines.push(
      `When delegating, pick the most specific agent from: ${names}. Match the agent's description and task categories to the task.`,
    );

    // Per-agent task categories for quick reference
    for (const a of sorted) {
      const taskCategories = formatTaskCategories(a.taskCategories);
      if (taskCategories) {
        guidelines.push(`  - "${a.name}" excels at: ${taskCategories}`);
      }
    }
  }

  const depth = (() => {
    const d = parseInt(process.env.PI_SUBAGENT_DEPTH ?? "", 10);
    return Number.isFinite(d) ? d : 0;
  })();
  const maxDepth = (() => {
    const m = parseInt(process.env.PI_MAX_SUBAGENT_DEPTH ?? "", 10);
    return Number.isFinite(m) && m >= 0 ? m : 1;
  })();
  // Cache-stable routing policy
  guidelines.push(
    "Do NOT use subagent for trivial one-step tasks (reading a known file path, running a simple grep). Use read/bash/grep directly instead.",
    "Do NOT delegate when the root already has enough context to answer directly. Subagent overhead is justified only when isolation, parallelism, or self-contained exploration/execution materially helps.",
    "Prefer \"explore\" + spawnMode:\"lean\" + returnMode:\"summary\" for read-only investigation (file/symbol/pattern discovery, dependency tracing).",
    "Prefer \"general\" for implementation, refactoring, debugging, or multi-step code generation.",
    "Use `context` to pass relevant files, symbols, findings, and constraints so the child subagent does not rediscover them. This saves tokens.",
    "Prefer returnMode:\"summary\" for most delegation tasks. Use returnMode:\"artifact\" for long outputs instead of pushing raw output back into the root context. Use returnMode:\"inline\" only when you truly need full raw child output in-context.",
    "Use parallel mode only for independent subtasks; use chain mode only when step N genuinely depends on step N-1 (use {previous} placeholder).",
    "Output management: chain handoff is compact by default (truncated {previous}). Full results are always available in details.results regardless of returnMode.",
    "IMPORTANT: Always include provider prefix in model field. Example: `opencode-go/deepseek-v4-pro` not just `deepseek-v4-pro`.",
    "For model selection: use the format `provider/modelId` (e.g. `opencode-go/deepseek-v4-pro`). Use cheaper/faster models for simple tasks, reasoning models for complex analysis. Omit the model field to inherit the agent's configured default or the parent's model.",
    "Each agent has a default model configured in ~/.pi/tools.json (agents section). The model is auto-applied — you only need to override it when you want a different model for a specific task.",
    "Available thinking levels: off, minimal, low, medium, high, xhigh. Lower = faster/cheaper, higher = more thorough reasoning. Use higher levels for complex analysis, lower for simple tasks.",
  );

  // Cache-breaking section: depth-limited warning (placed last so stable guidance remains cacheable)
  if (depth >= maxDepth) {
    guidelines.push(
      `CRITICAL: You are at subagent depth ${depth}/${maxDepth}. You CANNOT spawn further subagents — the subagent tool will be blocked. Complete the task yourself using other available tools.`,
    );
  }

  return guidelines;
}
