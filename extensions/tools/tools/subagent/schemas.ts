// ─── schemas.ts ────── TypeBox parameter schemas for subagent ────────────
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const ReturnMode = StringEnum(["auto", "inline", "summary", "artifact"] as const, {
  description:
    'Return mode: "auto" uses heuristics (small → inline, large → artifact for single; summary/artifact for parallel; inline/artifact for chain). "inline" returns the full output. "summary" returns a compact preview. "artifact" writes full output to a temp file and returns the path.',
  default: "auto",
});

export const ChainHandoffMode = StringEnum(["full", "compact"] as const, {
  description:
    'Chain handoff mode: "full" passes the complete previous output to the next step (current behavior). "compact" passes a truncated version to reduce token blow-up.',
  default: "compact",
});

export const ThinkingLevel = StringEnum(
  ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
  {
    description:
      "Thinking/reasoning level for the model. Lower = faster/cheaper, higher = more thorough reasoning.",
  },
);

export const SpawnMode = StringEnum(["auto", "full", "lean"] as const, {
  description:
    'Spawn mode: "auto" (default) resolves heuristically ("explore" → lean, others → full), "full" keeps current behavior, "lean" reduces child bootstrap cost.',
  default: "auto",
});

export const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  context: Type.Optional(
    Type.String({
      description:
        "Optional handoff context from parent to child. Include concise notes: relevant files, symbols, findings, constraints. Overrides top-level context.",
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  model: Type.Optional(
    Type.String({
      description:
        "Override the agent's model. Use any model ID from the Available Models list in your system prompt. Omit to inherit the parent agent's model.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
  spawnMode: Type.Optional(SpawnMode),
});

export const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
  context: Type.Optional(
    Type.String({
      description:
        "Optional handoff context from parent to child. Include concise notes: relevant files, symbols, findings, constraints. Overrides top-level context.",
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  model: Type.Optional(
    Type.String({
      description:
        "Override the agent's model. Use any model ID from the Available Models list in your system prompt. Omit to inherit the parent agent's model.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
  spawnMode: Type.Optional(SpawnMode),
});

export const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: "user",
});

export const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
  context: Type.Optional(
    Type.String({
      description:
        "Optional handoff context for ALL subagents in this call (top-level). Include concise notes: relevant files, symbols, findings, constraints. Per-task/per-chain-step context overrides this value.",
    }),
  ),
  contextMaxChars: Type.Optional(
    Type.Number({ description: "Max characters for handoff context before truncation. Default: 2000.", default: 2000 }),
  ),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
  model: Type.Optional(
    Type.String({
      description:
        "Default model override for ALL subagents in this call. Use any model ID from the Available Models list in your system prompt. Per-task model takes precedence.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
  returnMode: Type.Optional(ReturnMode),
  summaryMaxChars: Type.Optional(
    Type.Number({ description: "Max characters for summary/compact preview. Default: 1200.", default: 1200 }),
  ),
  artifactThresholdChars: Type.Optional(
    Type.Number({
      description: "Output threshold in chars above which artifact mode kicks in (for auto mode). Default: 4000.",
      default: 4000,
    }),
  ),
  spawnMode: Type.Optional(SpawnMode),
  chainHandoffMode: Type.Optional(ChainHandoffMode),
  chainHandoffMaxChars: Type.Optional(
    Type.Number({
      description: "Max characters for compact chain handoff. Default: 4000.",
      default: 4000,
    }),
  ),
});
