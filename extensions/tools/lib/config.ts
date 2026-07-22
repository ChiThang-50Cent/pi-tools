// ─── config.ts ────── Unified configuration for pi-tools ──────────────────
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const CONFIG_PATH = join(homedir(), ".pi", "tools.json");
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export interface SearchConfig {
  /** Local broker URL. When unset, search calls SearXNG directly. */
  brokerUrl?: string;
  /** Minimum time between upstream requests in direct mode/broker mode. */
  minIntervalMs?: number;
  /** Maximum number of distinct queued searches. */
  queueSize?: number;
  /** Successful response cache lifetime. */
  cacheTtlMs?: number;
  /** Upstream SearXNG request timeout. In broker mode this is owned by the broker. */
  timeoutMs?: number;
  /** Maximum time a caller waits for the local broker HTTP response. */
  brokerWaitTimeoutMs?: number;
  /** Broker upstream retries for transient failures. */
  maxRetries?: number;
  /** Initial broker retry delay. */
  retryBaseMs?: number;
  /** Maximum broker retry delay. */
  retryMaxMs?: number;
}

export interface ToolsConfig {
  /** SearXNG search URL. Kept as a string for backwards compatibility. */
  searxng?: string;
  /** Optional local-only search broker settings. */
  search?: SearchConfig;
  /** Allowlist: if non-empty, ONLY these tools are registered (deny is ignored) */
  allow?: string[];
  /** Denylist: tools to exclude when allow is empty/not set */
  deny?: string[];
  /** Max subagent nesting depth. Default 1 = only root pi can spawn subagents. Overridable via PI_MAX_SUBAGENT_DEPTH env var. */
  maxSubagentDepth?: number;
}

export interface PiSettings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  enabledModels?: string[];
  packages?: string[];
  permissionLevel?: string;
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

/** Return the optional search settings, including the broker URL. */
export function getSearchConfig(): SearchConfig {
  return { ...(getConfig().search ?? {}) };
}

let _settingsCache: PiSettings | null = null;
let _settingsMtime: number = 0;

function getSettings(): PiSettings {
  try {
    const stat = statSync(SETTINGS_PATH);
    if (stat.mtimeMs !== _settingsMtime) {
      _settingsCache = existsSync(SETTINGS_PATH)
        ? JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as PiSettings
        : {};
      _settingsMtime = stat.mtimeMs;
    }
  } catch {
    _settingsCache = {};
    _settingsMtime = 0;
  }
  return _settingsCache ?? {};
}

/** Get list of enabled models from ~/.pi/agent/settings.json.
 *  Sorted alphabetically for prompt-cache stability — the model list
 *  appears in the subagent tool description embedded in the system
 *  prompt, so deterministic ordering prevents cache misses when the
 *  underlying settings file is reordered. */
export function getEnabledModels(): string[] {
  const models = getSettings().enabledModels ?? [];
  return [...models].sort((a, b) => a.localeCompare(b));
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
