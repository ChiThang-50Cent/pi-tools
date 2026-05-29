// ─── config.ts ────── Unified configuration for pi-tools ──────────────────
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "./types.js";

const CONFIG_PATH = join(homedir(), ".pi", "tools.json");

export interface ToolsConfig {
  searxng?: string;    // SearXNG search URL
  vision?: { defaultModel: string }; // Pi-configured vision model (provider/modelId)
  /** Per-agent model configuration. Key = agent name, value = model config. */
  agents?: Record<string, AgentModelConfig>;
  /** Allowlist: if non-empty, ONLY these tools are registered (deny is ignored) */
  allow?: string[];
  /** Denylist: tools to exclude when allow is empty/not set */
  deny?: string[];
  /** Max subagent nesting depth. Default 1 = only root pi can spawn subagents. Overridable via PI_MAX_SUBAGENT_DEPTH env var. */
  maxSubagentDepth?: number;
}

export function loadConfig(): ToolsConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ToolsConfig;
  } catch {
    return {};
  }
}

let _configCache: ToolsConfig | null = null;
let _configMtime: number = 0;

function getConfig(): ToolsConfig {
  try {
    const stat = statSync(CONFIG_PATH);
    if (stat.mtimeMs !== _configMtime) {
      _configCache = loadConfig();
      _configMtime = stat.mtimeMs;
    }
  } catch {
    _configCache = {};
    _configMtime = 0;
  }
  return _configCache ?? {};
}

export function getSearXNGUrl(): string {
  return getConfig().searxng?.replace(/\/+$/, "") || "http://127.0.0.1:8080";
}

export function getVisionModel(): string {
  return getConfig().vision?.defaultModel || "";
}

/** Get the merged agent model config: tools.json config → agent frontmatter (for model & thinking fallthrough) */
export function getAgentModelConfig(agentName: string, agentModel?: string, agentThinking?: string): AgentModelConfig {
  const config = getConfig().agents?.[agentName] ?? {};
  return {
    model: config.model ?? agentModel,
    thinking: config.thinking ?? agentThinking,
    tasks: config.tasks,
  };
}

/**
 * Check if a tool should be registered.
 * - allow is non-empty → ONLY tools in allow (deny ignored)
 * - otherwise → ALL tools EXCEPT those in deny
 * - neither set → ALL tools
 */
export function isToolAllowed(toolName: string): boolean {
  const config = getConfig();
  if (config.allow && config.allow.length > 0) {
    return config.allow.includes(toolName);
  }
  if (config.deny && config.deny.length > 0) {
    return !config.deny.includes(toolName);
  }
  return true;
}
