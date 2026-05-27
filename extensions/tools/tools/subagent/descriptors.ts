// ─── descriptors.ts ────── Agent descriptions & prompt guidelines ───────
import type { AgentConfig } from "../../lib/agents.js";
import { getAgentModelConfig } from "../../lib/config.js";

export function buildAgentDescription(agents: AgentConfig[]): string {
  const lines: string[] = [
    "Delegate tasks to specialized subagents with isolated context windows. Each subagent runs in a separate pi process with its own tools and system prompt.",
    "",
  ];

  if (agents.length === 0) {
    lines.push(
      "No agents found. Create markdown agents in ~/.pi/agent/agents/ (user) or .pi/agents/ (project). Each .md file = one agent, with YAML frontmatter (name, description) + body as system prompt.",
    );
  } else {
    lines.push("Available subagents:");
    for (const a of agents) {
      const agentCfg = getAgentModelConfig(a.name, a.model, a.thinking);
      let entry = `  - "${a.name}" (${a.source})`;
      if (a.taskCategories && a.taskCategories.length > 0) {
        entry += ` [tasks: ${a.taskCategories.join(", ")}]`;
      }
      if (agentCfg.model) {
        entry += ` — default model: ${agentCfg.model}`;
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
    '  - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] } (max 8)',
    '  - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }',
  );

  return lines.join("\n");
}

export function buildPromptGuidelines(agents: AgentConfig[]): string[] {
  const guidelines = [
    "Use subagent to delegate self-contained work to an agent with fresh, isolated context. This keeps the main conversation focused.",
    "If the user explicitly asks you to 'use a subagent' or 'delegate to an agent', you MUST call this tool.",
  ];

  if (agents.length > 0) {
    const names = agents.map((a) => `"${a.name}"`).join(", ");
    guidelines.push(
      `When delegating, pick the most specific agent from: ${names}. Match the agent's description and task categories to the task.`,
    );

    // Per-agent task categories for quick reference
    for (const a of agents) {
      if (a.taskCategories && a.taskCategories.length > 0) {
        guidelines.push(`  - "${a.name}" excels at: ${a.taskCategories.join(", ")}`);
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
  if (depth >= maxDepth) {
    guidelines.push(
      `CRITICAL: You are at subagent depth ${depth}/${maxDepth}. You CANNOT spawn further subagents — the subagent tool will be blocked. Complete the task yourself using other available tools.`,
    );
  }

  guidelines.push(
    "Do NOT use subagent for trivial one-step tasks (reading a known file path, running a simple grep). Use read/bash/grep directly instead.",
    "Use parallel mode to run multiple independent investigations simultaneously.",
    "Use chain mode when one task depends on the output of another (use {previous} placeholder).",
    "For model selection: pick models from the Available Models list in your system prompt. Use cheaper/faster models for simple tasks, reasoning models for complex analysis. Omit the model field to inherit the agent's configured default or the parent's model.",
    "Each agent has a default model configured in ~/.pi/tools.json (agents section). The model is auto-applied — you only need to override it when you want a different model for a specific task.",
  );

  return guidelines;
}
