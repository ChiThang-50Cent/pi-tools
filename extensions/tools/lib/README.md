# 📦 pi-tools — `lib/` Library Documentation

The `lib/` directory contains TypeScript modules providing platform utilities for pi-tools: agent management, HTTP calls, search, display formatting, and more. Below is a brief description of each module.

---

## 🧠 `agents.ts` — Agent Discovery & Management

Discovers and loads agent configurations from three sources: **built-in**, **user** (`~/.pi/agents/`), and **project** (`.pi/agents/` within the project directory).

| Export | Type | Description |
|--------|------|-------------|
| `AgentScope` | type | `"user"` \| `"project"` \| `"both"` — agent search scope |
| `AgentSource` | type | `"builtin"` \| `"user"` \| `"project"` — agent origin |
| `AgentConfig` | interface | Agent config structure: name, description, tools, model, thinking, task categories, system prompt |
| `AgentDiscoveryResult` | interface | Return value: list of agents + project agents directory path |
| `discoverAgents` | function | **(main)** Scans user/project directories, loads `.md` files (with frontmatter), merges with built-in agents by scope. Priority: built-in < user < project |

---

## ⚡ `concurrency.ts` — Concurrency Limiting

| Export | Type | Description |
|--------|------|-------------|
| `mapWithConcurrencyLimit` | async function | Runs `fn` asynchronously over array `items` with a limit on **parallel workers** (`concurrency`). Preserves result order. Useful for throttling many simultaneous HTTP requests. |

---

## ⚙️ `config.ts` — Global Configuration

Reads and caches configuration from `~/.pi/tools.json`. Provides convenience getters for each config field.

| Export | Type | Description |
|--------|------|-------------|
| `loadConfig` | function | Reads & parses `tools.json` (no cache) |
| `getSearXNGUrl` | function | Returns SearXNG URL (default `http://127.0.0.1:8080`) |
| `getSearchConfig` | function | Returns optional broker/queue/cache settings |
| `getAgentModelConfig` | function | Merges agent model/thinking config from `tools.json` + agent frontmatter |
| `isToolAllowed` | function | Checks whether a tool is allowed to register: allowlist > denylist > all |

---

## 🌐 `fetch.ts` — HTTP Client & HTML Processing

Fetches web content and GitHub repos, removing HTML tags.

| Export | Type | Description |
|--------|------|-------------|
| `MAX_INLINE_CONTENT` | const | `30000` — inline content length limit (JSON/text) |
| `stripHtml` | function | Removes `<script>`, `<style>`, HTML tags, decodes HTML entities, normalizes whitespace |
| `fetchPageContent` | async function | Fetches any URL, auto-parses JSON or strips HTML, returns `{url, title, content}`. Timeout 20s |
| `fetchGitHub` | async function | Parses GitHub URL → calls GitHub API for metadata (stars, language, license, topics…), formats as markdown |

---

## 🎨 `format.ts` — Display Formatting

Formatting functions used in the TUI for human-friendly number display.

| Export | Type | Description |
|--------|------|-------------|
| `formatTokens` | function | `12345` → `"12.3k"`, `1200000` → `"1.2M"` |
| `formatUsageStats` | function | Formats usage stats: turns, input/output tokens, cache read/write, cost, context tokens, model |
| `formatToolCall` | function | Formats tool calls (bash, read, write, edit, ls, find, grep…) with TUI theme colors |

---

## 🚀 `invoke.ts` — Child Process Invocation

| Export | Type | Description |
|--------|------|-------------|
| `getPiInvocation` | function | Determines command + args to spawn a child pi process. Handles direct `node`/`bun` execution, `bun` virtual script, and fallback to `pi` binary |

---

## 🔍 `search.ts` — SearXNG API

| Export | Type | Description |
|--------|------|-------------|
| `SearXNGResult` | interface | Structure of one result: `title`, `url`, `content?`, `engine?` |
| `searchSearXNG` | async function | Calls SearXNG directly or through the configured local broker; caches complete responses, applies caller limits, and reports HTTP/engine diagnostics |
| `SearXNGHttpError` | class | Typed non-OK response with status, bounded body, and Retry-After details |
| `formatUnresponsiveEngines` | function | Formats SearXNG partial-result engine warnings |

---

## 🛰️ `search_broker.ts` — Local Search Broker

A standalone Node-built-in HTTP service for cross-process FIFO throttling, cache,
single-flight deduplication, bounded retries, and shared 429 cooldowns. It binds
to loopback by default and is launched with `npm run search:broker`.
Its loopback-only `/health` endpoint reports queue depth, in-flight/cache counts,
cooldown remaining, cache hit/miss totals, deduplicated waiter totals, and
upstream request/error totals without query data.

## 💾 `store.ts` — In-Memory Store

Stores search/fetch results for later retrieval via the `get_search_content` tool.

| Export | Type | Description |
|--------|------|-------------|
| `StoredContent` | type | `{responseId, type, timestamp, queries?, urls?}` — fetched data |
| `contentStore` | const | `Map<string, StoredContent>` — global store |
| `generateId` | function | Generates a random 8-character ID (UUID slice) |

---

## ✂️ `truncate.ts` — Output Truncation

| Export | Type | Description |
|--------|------|-------------|
| `truncateOutput` | function | Truncates string to byte limit, preserving UTF-8. If truncated: appends `[Output truncated: N bytes omitted...]` line, returns with `truncated` flag |

---

## 📐 `types.ts` — Shared Types

| Export | Type | Description |
|--------|------|-------------|
| `AgentModelConfig` | interface | `{model?, thinking?, tasks?}` — default model configuration per agent |

---

## 📊 Data Flow Overview

```
tools.json  ──► config.ts ──► search.ts, register tools
                  │
agent .md   ──► agents.ts ──► discoverAgents() → subagent registry
                  │
web URLs    ──► fetch.ts ──► contentStore (store.ts) ──► get_search_content tool
                  │
output      ──► truncate.ts ──► format.ts ──► TUI display
```
