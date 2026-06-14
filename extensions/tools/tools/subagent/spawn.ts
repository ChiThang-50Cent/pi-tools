// ─── spawn.ts ────── Lean-spawn planner for subagent child processes ─────
import type { AgentConfig } from "../../lib/agents.js";

// ─── Types ───

export type EffectiveSpawnMode = "full" | "lean";

export interface SpawnPlan {
  mode: EffectiveSpawnMode;
  flags: string[];
  notes: string[];
  extensionsDisabled: boolean;
}

// ─── Constants ───

/** Tools built into pi itself (always available without extensions). */
const BUILTIN_TOOLS = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

/** Flags always added in lean mode regardless of tool safety. */
const ALWAYS_LEAN_FLAGS = [
  "--no-skills",
  "--no-context-files",
  "--no-prompt-templates",
  "--no-themes",
];

// ─── Public helpers ───

/** Check whether a named tool is a built-in pi tool. */
export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.has(name);
}

/**
 * Determine whether we can safely disable extensions for this agent.
 *
 * Safe when the agent has an explicit `tools` allowlist and every listed
 * tool is a built-in pi tool.  Unsafe when there is no tool list (the
 * agent may be relying on extension-provided tools) or when any listed
 * tool is not built-in.
 */
export function canDisableExtensions(agent: AgentConfig): boolean {
  if (!agent.tools || agent.tools.length === 0) return false;
  return agent.tools.every((t) => isBuiltinTool(t));
}

/**
 * Resolve the effective spawn mode.
 *
 * Priority (highest first):
 *   1. explicit per-step/per-task `spawnMode` override
 *   2. top-level tool-call `spawnMode`
 *   3. agent default `spawnMode` (from frontmatter / built-in config)
 *   4. heuristic default — `explore` → lean, all others → full
 */
export function resolveSpawnMode(
  requestedMode: string | undefined,
  agent: AgentConfig,
): "full" | "lean" {
  // 1) explicit override
  if (requestedMode === "lean" || requestedMode === "full") return requestedMode;

  // 2) agent default
  if (agent.spawnMode === "lean" || agent.spawnMode === "full") return agent.spawnMode;

  // 3) heuristic
  if (agent.name === "explore") return "lean";
  return "full";
}

/**
 * Build a complete spawn plan for a single child invocation.
 *
 * The plan includes the effective mode, any extra CLI flags, human-readable
 * notes (especially when lean could not disable extensions), and a boolean
 * indicating whether extensions were actually disabled.
 */
export function buildSpawnPlan(
  agent: AgentConfig,
  requestedMode: string | undefined,
): SpawnPlan {
  const mode = resolveSpawnMode(requestedMode, agent);
  const flags: string[] = [];
  const notes: string[] = [];

  if (mode === "lean") {
    // Always disable skills, context-files, prompt-templates, themes
    flags.push(...ALWAYS_LEAN_FLAGS);

    // Disable extensions only when safe
    if (canDisableExtensions(agent)) {
      flags.push("--no-extensions");
      notes.push(`Lean mode: all ${agent.tools?.length ?? 0} agent tools are built-in — extensions disabled.`);
    } else {
      notes.push(
        `Lean mode: extensions kept enabled${
          agent.tools && agent.tools.length > 0
            ? ` (agent uses non-built-in tools: ${agent.tools.filter((t) => !isBuiltinTool(t)).join(", ")})`
            : " (agent has no explicit tool allowlist)"
        }.`,
      );
    }
  }

  return {
    mode,
    flags,
    notes,
    extensionsDisabled: mode === "lean" && canDisableExtensions(agent),
  };
}
