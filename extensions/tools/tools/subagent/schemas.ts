// ─── schemas.ts ────── TypeBox parameter schemas for subagent ────────────
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const ThinkingLevel = StringEnum(
  ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
  {
    description:
      "Thinking/reasoning level for the model. Lower = faster/cheaper, higher = more thorough reasoning.",
  },
);

export const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  model: Type.Optional(
    Type.String({
      description:
        "Override the agent's model. Use any model ID from the Available Models list in your system prompt. Omit to inherit the parent agent's model.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
});

export const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  model: Type.Optional(
    Type.String({
      description:
        "Override the agent's model. Use any model ID from the Available Models list in your system prompt. Omit to inherit the parent agent's model.",
    }),
  ),
  thinking: Type.Optional(ThinkingLevel),
});

export const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: "user",
});

export const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
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
});
