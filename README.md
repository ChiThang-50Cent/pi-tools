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

### Subagent Routing Policy

The subagent tool is powerful but has non-trivial overhead (child process, fresh context bootstrap, model invocations). Use direct tools when they suffice.

**Do NOT delegate when:**
- The task can be solved with one direct `read`, `grep`, `find`, or `ls`
- The root agent already has enough context to answer
- The task is a tiny follow-up on the immediately preceding result

**Agent selection:**
| Task | Agent |
|------|-------|
| Find files, symbols, patterns; trace dependencies; explore repo structure | `explore` |
| Implement, refactor, debug, generate code, multi-step tasks | `general` |

**Mode selection:**
| Mode | When to use |
|------|------------|
| Single | One focused task |
| Parallel | Independent subtasks, each producing concise output |
| Chain | Step N genuinely depends on step N-1 |

**Recommended defaults:**
| Agent | spawnMode | returnMode |
|-------|-----------|------------|
| `explore` | `lean` | `summary` |
| `general` | `full` (unless lean-safe) | `summary` (orchestration) / `artifact` (large outputs) |

Use `returnMode: "inline"` only when the root truly needs the full raw output in-context. Always pass `context` when you already know relevant files, symbols, or boundaries — it saves the child from rediscovering them.

---

## Routing Examples

### ❌ Bad — direct tool would suffice
```jsonc
// Don't delegate a single file read
{ "agent": "explore", "task": "Read src/utils/config.ts" }
// Instead: use the read tool directly
```

### ✅ Good — read-only explore
```jsonc
{
  "agent": "explore",
  "task": "Find all files that import AuthModule and trace the dependency chain",
  "spawnMode": "lean",
  "returnMode": "summary",
  "context": "AuthModule is defined in src/auth/index.ts"
}
```

### ✅ Good — general implementation
```jsonc
{
  "agent": "general",
  "task": "Refactor the auth middleware to support JWT refresh tokens",
  "returnMode": "summary",
  "context": "Relevant files: src/auth/middleware.ts, src/auth/refresh.ts\nConstraint: keep backward-compatible exports"
}
```

### ✅ Good — parallel independent investigation
```jsonc
{
  "tasks": [
    { "agent": "explore", "task": "Find all React component files", "spawnMode": "lean", "returnMode": "summary" },
    { "agent": "explore", "task": "Find all API route handlers", "spawnMode": "lean", "returnMode": "summary" }
  ]
}
```

### ✅ Good — chain with true dependency
```jsonc
{
  "chain": [
    { "agent": "explore", "task": "Find the main entry point and list its imports", "spawnMode": "lean", "returnMode": "summary" },
    { "agent": "general", "task": "Based on the entry point found: {previous}\n\nFix any circular dependency issues.", "returnMode": "summary" }
  ]
}
```

---

## Prerequisites

### 1. Pi Coding Agent

```bash
# Official installer (auto-installs Node.js 22 + Pi; use >=22.18 for the broker)
curl -fsSL https://pi.dev/install.sh | sh

# Or via npm (the broker requires Node.js >= 22.18 for native TypeScript stripping)
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

### 3. Optional local search broker

For multiple Pi processes/subagents, run the broker so one loopback service owns
throttling, caching, deduplication, retries, and 429 cooldowns:

```bash
npm run search:broker
```

The broker binds to `127.0.0.1:8787` by default and calls the SearXNG URL from
`searxng` in `~/.pi/tools.json`. It accepts only loopback bind addresses. Check
it with `curl http://127.0.0.1:8787/health`. The loopback-only response keeps
`ok` and `status` and adds queue/in-flight/cache counts, cooldown remaining,
cache hit/miss totals, deduplicated waiter totals, and upstream request/error
totals; it never includes query text or URLs.

The broker also accepts `PI_SEARXNG_URL`, `PI_SEARCH_BROKER_PORT`,
`PI_SEARCH_MIN_INTERVAL_MS`, `PI_SEARCH_QUEUE_SIZE`, `PI_SEARCH_TIMEOUT_MS`,
`PI_SEARCH_MAX_RETRIES`, `PI_SEARCH_RETRY_BASE_MS`, and `PI_SEARCH_RETRY_MAX_MS`,
or matching CLI flags such as `--searxng` and `--port`.

#### Optional systemd user service

