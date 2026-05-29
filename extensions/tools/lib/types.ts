// ─── types.ts ────── Shared types ─────────────────────────────────────────
/** Per-agent model configuration (from ~/.pi/tools.json or agent frontmatter) */
export interface AgentModelConfig {
  /** Default model for this agent */
  model?: string;
  /** Default thinking level for this agent */
  thinking?: string;
  /** Task categories this agent is optimized for (helps parent LLM auto-select) */
  tasks?: string[];
}
