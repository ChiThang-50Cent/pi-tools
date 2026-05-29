# pi-tools

> Self-hosted tools for the [Pi coding agent](https://pi.dev): web search, code search, image analysis, content fetching, and subagent delegation.

## Quick Install

```bash
pi install git:github.com/ChiThang-50Cent/pi-tools
```

---

## Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via SearXNG |
| `code_search` | Search code on GitHub, StackOverflow, PyPI, docs.rs |
| `analyze_image` | Vision analysis via Pi-configured models |
| `fetch_content` | Fetch URLs & GitHub repos → markdown |
| `get_search_content` | Retrieve cached results from prior searches |
| `subagent` | Delegate tasks to isolated subagents (single / parallel / chain) |

**Built-in subagents:** `general` (multi-step tasks), `explore` (read-only codebase explorer)

---

## Prerequisites

### 1. Pi Coding Agent

```bash
# Official installer (auto-installs Node.js 22 + Pi)
curl -fsSL https://pi.dev/install.sh | sh

# Or via npm (requires Node.js >= 22)
npm install -g @earendil-works/pi-coding-agent
```

### 2. SearXNG

SearXNG powers `web_search` and `code_search`.

```bash
# Docker (recommended)
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest

# Verify
curl "http://127.0.0.1:8080/search?q=test&format=json"
```

<details>
<summary>Docker Compose</summary>

```yaml
services:
  searxng:
    image: searxng/searxng:latest
    ports:
      - "8080:8080"
    volumes:
      - searxng-config:/etc/searxng
    restart: unless-stopped

volumes:
  searxng-config:
```

```bash
docker compose up -d
```
</details>

<details>
<summary>Bare metal</summary>

See [SearXNG docs](https://docs.searxng.org/admin/installation-searxng.html). Requires Python 3.11+.
</details>

> **Tip:** If SearXNG runs on a different host/port, override in `~/.pi/tools.json` (see [Configuration](#configuration)).

### 3. Vision Model (optional)

`analyze_image` uses a vision model configured in Pi. Any provider already set up in Pi works (OpenAI, Anthropic, Google, OpenCode, etc).

No extra installation needed — just configure the model in `~/.pi/tools.json`.

---

## Configuration

`~/.pi/tools.json`:

```json
{
  "searxng": "http://127.0.0.1:8080",
  "vision": { "defaultModel": "opencode-go/kimi-k2.6" },
  "agents": {
    "general": { "model": "opencode-go/deepseek-v4-pro", "thinking": "medium" },
    "explore": { "model": "opencode-go/deepseek-v4-flash", "thinking": "off" }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `searxng` | `http://127.0.0.1:8080` | SearXNG URL |
| `vision.defaultModel` | — | Vision model (`provider/modelId`) |
| `agents.<name>.model` | — | Override model for agent |
| `agents.<name>.thinking` | — | Thinking level: `off` → `xhigh` |
| `allow` | `[]` | Whitelist tools (deny ignored) |
| `deny` | `[]` | Blacklist tools |

---

## Using Tools

### Enable / Disable at Runtime

Type `/tools` in Pi to toggle tools on/off. State persists across sessions.

### How allow/deny Works

- `allow` non-empty → **only** these tools are registered
- `deny` non-empty → all tools **except** these
- Both empty → all tools registered

### Examples

```jsonc
// Only web_search and subagent
{ "allow": ["web_search", "subagent"] }

// Everything except analyze_image
{ "deny": ["analyze_image"] }
```

---

## Subagent Modes

```jsonc
// Single
{ "agent": "general", "task": "Refactor auth module" }

// Parallel (max 8 tasks, 4 concurrent)
{ "tasks": [
  { "agent": "explore", "task": "Find .ts files" },
  { "agent": "explore", "task": "Find test files" }
]}

// Chain (pass output via {previous})
{ "chain": [
  { "agent": "explore", "task": "Find entry point" },
  { "agent": "general", "task": "Refactor:\n{previous}" }
]}
```

---

## Custom Agents

Create `.md` files in `~/.pi/agents/` (user) or `.pi/agents/` (project):

```markdown
---
name: code-reviewer
description: Reviews code for bugs and security
tools: read, bash, edit
model: claude-sonnet-4-5
thinking: high
task_categories: review, audit
---
You are a senior code reviewer...
```

| Field | Description |
|-------|-------------|
| `name` | Agent name |
| `description` | Shown in UI |
| `tools` | Comma-separated tool list |
| `model` | Override model |
| `thinking` | `off` → `xhigh` |
| `task_categories` | For agent discovery |

Agents are discovered from: built-in → `~/.pi/agents/` → `.pi/agents/` (later overrides earlier)

---

## Project Structure

```
extensions/tools/
├── index.ts                 # Entry point
├── tools/
│   ├── web_search.ts        # SearXNG search
│   ├── code_search.ts       # Code search
│   ├── analyze_image.ts     # Vision analysis
│   ├── fetch_content.ts     # URL → markdown
│   ├── get_search_content.ts
│   └── subagent/            # Subagent delegation
└── lib/
    ├── config.ts            # ~/.pi/tools.json loader
    ├── vision.ts            # Vision API (OpenAI, Anthropic, Google)
    ├── search.ts            # SearXNG client
    ├── fetch.ts             # HTTP + HTML processing
    ├── image.ts             # Image loading + resize
    ├── agents.ts            # Agent discovery
    └── ...                  # Utilities
```

---

## Troubleshooting

**SearXNG no results:** Check `docker ps | grep searxng`, try `curl` directly

**Tools not appearing:** Run `/reload`, check `allow`/`deny` config, check `/tools` UI

**Vision errors:** Ensure model supports images, check API key is configured

---

## License

MIT
