# Subagent benchmark

The benchmark harness measures relative token, latency, and cost overhead of direct work versus `subagent` full and lean spawn modes. It makes live model calls; normal `npm test` remains offline.

## Run it

```bash
# All default cases, three repetitions
npm run bench:subagent -- --model opencode-go/deepseek-v4-flash --runs 3

# One case
npm run bench:subagent -- --case subagent-explore-lean --model opencode-go/deepseek-v4-flash

# Direct invocation
node scripts/benchmark-subagent.mjs --cases benchmarks/subagent-cases.json --model opencode-go/deepseek-v4-flash
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--cases <path>` | `benchmarks/subagent-cases.json` | Custom case file. |
| `--case <id>` | all | Case IDs, comma-separated or repeatable. |
| `--runs <n>` | `1` | Repetitions. |
| `--model <provider/model>` | configured default | Model override. |
| `--output <path>` | generated under `benchmarks/results/` | JSON report destination. |
| `--cwd <path>` | current directory | Working directory for child Pi. |
| `--approve` / `--no-approve` | `--approve` | Tool-call approval mode. |
| `--verbose` | off | Print per-run progress. |

Results are comparative measurements, not guarantees; use the same provider/model and representative tasks when comparing modes.
