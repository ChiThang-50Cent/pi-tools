// ─── fetch_content ───── Fetch URL content as markdown ───────────────────
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetchPageContent, fetchGitHub, MAX_INLINE_CONTENT } from "../lib/fetch.js";
import { contentStore, generateId } from "../lib/store.js";

export function registerFetchContent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch URL(s) and extract readable content as markdown. Supports web pages, GitHub repos, and plain text/json.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
      forceClone: Type.Optional(Type.Boolean({ description: "Force cloning large GitHub repositories" })),
    }),

    async execute(_id, params, signal, onUpdate) {
      const rawUrls: string[] = Array.isArray(params.urls) ? params.urls : params.url ? [params.url] : [];
      const urls = rawUrls.filter((u) => typeof u === "string" && u.trim().length > 0);

      if (urls.length === 0) {
        return { content: [{ type: "text", text: "Error: No URL provided." }], details: { error: "No URL provided" } };
      }

      const results: { url: string; title: string; content: string; error?: string }[] = [];

      for (const url of urls) {
        onUpdate?.({ content: [{ type: "text", text: `Fetching: ${url}...` }], details: { phase: "fetching", currentUrl: url } });

        try {
          results.push(url.includes("github.com") ? await fetchGitHub(url, signal) : await fetchPageContent(url, signal));
        } catch (err) {
          results.push({ url, title: url, content: "", error: signal?.aborted ? "Cancelled" : (err as Error).message });
        }
      }

      const responseId = generateId();
      contentStore.set(responseId, { responseId, type: "fetch", timestamp: Date.now(), urls: results });

      let output = "";
      for (const r of results) {
        if (r.error) output += `## ${r.url}\n**Error:** ${r.error}\n\n`;
        else {
          const truncated = r.content.length > MAX_INLINE_CONTENT
            ? r.content.slice(0, MAX_INLINE_CONTENT) + `\n\n... *(truncated, full stored [${responseId}])*`
            : r.content;
          output += `## ${r.title}\n${r.url}\n\n${truncated}\n\n---\n\n`;
        }
      }

      return {
        content: [{ type: "text", text: output.trim() || "No content extracted." }],
        details: {
          responseId,
          urls: results.map((r) => ({ url: r.url, title: r.title, error: r.error || null, contentLength: r.content.length })),
          successCount: results.filter((r) => !r.error).length,
          totalCount: results.length,
        },
      };
    },

    renderCall(args, theme) {
      const input = args as { url?: unknown; urls?: unknown };
      const rawUrls: unknown[] = Array.isArray(input.urls) ? input.urls : input.url ? [input.url] : [];
      const urls = rawUrls.filter((u) => typeof u === "string").map((u) => u.trim()).filter(Boolean);
      if (urls.length === 0) return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no url)"), 0, 0);
      return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", urls.length === 1 ? urls[0].slice(0, 60) : `${urls.length} URLs`), 0, 0);
    },

    renderResult(result, _opts, theme) {
      const d = result.details as { successCount?: number; totalCount?: number; error?: string };
      if (d?.error) return new Text(theme.fg("error", `Error: ${d.error}`), 0, 0);
      const ok = d?.successCount ?? 0;
      const total = d?.totalCount ?? 0;
      return new Text(theme.fg("success", `${ok}/${total} fetched` + (total - ok > 0 ? theme.fg("error", ` · ${total - ok} failed`) : "")), 0, 0);
    },
  });
}
