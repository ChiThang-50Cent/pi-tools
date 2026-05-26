// ─── web_search ───── Search the web via SearXNG ─────────────────────────
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { searchSearXNG } from "../lib/search.js";
import { getSearXNGUrl } from "../lib/config.js";

export function registerWebSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for real-time or external information.\n\n" +
      "You MUST use this tool whenever you need up-to-date information, " +
      "facts you're unsure about, documentation, news, or any knowledge " +
      "beyond your training data. Works like Google Search.",
    promptSnippet: "Search the web via SearXNG",
    promptGuidelines: [
      "Use web_search when you need real-time information, current events, or facts beyond your training data.",
      "For code/API questions, use code_search instead.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (3-5 keywords for best results)" }),
      max_results: Type.Optional(Type.Integer({ default: 10, description: "Max results (1-20)" })),
      category: Type.Optional(Type.String({ default: "general", description: "general, news, images, videos, it, science, files" })),
    }),

    renderCall(args, theme) {
      const input = args as { query?: unknown };
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
      return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", query.slice(0, 60)), 0, 0);
    },

    renderResult(result, _opts, theme) {
      const d = result.details as { count?: number; error?: string };
      if (d?.error) return new Text(theme.fg("error", `Error: ${d.error}`), 0, 0);
      const count = d?.count ?? 0;
      return new Text(theme.fg("success", `${count} result${count !== 1 ? "s" : ""}`), 0, 0);
    },

    async execute(_id, params, signal) {
      const baseUrl = getSearXNGUrl();
      const maxResults = Math.min(params.max_results ?? 10, 20);

      try {
        const data = await searchSearXNG(baseUrl, params.query, {
          categories: params.category,
          limit: maxResults,
          signal,
        });

        const results = data.results;
        if (!results.length) return { content: [{ type: "text", text: `No results for: ${params.query}` }], details: { count: 0 } };

        const lines = [`Search results for: ${params.query}\n`];
        results.forEach((r, i) => {
          lines.push(`${i + 1}. [${r.title || "Untitled"}](${r.url})`);
          if (r.content) lines.push(`   ${r.content.slice(0, 300)}`);
          if (r.engine) lines.push(`   Source: ${r.engine}`);
          lines.push("");
        });

        return {
          content: [{ type: "text", text: lines.join("\n").trim() }],
          details: { count: results.length, query: params.query },
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Search failed: ${e}` }], details: { error: String(e) } };
      }
    },
  });
}
