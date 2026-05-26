# pi-tools

> Self-hosted tools for the [Pi coding agent](https://pi.dev): web search, code search, image analysis, content fetching, and subagent delegation.
> **No external API keys required** — everything runs locally via SearXNG + Ollama.

## Quick Install

```bash
pi install git:github.com/ChiThang-50Cent/pi-tools
```

Or try without installing:

```bash
pi -e git:github.com/ChiThang-50Cent/pi-tools
```

---

## What You Get

Six self-hosted tools, plus two built-in subagents:

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via SearXNG (real-time info, news, docs) |
| `code_search` | Search code on GitHub, StackOverflow, PyPI, docs.rs |
| `analyze_image` | Vision analysis via Ollama (Vietnamese + English) |
| `fetch_content` | Fetch URLs & GitHub repos, extract readable markdown |
| `get_search_content` | Retrieve cached results from prior `web_search` / `fetch_content` |
| `subagent` | Delegate tasks to isolated subagents (single / parallel / chain) |

**Built-in subagents:**

| Agent | Description | Tools |
|-------|-------------|-------|
| `general` | General-purpose subagent for complex, multi-step tasks | All |
| `explore` | Fast, read-only codebase explorer | `read`, `bash`, `ls`, `find` |

---

## Prerequisites

### 1. Pi Coding Agent

```bash
# Official installer (auto-installs Node.js 22 + Pi)
curl -fsSL https://pi.dev/install.sh | sh

# Or manually via npm (requires Node.js >= 22)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Verify
pi --version
```

### 2. Install SearXNG

SearXNG is a privacy-respecting metasearch engine. It powers `web_search` and `code_search`.

#### Option A: Docker (recommended)

```bash
# Pull and run
docker run -d --name searxng \
  -p 8080:8080 \
  -v searxng-config:/etc/searxng \
  searxng/searxng:latest

# Verify it's working
curl "http://127.0.0.1:8080/search?q=hello+world&format=json"
```

#### Option B: Docker Compose

```yaml
# docker-compose.yml
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
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

#### Option C: Bare metal

```bash
# See official docs: https://docs.searxng.org/admin/installation-searxng.html
# Requires: Python 3.11+, virtualenv, git

git clone https://github.com/searxng/searxng.git
cd searxng
python3 -m venv venv
source venv/bin/activate
pip install -e .
# Edit settings.yml: set server.port=8080, server.bind_address="0.0.0.0"
python searx/webapp.py
```

#### Verify SearXNG

```bash
# Should return JSON results
curl "http://127.0.0.1:8080/search?q=pi+coding+agent&format=json"

# Or open in browser
open http://127.0.0.1:8080
```

> **Tip:** If SearXNG runs on a different host or port, override the URL in `~/.pi/tools.json` (see [Manual Configuration](#manual-configuration)).

### 3. Install Ollama

Ollama runs large language models locally. It powers `analyze_image`.

#### Option A: Official installer (Linux / macOS)

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### Option B: macOS via Homebrew

```bash
brew install ollama
```

#### Option C: Windows

Download from [ollama.com](https://ollama.com/download) and run the installer.

#### Option D: Manual install (Linux)

```bash
# Download binary
curl -L https://ollama.com/download/ollama-linux-amd64.tgz -o ollama.tgz
tar -xzf ollama.tgz
sudo mv ollama /usr/local/bin/

# Run as background service
ollama serve
```

#### Pull the vision model

```bash
# Pull gemma3:4b (default vision model — ~3GB)
ollama pull gemma3:4b

# Or use a different vision-capable model
ollama pull llava:13b        # ~8GB
ollama pull minicpm-v:8b     # ~5GB
ollama pull llama3.2-vision  # ~8GB
```

#### Verify Ollama

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Test the vision model
ollama run gemma3:4b "Describe a red apple in one sentence."
```

> **Tip:** If Ollama runs on a different host or you use a different model, override in `~/.pi/tools.json` (see [Manual Configuration](#manual-configuration)).

---

## Install pi-tools

### From GitHub (recommended)

```bash
pi install git:github.com/ChiThang-50Cent/pi-tools
```

### From local clone

```bash
git clone https://github.com/ChiThang-50Cent/pi-tools.git
pi install ~/code/pi-tools
```

### One-shot (try without installing)

```bash
pi -e git:github.com/ChiThang-50Cent/pi-tools
```

After installation, restart Pi or type `/reload` for tools to appear.

---

## How to Use Tools

### Enable / Disable Tools at Runtime

Type `/tools` in a Pi session to open the settings UI:

```
┌─────────────────────────────────────────┐
│  pi-tools    ↑↓ navigate  Enter toggle  │
├─────────────────────────────────────────┤
│  web_search            enabled          │
│  code_search           enabled          │
│  analyze_image         disabled         │
│  fetch_content         enabled          │
│  get_search_content    enabled          │
│  subagent              enabled          │
└─────────────────────────────────────────┘
```

- **↑↓** — navigate between tools
- **Enter** — toggle between `enabled` / `disabled`
- **Esc** — close settings

Enabled/disabled state persists across sessions (saved to your session branch). Tools blocked by `allow`/`deny` config show as `blocked` and cannot be toggled at runtime.

### Understanding allow vs deny vs runtime toggle

There are **two layers** of tool control:

| Layer | Where | Effect |
|-------|-------|--------|
| **Registration** (allow/deny) | `~/.pi/tools.json` | Controls whether a tool is registered at all. If a tool is not registered, the agent cannot call it. |
| **Runtime toggle** (enable/disable) | `/tools` command in-session | Controls whether a registered tool is active right now. Persists across sessions. |

**How allow/deny works:**

- `allow` is non-empty → **only** tools in the allow list are registered (deny is ignored)
- `deny` is non-empty (and allow is empty) → all tools **except** those in deny are registered
- Both empty → **all 6 tools** are registered

**Examples:**

```jsonc
// Only register web_search and subagent — everything else is unavailable
{ "allow": ["web_search", "subagent"] }

// Register everything except analyze_image
{ "deny": ["analyze_image"] }

// By default (no config) — all 6 tools are registered
```

Registered tools can still be disabled at runtime via `/tools`. Unregistered tools show as `blocked` in the UI and cannot be enabled.

### Using Tools in Conversation

Once a tool is registered and enabled, the agent can call it automatically. Just ask:

```
> Search the web for "pi coding agent documentation"
  → agent calls web_search tool

> Look at this screenshot and tell me what's wrong
  → agent calls analyze_image tool

> Fetch the README from https://github.com/user/repo
  → agent calls fetch_content tool

> Delegate this refactoring to a subagent
  → agent calls subagent tool
```

---

## Manual Configuration

Create `~/.pi/tools.json` to customize backends, models, and tool access:

### Full Configuration Reference

```json
{
  "searxng": "http://192.168.1.100:8080",
  "ollama": "http://192.168.1.200:11434",
  "visionModel": "llava:13b",
  "allow": ["web_search", "code_search", "subagent"],
  "deny": [],
  "agents": {
    "general": {
      "model": "claude-sonnet-4-5",
      "thinking": "high"
    },
    "explore": {
      "model": "deepseek-v4-flash",
      "thinking": "off"
    }
  }
}
```

### All Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `searxng` | `string` | `http://127.0.0.1:8080` | SearXNG instance URL. Trailing slashes are stripped automatically. |
| `ollama` | `string` | `http://localhost:11434` | Ollama API URL. Trailing slashes are stripped automatically. |
| `visionModel` | `string` | `gemma3:4b` | Ollama model name for vision/image analysis. Must be a vision-capable model (currently only gemma3:4b supports Vietnamese). |
| `allow` | `string[]` | `[]` (all tools) | If non-empty, **only** these tools are registered. `deny` is ignored when `allow` is set. |
| `deny` | `string[]` | `[]` | Tools to exclude from registration. Only applies when `allow` is empty or unset. |
| `agents` | `object` | `{}` | Per-agent model/thinking overrides. Key = agent name, value = `{ model?, thinking?, tasks? }`. |

### Config Scenarios

#### Use SearXNG on a remote server

```json
{
  "searxng": "http://my-server.local:8080"
}
```

#### Use a different vision model

```json
{
  "visionModel": "llava:13b"
}
```

> **Note:** Changing the vision model may affect Vietnamese language support. `gemma3:4b` is recommended for mixed Vietnamese/English workflows.

#### Only allow web_search and code_search

```json
{
  "allow": ["web_search", "code_search"]
}
```

#### Disable image analysis only

```json
{
  "deny": ["analyze_image"]
}
```

#### Override subagent models

```json
{
  "agents": {
    "general": {
      "model": "gpt-5.2-codex",
      "thinking": "high"
    },
    "explore": {
      "model": "deepseek-v4-flash",
      "thinking": "off"
    }
  }
}
```

The config file is read at session start. Changes take effect on next session or after `/reload`.

### Custom Subagents

Create `.md` files with YAML frontmatter in `~/.pi/agents/` (user scope) or `.pi/agents/` (project scope):

```markdown
---
name: code-reviewer
description: Reviews code for bugs, style, and security issues
tools: read, bash, edit, write
model: claude-sonnet-4-5
thinking: high
task_categories: [review, audit, security]
---
You are a senior code reviewer. When reviewing code:
1. First read the full file before suggesting changes
2. Check for bugs, security issues, and style problems
3. Suggest concrete fixes with code examples
4. Explain WHY each change is needed
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent name (used in `{ agent: "name" }`). User/project agents override built-in agents with the same name. |
| `description` | No | Shown in the subagent UI and help text |
| `tools` | No | Comma-separated tool names (e.g. `read, bash, edit`). If omitted, the agent inherits parent tools. |
| `model` | No | Override the model for this agent |
| `thinking` | No | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `task_categories` | No | Comma-separated categories for agent discovery (e.g. `review, debug, refactor`) |

Agents are discovered from three sources (in priority order, later overrides earlier):
1. **Built-in** — `general` and `explore`
2. **User** — `~/.pi/agents/*.md`
3. **Project** — `.pi/agents/*.md`

---

## Subagent Modes

```jsonc
// Single agent
{ "agent": "general", "task": "Refactor the auth module" }

// Parallel (up to 8 agents, 4 concurrent)
{ "tasks": [
  { "agent": "explore", "task": "Find all .ts files" },
  { "agent": "explore", "task": "Find all test files" }
]}

// Chain (passes output via {previous})
{ "chain": [
  { "agent": "explore", "task": "Find the entry point" },
  { "agent": "general", "task": "Refactor using this info:\n{previous}" }
]}
```

---

## Project Structure

```
pi-tools/
├── package.json                    # Pi package manifest
├── extensions/tools/
│   ├── index.ts                    # Entry point — registers all 6 tools + /tools command
│   ├── tools/
│   │   ├── web_search.ts           # SearXNG web search
│   │   ├── code_search.ts          # Code search (GitHub, SO, PyPI, docs.rs)
│   │   ├── analyze_image.ts        # Vision via Ollama
│   │   ├── fetch_content.ts        # URL/HTML → markdown
│   │   ├── get_search_content.ts   # Retrieve cached results
│   │   └── subagent/               # Subagent delegation
│   │       ├── index.ts            # Tool registration
│   │       ├── schemas.ts          # Parameter schemas (TypeBox)
│   │       ├── descriptors.ts      # Agent description builder
│   │       ├── runner.ts           # Agent spawn & execution
│   │       ├── render.ts           # TUI output rendering
│   │       └── types.ts            # Shared types
│   ├── ui/
│   │   └── tools_settings.ts       # /tools command TUI
│   └── lib/
│       ├── config.ts               # Config loader (~/.pi/tools.json)
│       ├── search.ts               # SearXNG API client
│       ├── fetch.ts                # HTTP fetch + HTML stripping
│       ├── ollama.ts               # Ollama vision API client
│       ├── store.ts                # In-memory content store
│       ├── agents.ts               # Agent discovery & orchestration
│       ├── invoke.ts               # Pi child process spawner
│       ├── concurrency.ts          # Concurrency limiter
│       ├── format.ts               # TUI output formatting
│       ├── truncate.ts             # Output truncation
│       ├── image.ts                # Image loading & validation
│       └── types.ts                # Shared TypeScript types
```

---

## Dependencies

Pi bundles core packages. These are declared as `peerDependencies` and are **not bundled**:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

No other npm runtime dependencies. SearXNG and Ollama are external services.

---

## Troubleshooting

### SearXNG returns no results

```bash
# Check if the container is running
docker ps | grep searxng

# Check container logs
docker logs searxng

# Test search directly
curl "http://127.0.0.1:8080/search?q=test&format=json"
```

Common fixes:
- Some networks block SearXNG's upstream engines. Try setting `search.formats: ["html"]` in SearXNG `settings.yml`.
- If behind a proxy, set `http_proxy` environment variable for the Docker container.

### Ollama connection refused

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama if not running
ollama serve

# On Linux, check if the systemd service is active
systemctl status ollama
```

### Image analysis returns errors

- Make sure a vision-capable model is pulled: `ollama list`
- The default model `gemma3:4b` requires ~3GB of disk space and ~6GB of RAM
- If you see timeout errors, increase Ollama's `OLLAMA_KEEP_ALIVE` or use a faster model

### Tools not appearing in Pi

1. Check `/reload` was run after install
2. Check `pi list` to confirm pi-tools is installed
3. Check `allow`/`deny` in `~/.pi/tools.json` isn't blocking the tool
4. Check `/tools` UI — the tool might be disabled at runtime

---

## License

MIT
