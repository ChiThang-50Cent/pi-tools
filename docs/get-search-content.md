# `get_search_content`

Retrieves content saved by an earlier `web_search` or `fetch_content` call. Saved content is in-memory for the current Pi process/session.

## Parameters

| Parameter | Required | Description |
|---|---:|---|
| `responseId` | yes | Identifier returned by the original tool call. |
| `query` / `queryIndex` | no | Select a search query from a stored search response. |
| `url` / `urlIndex` | no | Select a URL from a stored fetch response. |

Pass one selector at a time. Omitting selectors returns all content stored for that response ID.

## Examples

```json
{ "responseId": "abc12345", "queryIndex": 0 }
```

```json
{ "responseId": "abc12345", "url": "https://example.com/page" }
```

A `not_found` response means the ID is invalid or the process/session no longer has that in-memory entry; repeat the original search or fetch in that case.
