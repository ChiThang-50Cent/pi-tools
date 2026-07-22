# `web_search`

Searches current web information through the configured SearXNG instance.

## Parameters

| Parameter | Required | Description |
|---|---:|---|
| `query` | yes | Focused search query; 3–5 terms often work well. |
| `max_results` | no | Result limit from 1 to 20; defaults to 10. |
| `category` | no | SearXNG category such as `general`, `news`, `images`, `videos`, `it`, `science`, or `files`; defaults to `general`. |

## Use it for

- Current facts, releases, news, or external documentation.
- A specific question that needs sources beyond the model's existing context.

Use [`code_search`](code-search.md) for API usage, error messages, and programming examples.

## Query rules

- Reuse relevant results instead of repeating an equivalent query.
- Use one well-formed query; do not issue equivalent queries in parallel.
- SearXNG forwards queries to multiple engines, so advanced operators are not portable. Use at most one `site:` filter per request.
- Search two domains with two sequential queries. `site:one.example OR site:two.example` can return zero results even when both domains have matches.
- If results include engine warnings, treat them as partial results and wait for any stated cooldown before retrying.

## Result format

Results contain title, URL, optional snippet, and the contributing engine. A zero-result response without a warning means the active engines found no matching documents; it is not necessarily a broker failure. Check the broker health endpoint described in [SearXNG and the local search broker](searxng.md) when diagnosing persistent failures.
