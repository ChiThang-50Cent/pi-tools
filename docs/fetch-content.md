# `fetch_content`

Fetches readable content from web pages, GitHub repositories, and plain text or JSON endpoints.

## Parameters

| Parameter | Required | Description |
|---|---:|---|
| `url` | one of `url` / `urls` | One URL to fetch. |
| `urls` | one of `url` / `urls` | Multiple URLs to fetch. Each is processed in order. |
| `forceClone` | no | Force cloning a large GitHub repository when needed. |

## Behavior

- GitHub URLs use repository-aware metadata/content extraction; other URLs use page or JSON extraction.
- The tool emits progress for each URL and returns successful and failed items together.
- Long inline content is truncated, while the complete extracted content remains available from [`get_search_content`](get-search-content.md) using the returned `responseId`.

## Examples

```json
{ "url": "https://docs.searxng.org/admin/installation-docker.html" }
```

```json
{ "urls": ["https://example.com/a", "https://example.com/b"] }
```