The template at `systemd/pi-tools-search-broker.service` assumes the repository
is checked out at `%h/code/pi-tools` and Node is installed at `/usr/bin/node`.
Edit those paths if needed, then install and manage it without root privileges:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/pi-tools-search-broker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pi-tools-search-broker.service
systemctl --user status pi-tools-search-broker.service
```

The unit runs Node directly, stops gracefully with SIGTERM, and restarts only
when the broker exits unsuccessfully. Do not use `sudo` or start a second broker
on the same port.

### 4. Vision Model (optional)

`analyze_image` uses a vision model configured in Pi. Any provider already set up in Pi works (OpenAI, Anthropic, Google, OpenCode, etc).

No extra installation needed — just configure the model in `~/.pi/tools.json`.

---

## Configuration

`~/.pi/tools.json`:

```json
{
  "searxng": "http://127.0.0.1:8080",
  "search": {
    "brokerUrl": "http://127.0.0.1:8787",
    "minIntervalMs": 1000,
    "queueSize": 4,
    "cacheTtlMs": 300000,
    "timeoutMs": 15000,
    "brokerWaitTimeoutMs": 120000,
    "maxRetries": 2
  },
  "vision": { "defaultModel": "opencode-go/kimi-k2.6" },
  "agents": {
    "general": { "model": "opencode-go/deepseek-v4-pro", "thinking": "medium" },
    "explore": { "model": "opencode-go/deepseek-v4-flash", "thinking": "off" }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `searxng` | `http://127.0.0.1:8080` | SearXNG URL; existing string configuration remains supported |
| `search.brokerUrl` | — | Local broker URL; unset keeps direct SearXNG mode |
| `search.minIntervalMs` | `1000` | Global interval used by direct mode/broker |
| `search.queueSize` | `4` | Maximum queued searches; existing explicit values remain supported |
| `search.cacheTtlMs` | `300000` | Successful response cache TTL |
| `search.timeoutMs` | `15000` | Upstream SearXNG request timeout; in broker mode this is owned by the broker |
| `search.brokerWaitTimeoutMs` | `120000` | Caller-to-broker HTTP wait deadline; used only when `brokerUrl` is set |
| `search.maxRetries` | `2` | Broker retries for 502/503/504/network failures |
| `vision.defaultModel` | — | Vision model (`provider/modelId`) |
| `agents.<name>.model` | — | Override model for agent |
| `agents.<name>.thinking` | — | Thinking level: `off` → `xhigh` |
| `allow` | `[]` | Whitelist tools (deny ignored) |
| `deny` | `[]` | Blacklist tools |

`search.timeoutMs` is the per-attempt upstream deadline and `search.brokerWaitTimeoutMs`
is the caller's FIFO wait deadline; they are intentionally separate. With the
defaults above, five broker flights (one active plus four queued) fit within
about 80 seconds before retries or a rate-limit cooldown. If you increase
`queueSize`, set `brokerWaitTimeoutMs` above
`(queueSize + 1) * (timeoutMs + minIntervalMs)` and allow extra time for retries
and cooldowns. The broker queue default is deliberately small to avoid long
stale FIFO waits; explicit existing `queueSize` values are not rewritten.

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
// Single — one focused task
{ "agent": "general", "task": "Refactor auth module" }

// Parallel — independent subtasks (max 8 tasks, 4 concurrent)
{ "tasks": [
  { "agent": "explore", "task": "Find .ts files" },
  { "agent": "explore", "task": "Find test files" }
]}

// Chain — step N depends on step N-1 (pass output via {previous})
{ "chain": [
  { "agent": "explore", "task": "Find entry point" },
  { "agent": "general", "task": "Refactor:\n{previous}" }
]}
```

### Return modes (compact output)

Control how subagent output is returned to the parent context:

| Mode | Behavior |
|------|----------|
| `auto` (default) | Heuristic: small outputs → inline, large → artifact; parallel always uses summary/artifact |
| `inline` | Full output in `content` (legacy behavior) |
| `summary` | Compact preview in `content`, full data in `details.results` |
| `artifact` | Full output written to temp file, short summary + path in `content` |

```jsonc
// Example: force artifact mode for a single subagent
{
  "agent": "general",
  "task": "Analyze this large codebase",
  "returnMode": "artifact"
}

// Example: tune thresholds
{
  "agent": "general",
  "task": "...",
  "returnMode": "auto",
  "artifactThresholdChars": 8000,  // switch to artifact above 8K chars
  "summaryMaxChars": 2000          // preview size in summary/artifact mode
}
```

### Timeout and live progress

Each subagent emits an initial status, tool activity, and a heartbeat every five seconds while it runs. The default wall-clock timeout is 15 minutes; use `timeoutMs` (milliseconds) at the top level or per task/chain step to override it. On timeout or cancellation, Pi terminates the child process group and returns a normal failed result rather than leaving the caller waiting indefinitely.

```jsonc
{ "agent": "general", "task": "Large migration", "timeoutMs": 1800000 }
```

### Chain handoff compaction

Chain steps pass output via `{previous}`. By default, `chainHandoffMode: "compact"` truncates large outputs to reduce token blow-up:

| Setting | Default | Description |
|---------|---------|-------------|
| `chainHandoffMode` | `compact` | `compact` truncates `{previous}`; `full` passes everything |
| `chainHandoffMaxChars` | `4000` | Max chars for compact handoff |

```jsonc
// Example: disable compaction for a chain that needs full context
{
  "chain": [...],
  "chainHandoffMode": "full"
}
```

Full outputs are always preserved in `details.results` regardless of compaction or return mode.

### Spawn mode (lean subagent bootstrap)

Control child-process bootstrap overhead. Lean mode skips loading skills, context-files, prompt-templates, and themes. Extensions are also skipped when the agent's tools are all built-in (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`).

| Mode | Description |
|------|-------------|
| `auto` (default) | Heuristic: `explore` → lean, others → full |
| `full` | Full bootstrap (current behavior) |
| `lean` | Reduced bootstrap (forces lean even for non-explore agents) |

```jsonc
// Example: force full mode for explore
{ "agent": "explore", "task": "...", "spawnMode": "full" }

// Example: force lean for general (keeps extensions if tools need them)
{ "agent": "general", "task": "...", "spawnMode": "lean" }

// Example: mix spawn modes in parallel
{
  "tasks": [
    { "agent": "explore", "task": "find .ts files", "spawnMode": "lean" },
    { "agent": "general", "task": "refactor", "spawnMode": "full" }
  ]
}
```

Effective spawn metadata (`spawnMode`, `spawnFlags`, `spawnNotes`) is preserved in `details.results`.

### Handoff context (parent→child)

Pass concise notes from the parent into child subagents — relevant files, symbols, findings, or constraints. This saves the child from rediscovering what the parent already knows. No extra LLM calls; deterministic compaction.

```jsonc
// Example: single-mode with top-level context
{
  "agent": "general",
  "task": "Refactor auth module",
  "context": "Relevant files: src/auth/index.ts, src/auth/refresh.ts\nKnown finding: refresh-token logic is split between auth and session middleware"
}

// Example: parallel with per-task context override
{
  "tasks": [
    {
      "agent": "explore",
      "task": "Find all .spec.ts files",
      "context": "Search under src/ and tests/ only"
    },
    {
      "agent": "explore",
      "task": "Find API route definitions",
      "context": "Focus on src/routes/"
    }
  ]
}

// Example: chain step context
{
  "chain": [
    {
      "agent": "explore",
      "task": "Find the entry point",
      "context": "Project is a React app — look for src/index.tsx"
    },
    {
      "agent": "general",
      "task": "Refactor based on: {previous}",
      "context": "Keep backward compatibility with existing exports"
    }
  ]
}

// Example: tune the character budget
{
  "agent": "general",
  "task": "Analyze this module",
  "context": "Very long context...",
  "contextMaxChars": 1000
}
```

Handoff metadata (`handoffContextChars`, `handoffContextTruncated`) is preserved in `details.results` for each subagent result.

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

## Subagent Benchmark

Measure the token and cost overhead of subagent execution modes.

```bash
# Run all default cases with 3 repetitions
npm run bench:subagent -- --model opencode-go/deepseek-v4-flash --runs 3

# Run a single case
npm run bench:subagent -- --case subagent-explore-lean --model opencode-go/deepseek-v4-flash

# Direct invocation
node scripts/benchmark-subagent.mjs --cases benchmarks/subagent-cases.json --model opencode-go/deepseek-v4-flash

```

### What it measures

The harness runs scenarios for three deployment modes.

#### Default cases (`benchmarks/subagent-cases.json`)

| Case | Mode | Description |
|------|------|-------------|
| `direct-explore` | Root agent directly | Agent explores using built-in tools |
| `subagent-explore-full` | Subagent / full spawn | Agent delegates to `explore` subagent with full bootstrap |
| `subagent-explore-lean` | Subagent / lean spawn | Agent delegates with lean bootstrap (skips skills, themes, etc.) |

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--cases <path>` | `benchmarks/subagent-cases.json` | Custom case file |
| `--case <id>` | (all) | Run specific case(s), comma-separated or repeatable |
| `--runs <n>` | `1` | Repetitions per case |
| `--model <p/m>` | system default | Model override (e.g. `opencode-go/deepseek-v4-flash`) |
| `--output <path>` | auto (under `benchmarks/results/`) | JSON report path |
| `--cwd <path>` | `process.cwd()` | Working directory for spawned `pi` |
| `--approve` / `--no-approve` | `--approve` | Auto-approve tool calls |
| `--verbose` | off | Print per-run progress |

### Output

- **JSON report** written to `benchmarks/results/benchmark-<timestamp>.json` (or `--output`).
- **Stdout summary** with table of mean metrics and cost deltas for the three default cases (`direct`, `subagent/full`, `subagent/lean`).

### Interpretation

Results depend on the provider/model chosen and are intended for **relative comparisons** — not absolute guarantees. Key questions it answers:

- How much more does `subagent/full` cost vs `direct`?
- How much does `subagent/lean` save vs `subagent/full`?
- How much overhead is root vs child?

### Prerequisites

- `pi` must be on `PATH` (or invoked through its own runtime).
- A configured API key for the chosen model provider.
- The benchmark makes live API calls — choose a fast/inexpensive model for iterative testing.

Normal `npm test` remains offline and unaffected.

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

**SearXNG no results:** Check `docker ps | grep searxng`, try `curl` directly. If
using the broker, check `curl http://127.0.0.1:8787/health` and inspect the
search response warnings for unresponsive engines.

**429 / Retry-After:** Keep the broker running and wait for its shared cooldown;
do not start several broker instances on the same configured port. Permanent
4xx errors are not retried; 502/503/504 and network failures are retried a
bounded number of times.

**Tools not appearing:** Run `/reload`, check `allow`/`deny` config, check `/tools` UI

**Vision errors:** Ensure model supports images, check API key is configured

---

## License

MIT
