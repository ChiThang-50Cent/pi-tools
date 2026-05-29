# 📦 pi-tools `lib/`

Core utilities for pi-tools extensions.

---

## Modules

### `agents.ts` — Agent Discovery

| Export | Description |
|--------|-------------|
| `discoverAgents` | Scan user/project dirs for `.md` agents, merge with built-in |
| `AgentConfig` | Agent structure: name, description, tools, model, thinking |
| `AgentScope` | `"user"` \| `"project"` \| `"both"` |
| `AgentSource` | `"builtin"` \| `"user"` \| `"project"` |

### `config.ts` — Configuration

Reads `~/.pi/tools.json` with caching.

| Export | Description |
|--------|-------------|
| `getSearXNGUrl` | SearXNG URL (default `http://127.0.0.1:8080`) |
| `getVisionModel` | Vision model (`provider/modelId`) |
| `getAgentModelConfig` | Merge agent config from tools.json + frontmatter |
| `isToolAllowed` | Check tool allowlist/denylist |

### `vision.ts` — Vision API

| Export | Description |
|--------|-------------|
| `callVision` | Call Pi-configured vision model (OpenAI, Anthropic, Google) |

### `image.ts` — Image Loading

| Export | Description |
|--------|-------------|
| `loadImageBytes` | Load from file/URL/data URI, auto-resize (2000x2000 max) |

### `fetch.ts` — HTTP Client

| Export | Description |
|--------|-------------|
| `fetchPageContent` | Fetch URL, strip HTML, return `{url, title, content}` |
| `fetchGitHub` | Parse GitHub URL, fetch metadata via API |

### `search.ts` — SearXNG

| Export | Description |
|--------|-------------|
| `searchSearXNG` | Query SearXNG `/search?format=json` |

### `store.ts` — In-Memory Store

| Export | Description |
|--------|-------------|
| `contentStore` | `Map<string, StoredContent>` for search/fetch results |
| `generateId` | Random 8-char ID |

### `format.ts` — Display Formatting

| Export | Description |
|--------|-------------|
| `formatTokens` | `12345` → `"12.3k"` |
| `formatUsageStats` | Format turns, tokens, cost, model |
| `formatToolCall` | Format tool calls with TUI theme |

### `truncate.ts` — Output Truncation

| Export | Description |
|--------|-------------|
| `truncateOutput` | Truncate string to byte limit, preserve UTF-8 |

### `concurrency.ts` — Parallel Execution

| Export | Description |
|--------|-------------|
| `mapWithConcurrencyLimit` | Run async fn with concurrency limit |

### `invoke.ts` — Process Invocation

| Export | Description |
|--------|-------------|
| `getPiInvocation` | Get command/args to spawn child pi process |

### `types.ts` — Shared Types

| Export | Description |
|--------|-------------|
| `AgentModelConfig` | `{model?, thinking?, tasks?}` |

---

## Data Flow

```
tools.json ──► config.ts ──► vision.ts, search.ts
                │
agent .md  ──► agents.ts ──► subagent tool
                │
URLs       ──► fetch.ts ──► store.ts ──► get_search_content
                │
images     ──► image.ts ──► vision.ts ──► analyze_image
```
