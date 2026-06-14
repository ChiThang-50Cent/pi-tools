# Changelog

## Unreleased

### Added
- Subagent benchmark harness at `scripts/benchmark-subagent.mjs`.
- Default benchmark cases at `benchmarks/subagent-cases.json`.
- Subagent output compaction helper in `extensions/tools/tools/subagent/output.ts`.
- Lean spawn planning helper in `extensions/tools/tools/subagent/spawn.ts`.
- Parent→child handoff helper in `extensions/tools/tools/subagent/handoff.ts`.
- Offline tests for benchmark, spawn, handoff, output, and descriptor behavior.

### Changed
- Added compact root return modes for `subagent`: `auto`, `inline`, `summary`, `artifact`.
- Added deterministic chain handoff compaction with `chainHandoffMode` and `chainHandoffMaxChars`.
- Added spawn planning with `spawnMode` support at top-level, parallel task, and chain step scope.
- Added parent→child `context` and `contextMaxChars` handoff support.
- Strengthened routing guidance in subagent descriptors to reduce unnecessary delegation.
- Stabilized descriptor/config ordering to improve prompt-cache friendliness.
- Updated `README.md` and `package.json` for the benchmark harness and new subagent options.
- Ignored generated benchmark reports via `.gitignore`.

### Notes
- Experimental advanced parallel/chain/context benchmark suite was intentionally removed after measurement did not show reliable system improvement.
