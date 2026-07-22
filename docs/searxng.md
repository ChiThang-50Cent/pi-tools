# SearXNG and the local search broker

`web_search` and `code_search` use a local SearXNG JSON API. The recommended deployment is loopback-only, without Redis/Valkey, plus the optional pi-tools broker for root and subagent processes.

## Local-only SearXNG

Do not publish SearXNG with `-p 8080:8080`; that exposes it on every host interface.

```bash
export SEARX_DIR="$HOME/.local/share/pi-tools/searxng"
mkdir -p "$SEARX_DIR/config" "$SEARX_DIR/data"
openssl rand -hex 32  # copy this value into secret_key below
```

Create `$SEARX_DIR/config/settings.yml`:

```yaml
# Keep only sources audited from this host/network.
use_default_settings:
  engines:
    keep_only:
      - bing
      - yandex

server:
  secret_key: "replace-with-the-random-value"

search:
  formats:
    - html
    - json

# Bing and Yandex are disabled in upstream defaults.
engines:
  - name: bing
    disabled: false
  - name: yandex
    disabled: false
```

The sample profile is the current low-fan-out profile used by pi-tools. Provider behavior changes by IP, region, and query rate: audit candidate engines sequentially before changing `keep_only`.

```bash
docker run -d --name pi-tools-searxng --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v "$SEARX_DIR/config:/etc/searxng" \
  -v "$SEARX_DIR/data:/var/cache/searxng" \
  searxng/searxng:latest

curl --get 'http://127.0.0.1:8080/search' \
  --data-urlencode 'q=SearXNG health check' \
  --data-urlencode 'format=json' \
  --data-urlencode 'categories=general'
```

For Compose, mount the same directories and publish `127.0.0.1:8080:8080`. See the [official container guide](https://docs.searxng.org/admin/installation-docker.html) and [settings reference](https://docs.searxng.org/admin/settings/settings.html) for upgrades and engine-specific options.

## Local search broker

The broker provides cross-process FIFO throttling, cache/single-flight deduplication, bounded retries, and a shared 429 cooldown. It is local-only at `127.0.0.1:8787`.

```bash
npm run search:broker
curl http://127.0.0.1:8787/health
```

Install the optional user service:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/pi-tools-search-broker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pi-tools-search-broker.service
systemctl --user status pi-tools-search-broker.service
```

The template assumes the checkout is `%h/code/pi-tools` and Node is `/usr/bin/node`; edit it if necessary. Do not use `sudo` and do not run two brokers on the same port.

## `~/.pi/tools.json`

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

| Field | Default | Description |
|---|---|---|
| `searxng` | `http://127.0.0.1:8080` | SearXNG URL. |
| `search.brokerUrl` | unset | Local broker URL; unset uses direct SearXNG mode. |
| `search.minIntervalMs` | `1000` | Minimum interval between upstream requests. |
| `search.queueSize` | `4` | Maximum queued distinct searches. |
| `search.cacheTtlMs` | `300000` | Successful response cache TTL. |
| `search.timeoutMs` | `15000` | Upstream request deadline. |
| `search.brokerWaitTimeoutMs` | `120000` | Caller-to-broker wait deadline. |
| `search.maxRetries` | `2` | Retry count for network and 502/503/504 failures. |

Increase `brokerWaitTimeoutMs` if you increase `queueSize`; it must cover FIFO waiting, request time, retries, and any shared cooldown.

## Troubleshooting

- **No results with no warning:** the active engines found no match. Simplify the query or remove non-portable operators.
- **Engine warning / 429:** results are partial. Wait for the shared cooldown instead of retrying immediately.
- **Broker unavailable:** inspect `systemctl --user status pi-tools-search-broker.service` and `curl http://127.0.0.1:8787/health`.
