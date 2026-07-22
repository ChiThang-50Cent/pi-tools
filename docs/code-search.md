# `code_search`

Searches for code examples, API usage, library documentation, and error-message explanations through SearXNG.

## Parameters

| Parameter | Required | Description |
|---|---:|---|
| `query` | yes | Programming question, API name, error message, or implementation topic. |

The tool targets programming-oriented sources such as GitHub, Stack Overflow, docs.rs, and PyPI, then returns up to 10 result snippets.

## Use it for

- API references and library usage examples.
- Compiler/runtime error messages.
- Package, repository, or implementation searches.

Use [`web_search`](web-search.md) for general news or non-code research.

## Search behavior

- Make one specific query, then inspect its results before issuing another.
- Reuse relevant code-search results already present in the conversation.
- Engine warnings mean a partial response. Do not immediately retry rate-limited queries; wait for the broker cooldown.
- Public-engine query syntax is not fully portable. If a narrow domain-filtered query returns zero results, simplify the query or search one source at a time with `web_search`.
