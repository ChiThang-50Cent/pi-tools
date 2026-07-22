# Changelog

## Unreleased

### Added
- Loopback-only local search broker with cross-process throttling, caching, single-flight deduplication, retries, cooldowns, and health metrics.
- Broker systemd user-service template and configuration options.
- Local-only SearXNG setup guide with a minimal `keep_only` engine profile.
- Subagent benchmark harness at `scripts/benchmark-subagent.mjs`.
- Default benchmark cases at `benchmarks/subagent-cases.json`.
- Subagent output compaction helper in `extensions/tools/tools/subagent/output.ts`.
- Lean spawn planning helper in `extensions/tools/tools/subagent/spawn.ts`.
- Parent→child handoff helper in `extensions/tools/tools/subagent/handoff.ts`.
- Offline tests for benchmark, spawn, handoff, output, and descriptor behavior.

### Changed
- Moved setup and per-tool documentation from the root README into `docs/`.
- `web_search` and `code_search` can use the shared local search broker and report partial-engine warnings.
- Added compact root return modes for `subagent`: `auto`, `inline`, `summary`, `artifact`.
- Added deterministic chain handoff compaction with `chainHandoffMode` and `chainHandoffMaxChars`.
- Added spawn planning with `spawnMode` support at top-level, parallel task, and chain step scope.
- Added parent→child `context` and `contextMaxChars` handoff support.
- Subagents now inherit the active parent model when no task, tool, config, or agent model is specified.
- Subagent parameter schemas now reject empty tasks/agents and out-of-range timeouts, budgets, and parallel task counts.
- Strengthened routing guidance in subagent descriptors to reduce unnecessary delegation.
- Stabilized descriptor/config ordering to improve prompt-cache friendliness.
- Updated `README.md` and `package.json` for the benchmark harness and new subagent options.
- Ignored generated benchmark reports via `.gitignore`.

### Fixed
- Parse complete successful broker responses before limiting diagnostic error bodies, preventing large search responses from incorrectly rendering as zero results.
- Subagent lifecycle now provides progress heartbeats, bounded total wall-clock timeouts (including prompt setup), process-tree cancellation, force-settling after cancellation, and capped stdout/transcript/stderr capture.
- Subagent return modes now render the parent-facing summary/artifact content consistently; failed chains also follow their selected return policy.
- Repeated subagent artifacts no longer overwrite each other.
- Headless requests for project-local agents now fail closed unless `confirmProjectAgents: false` explicitly opts in.

### Removed
- Removed the `analyze_image` tool and its image/vision implementation.

### Notes
- Search-engine query operators are not portable; use one `site:` filter per search instead of combining sites with `OR`.
- Experimental advanced parallel/chain/context benchmark suite was intentionally removed after measurement did not show reliable system improvement.
