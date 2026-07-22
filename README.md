# pi-tools

> Self-hosted tools for the [Pi coding agent](https://pi.dev): web search, code search, content fetching, and subagent delegation.

## Quick install

```bash
pi install git:github.com/ChiThang-50Cent/pi-tools
```

Node.js **22.18+** is required for the local search broker.

## Tools

| Tool | Description | Documentation |
|---|---|---|
| `web_search` | Current web information through SearXNG | [`docs/web-search.md`](docs/web-search.md) |
| `code_search` | Code examples, API usage, and error lookups | [`docs/code-search.md`](docs/code-search.md) |
| `fetch_content` | Web pages, GitHub repositories, text, and JSON | [`docs/fetch-content.md`](docs/fetch-content.md) |
| `get_search_content` | Saved content from previous search/fetch calls | [`docs/get-search-content.md`](docs/get-search-content.md) |
| `subagent` | Isolated exploration and implementation tasks | [`docs/subagent.md`](docs/subagent.md) |

## Local search quick start

1. Set up loopback-only SearXNG, select audited engines, and optionally install the broker: [SearXNG and the local search broker](docs/searxng.md).
2. Configure pi-tools:

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
  }
}
```

The broker is optional for one Pi process. Keep it enabled when root and subagent processes share SearXNG; it owns cross-process throttling, caching, deduplication, retries, and shared cooldowns.

## More documentation

- [Documentation index](docs/README.md)
- [SearXNG and broker setup](docs/searxng.md)
- [Subagent modes, lifecycle, and custom agents](docs/subagent.md)
- [Subagent benchmark](docs/benchmark.md)
- [Changelog](CHANGELOG.md)

## Project layout

```text
extensions/tools/
├── index.ts                 # Extension entry point
├── tools/                   # Tool registrations
│   └── subagent/            # Subagent execution and rendering
└── lib/                     # Search, broker, fetch, config, and shared utilities
systemd/                     # Optional broker user service
benchmarks/                  # Benchmark cases and generated reports
```

## License

MIT
