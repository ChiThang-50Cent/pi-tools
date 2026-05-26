// ─── fetch.ts ────── HTTP fetch + HTML stripping + GitHub API ───────────
export const MAX_INLINE_CONTENT = 30000;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

export async function fetchPageContent(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<{ url: string; title: string; content: string }> {
  const res = await fetch(targetUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PiBot/1.0; +https://pi.dev)" },
    signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      return { url: targetUrl, title: targetUrl, content: "```json\n" + JSON.stringify(parsed, null, 2).slice(0, MAX_INLINE_CONTENT) + "\n```" };
    } catch { /* fall through */ }
  }

  const title = extractTitle(text);
  const stripped = stripHtml(text);
  return { url: targetUrl, title: title || targetUrl, content: stripped.slice(0, MAX_INLINE_CONTENT * 2) };
}

export async function fetchGitHub(
  ghUrl: string,
  signal?: AbortSignal,
): Promise<{ url: string; title: string; content: string }> {
  const parsed = new URL(ghUrl);
  const parts = parsed.pathname.replace(/^\/+/, "").split("/");
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, "");

  if (!owner || !repo) throw new Error(`Could not parse GitHub owner/repo from: ${ghUrl}`);

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "PiBot/1.0" },
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  });

  if (!res.ok) {
    if (res.status === 404) throw new Error(`GitHub repo not found: ${owner}/${repo}`);
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as {
    full_name: string; description: string; stargazers_count: number;
    language: string; html_url: string; clone_url: string;
    default_branch: string; topics: string[]; license?: { spdx_id: string };
  };

  const content = [
    `# ${data.full_name}`,
    data.description ? `\n${data.description}\n` : "",
    `- **Stars:** ${data.stargazers_count.toLocaleString()}`,
    `- **Language:** ${data.language || "N/A"}`,
    `- **License:** ${data.license?.spdx_id || "N/A"}`,
    `- **Default branch:** ${data.default_branch}`,
    data.topics?.length ? `- **Topics:** ${data.topics.join(", ")}` : "",
    `\n**Clone:** \`git clone ${data.clone_url}\``,
    `**URL:** ${data.html_url}`,
  ].filter(Boolean).join("\n");

  return { url: ghUrl, title: data.full_name, content };
}
