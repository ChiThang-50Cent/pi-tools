# `subagent`

Delegates a scoped task to an isolated child Pi process. Built-in agents are `explore` for read-only investigation and `general` for implementation, debugging, and multi-step work.

## Choose a mode

| Mode | Use it when |
|---|---|
| Single | One focused task. |
| Parallel | Independent tasks that can return concise outputs. Maximum eight tasks, four concurrent. |
| Chain | Step N requires output from step N-1. Use `{previous}` in a later task. |

Do not delegate a known file read, a simple grep/listing, or a tiny follow-up when the root already has the needed context.

## Single task

```json
{
  "agent": "general",
  "task": "Refactor the auth module",
  "context": "Relevant files: src/auth/index.ts, src/auth/refresh.ts",
  "returnMode": "summary"
}
```

## Parallel tasks

```json
{
  "tasks": [
    {
      "agent": "explore",
      "task": "Find all API route definitions",
      "context": "Focus on src/routes/",
      "spawnMode": "lean"
    },
    {
      "agent": "explore",
      "task": "Find test coverage for API routes",
      "spawnMode": "lean"
    }
  ],
  "returnMode": "summary"
}
```

## Chain

```json
{
  "chain": [
    { "agent": "explore", "task": "Find the application entry point" },
    {
      "agent": "general",
      "task": "Refactor based on these findings:\n{previous}",
      "context": "Keep existing exports backward compatible"
    }
  ]
}
```

## Parameters

| Parameter | Default | Description |
|---|---|---|
| `agent` / `tasks` / `chain` | — | Select one execution mode. |
| `context` | — | Concise parent findings; per-task/per-step `context` overrides it. |
| `contextMaxChars` | `2000` | Deterministic context compaction budget (1–1,000,000). |
| `cwd` | current directory | Child working directory. |
| `model` | active parent model | Override in `provider/modelId` form; task/tool/config/agent overrides take precedence. |
| `thinking` | inherited | `off` through `xhigh`. |
| `timeoutMs` | `900000` | Total wall-clock timeout, including prompt setup (1,000–21,600,000 ms). Per-task/per-step takes precedence. |
| `spawnMode` | `auto` | Child bootstrap mode. |
| `returnMode` | `auto` | Parent-facing output mode. |

## Spawn mode

| Mode | Behavior |
|---|---|
| `auto` | `explore` normally uses lean startup; other agents use full startup. |
| `full` | Loads the normal child bootstrap. |
| `lean` | Skips skills, context files, prompt templates, and themes. Extensions are skipped when all requested tools are built-in. |

Use `lean` for focused exploration; use `full` when the task depends on extension tools or normal bootstrap context.

## Return mode

| Mode | Behavior |
|---|---|
| `auto` | Small output inline; large output becomes an artifact. Parallel output is summarized/artifacted. |
| `inline` | Complete output in parent context. |
| `summary` | Compact preview in parent context; complete output stays in `details.results`. |
| `artifact` | Writes complete output to a temporary artifact and returns its path. |

`artifactThresholdChars` and `summaryMaxChars` tune automatic/summary output. Full results are always preserved in `details.results`.

## Chain handoff

`chainHandoffMode: "compact"` is the default and bounds `{previous}` to `chainHandoffMaxChars` (default `4000`). Set `chainHandoffMode: "full"` only when the next step genuinely needs the full predecessor output.

## Lifecycle and cancellation

The runner emits initial status, tool activity, and a five-second heartbeat while a child runs. Default timeout is 15 minutes and covers prompt setup plus execution. On timeout or parent cancellation it terminates the child process group (using `taskkill /T` on Windows), force-settles after the kill grace period, and returns a controlled failed result instead of leaving the caller waiting. Stdout buffering, stored transcript messages, and stderr are each capped at 1 MiB; truncation is recorded in diagnostics.

## Custom agents

Create agent markdown files in `~/.pi/agents/` or `.pi/agents/`:

```markdown
---
name: code-reviewer
description: Reviews code for bugs and security
tools: read, bash, edit
model: provider/modelId
thinking: high
task_categories: review, audit
---
You are a senior code reviewer...
```

Later discovery sources override earlier ones: built-in, then user, then project agents. Project-local agents require confirmation by default. In a headless session, requests using a project agent fail closed unless `confirmProjectAgents: false` explicitly opts in.

For measured overhead and CLI usage, see the [subagent benchmark](benchmark.md).
