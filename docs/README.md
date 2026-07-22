# pi-tools documentation

## Setup and operations

- [SearXNG and the local search broker](searxng.md)
- [Subagent benchmark](benchmark.md)

## Tools

- [`web_search`](web-search.md)
- [`code_search`](code-search.md)
- [`fetch_content`](fetch-content.md)
- [`get_search_content`](get-search-content.md)
- [`subagent`](subagent.md)

## Runtime tool selection

Use `/tools` in Pi to enable or disable registered tools for the current session. State persists across sessions.

`~/.pi/tools.json` can limit tool registration:

```jsonc
// Register only these tools.
{ "allow": ["web_search", "subagent"] }

// Register everything except this tool.
{ "deny": ["fetch_content"] }
```

`allow` takes precedence when it is non-empty. See the relevant tool page for its configuration.
