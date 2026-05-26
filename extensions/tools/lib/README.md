# 📦 pi-tools — Tài liệu thư viện `lib/`

Thư mục `lib/` chứa **12 module TypeScript** (~30 export) cung cấp các tiện ích nền tảng cho pi-tools: quản lý agent, gọi HTTP, tìm kiếm, xử lý ảnh, định dạng hiển thị, v.v. Dưới đây là mô tả ngắn gọn từng module.

---

## 🧠 `agents.ts` — Khám phá & quản lý agent

Phát hiện và nạp cấu hình agent từ ba nguồn: **built-in**, **user** (`~/.pi/agents/`), và **project** (`.pi/agents/` trong thư mục dự án).

| Export | Loại | Mô tả |
|--------|------|-------|
| `AgentScope` | type | `"user"` \| `"project"` \| `"both"` — phạm vi tìm kiếm agent |
| `AgentSource` | type | `"builtin"` \| `"user"` \| `"project"` — nguồn gốc của agent |
| `AgentConfig` | interface | Cấu trúc cấu hình agent: tên, mô tả, tools, model, thinking, task categories, system prompt |
| `AgentDiscoveryResult` | interface | Kết quả trả về: danh sách agent + đường dẫn thư mục project agents |
| `discoverAgents` | function | **(chính)** Quét thư mục user/project, nạp file `.md` (có frontmatter), merge với built-in agents theo scope. Ưu tiên: built-in < user < project |

---

## ⚡ `concurrency.ts` — Giới hạn đồng thời

| Export | Loại | Mô tả |
|--------|------|-------|
| `mapWithConcurrencyLimit` | async function | Chạy `fn` bất đồng bộ trên mảng `items` với giới hạn số **worker song song** (`concurrency`). Giữ nguyên thứ tự kết quả. Hữu ích khi cần throttle nhiều HTTP request cùng lúc. |

---

## ⚙️ `config.ts` — Cấu hình toàn cục

Đọc và cache cấu hình từ `~/.pi/tools.json`. Cung cấp các getter tiện lợi cho từng trường cấu hình.

| Export | Loại | Mô tả |
|--------|------|-------|
| `ToolsConfig` | interface | Cấu trúc file config: `searxng`, `ollama`, `visionModel`, `agents`, `allow`, `deny` |
| `loadConfig` | function | Đọc & parse `tools.json` (không cache) |
| `getSearXNGUrl` | function | Trả về URL SearXNG (mặc định `http://127.0.0.1:8080`) |
| `getOllamaUrl` | function | Trả về URL Ollama (mặc định `http://localhost:11434`) |
| `getVisionModel` | function | Trả về tên model vision (mặc định `gemma3:4b`) |
| `getAgentModelConfig` | function | Merge cấu hình model/thinking của agent từ `tools.json` + frontmatter agent |
| `isToolAllowed` | function | Kiểm tra tool có được phép đăng ký không: allowlist > denylist > tất cả |

---

## 🌐 `fetch.ts` — HTTP client & xử lý HTML

Fetch nội dung web và GitHub repo, loại bỏ HTML tags.

| Export | Loại | Mô tả |
|--------|------|-------|
| `MAX_INLINE_CONTENT` | const | `30000` — giới hạn độ dài nội dung inline (JSON/text) |
| `stripHtml` | function | Loại bỏ thẻ `<script>`, `<style>`, HTML tags, decode HTML entities, chuẩn hóa khoảng trắng |
| `fetchPageContent` | async function | Fetch URL bất kỳ, tự động parse JSON hoặc strip HTML, trả về `{url, title, content}`. Timeout 20s |
| `fetchGitHub` | async function | Parse GitHub URL → gọi GitHub API lấy metadata (stars, language, license, topics…), format thành markdown |

---

## 🎨 `format.ts` — Định dạng hiển thị

Các hàm format dùng trong TUI để hiển thị số liệu thân thiện.

| Export | Loại | Mô tả |
|--------|------|-------|
| `formatTokens` | function | `12345` → `"12.3k"`, `1200000` → `"1.2M"` |
| `formatUsageStats` | function | Format thống kê usage: số turns, token input/output, cache read/write, chi phí, context tokens, model |
| `formatToolCall` | function | Format lời gọi tool (bash, read, write, edit, ls, find, grep…) với màu sắc TUI theme |

---

## 🖼️ `image.ts` — Load ảnh

| Export | Loại | Mô tả |
|--------|------|-------|
| `loadImageBytes` | async function | Nhận source (data URI, URL, hoặc local path), load & validate (max 20MB), trả về `{base64, mime}` |

---

## 🚀 `invoke.ts` — Gọi tiến trình pi con

| Export | Loại | Mô tả |
|--------|------|-------|
| `getPiInvocation` | function | Xác định command + args để spawn tiến trình pi con. Xử lý cả trường hợp chạy qua `node`/`bun` trực tiếp, `bun` virtual script, và fallback về `pi` binary |

---

## 🦙 `ollama.ts` — Ollama Vision API

| Export | Loại | Mô tả |
|--------|------|-------|
| `ollamaVision` | async function | Gửi ảnh (base64) + prompt text đến Ollama `/api/generate`, trả về text response từ model vision. Timeout 120s, keep_alive 5 phút |

---

## 🔍 `search.ts` — SearXNG API

| Export | Loại | Mô tả |
|--------|------|-------|
| `SearXNGResult` | interface | Cấu trúc một kết quả: `title`, `url`, `content?`, `engine?` |
| `searchSearXNG` | async function | Gọi SearXNG `/search?format=json` với query, categories, limit (max 50). Timeout 15s |

---

## 💾 `store.ts` — Bộ nhớ tạm (in-memory)

Lưu kết quả tìm kiếm/fetch để truy xuất lại qua tool `get_search_content`.

| Export | Loại | Mô tả |
|--------|------|-------|
| `StoredContent` | type | `{responseId, type, timestamp, queries?, urls?}` — dữ liệu đã fetch |
| `contentStore` | const | `Map<string, StoredContent>` — store toàn cục |
| `generateId` | function | Sinh ID ngẫu nhiên 8 ký tự (UUID slice) |

---

## ✂️ `truncate.ts` — Cắt output

| Export | Loại | Mô tả |
|--------|------|-------|
| `truncateOutput` | function | Cắt chuỗi theo giới hạn byte, bảo toàn UTF-8. Nếu bị cắt: append dòng `[Output truncated: N bytes omitted...]`, trả kèm flag `truncated` |

---

## 📐 `types.ts` — Shared types

| Export | Loại | Mô tả |
|--------|------|-------|
| `OllamaResponse` | interface | `{response: string, done: boolean}` |
| `AgentModelConfig` | interface | `{model?, thinking?, tasks?}` — cấu hình model mặc định cho từng agent |

---

## 📊 Tổng quan luồng dữ liệu

```
tools.json  ──► config.ts ──► ollama.ts, search.ts, register tools
                  │
agent .md   ──► agents.ts ──► discoverAgents() → subagent registry
                  │
web URLs    ──► fetch.ts ──► contentStore (store.ts) ──► get_search_content tool
                  │
images      ──► image.ts ──► analyze_image tool
                  │
output      ──► truncate.ts ──► format.ts ──► TUI display
```
