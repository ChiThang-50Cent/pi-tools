// ─── schemas.ts ────── TypeBox parameter schemas for subagent ────────────
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
// Keep public text and compaction budgets bounded near the runner's 1 MiB capture cap.
const MAX_PUBLIC_TEXT_CHARS = 1_000_000;
const MAX_PARALLEL_TASKS = 8;

const nonEmptyAgent = (description: string) => Type.String({ description, minLength: 1 });
const taskText = (description: string) =>
  Type.String({ description, minLength: 1, maxLength: MAX_PUBLIC_TEXT_CHARS });
const contextText = (description: string) =>
  Type.String({ description, maxLength: MAX_PUBLIC_TEXT_CHARS });
const timeout = (description: string) =>
  Type.Number({ description, minimum: MIN_TIMEOUT_MS, maximum: MAX_TIMEOUT_MS });
const characterBudget = (description: string, defaultValue: number) =>
  Type.Number({
    description,
    minimum: 1,
    maximum: MAX_PUBLIC_TEXT_CHARS,
    default: defaultValue,
  });

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
  agent: nonEmptyAgent("Name of the agent to invoke"),
  task: taskText("Task to delegate to the agent"),
  context: Type.Optional(
    contextText(
      "Optional handoff context from parent to child. Include concise notes: relevant files, symbols, findings, constraints. Overrides top-level context.",
    ),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  model: Type.Optional(
    Type.String({
      description:
        "Per-call model override. Use any model ID from the Available Models list in your system prompt. Omit to use the active parent model, then the agent frontmatter model, then Pi's child default.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
  spawnMode: Type.Optional(SpawnMode),
  timeoutMs: Type.Optional(
    timeout("Wall-clock timeout in milliseconds for this task. Default: 900000 (15 minutes)."),
  ),
});

export const ChainItem = Type.Object({
  agent: nonEmptyAgent("Name of the agent to invoke"),
  task: taskText("Task with optional {previous} placeholder for prior output"),
  context: Type.Optional(
    contextText(
      "Optional handoff context from parent to child. Include concise notes: relevant files, symbols, findings, constraints. Overrides top-level context.",
    ),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  model: Type.Optional(
    Type.String({
      description:
        "Per-call model override. Use any model ID from the Available Models list in your system prompt. Omit to use the active parent model, then the agent frontmatter model, then Pi's child default.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
  spawnMode: Type.Optional(SpawnMode),
  timeoutMs: Type.Optional(
    timeout("Wall-clock timeout in milliseconds for this chain step. Default: 900000 (15 minutes)."),
  ),
});

export const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: "user",
});

export const SubagentParams = Type.Object({
  agent: Type.Optional(nonEmptyAgent("Name of the agent to invoke (for single mode)")),
  task: Type.Optional(taskText("Task to delegate (for single mode)")),
  context: Type.Optional(
    contextText(
      "Optional handoff context for ALL subagents in this call (top-level). Include concise notes: relevant files, symbols, findings, constraints. Per-task/per-chain-step context overrides this value.",
    ),
  ),
  contextMaxChars: Type.Optional(
    characterBudget("Max characters for handoff context before truncation. Default: 2000.", 2000),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description: "Array of {agent, task} for parallel execution",
      minItems: 1,
      maxItems: MAX_PARALLEL_TASKS,
    }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description: "Array of {agent, task} for sequential execution",
      minItems: 1,
    }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
  model: Type.Optional(
    Type.String({
      description:
        "Per-call default model override for ALL subagents in this call. Use any model ID from the Available Models list in your system prompt. A per-task/per-chain-step model takes precedence.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
  timeoutMs: Type.Optional(
    timeout("Default wall-clock timeout in milliseconds for all subagent tasks. Default: 900000 (15 minutes). Per-task timeoutMs takes precedence."),
  ),
  returnMode: Type.Optional(ReturnMode),
  summaryMaxChars: Type.Optional(
    characterBudget("Max characters for summary/compact preview. Default: 1200.", 1200),
  ),
  artifactThresholdChars: Type.Optional(
    characterBudget(
      "Output threshold in chars above which artifact mode kicks in (for auto mode). Default: 4000.",
      4000,
    ),
  ),
  spawnMode: Type.Optional(SpawnMode),
  chainHandoffMode: Type.Optional(ChainHandoffMode),
  chainHandoffMaxChars: Type.Optional(
    characterBudget("Max characters for compact chain handoff. Default: 4000.", 4000),
  ),
});
