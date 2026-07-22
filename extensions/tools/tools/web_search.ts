// ─── web_search ───── Search the web via SearXNG ─────────────────────────
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatUnresponsiveEngines, searchSearXNG } from "../lib/search.js";
import { getSearchConfig, getSearXNGUrl } from "../lib/config.js";

export function registerWebSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for real-time or external information.\n\n" +
      "Use this tool when current information, facts beyond your training data, " +
      "documentation, or news is necessary. Works like Google Search.",
    promptSnippet: "Search the web via SearXNG",
    promptGuidelines: [
      "Use web_search when current or external information is necessary.",
      "Reuse relevant results already available before issuing another search.",
      "Prefer one well-formed query and avoid equivalent queries in parallel.",
      "After a rate-limit response, wait for the stated cooldown; do not retry during it.",
      "For code/API questions, use code_search instead.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "A focused search query (3-5 keywords often work well)" }),
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
      const d = result.details as { count?: number; error?: string; warnings?: string[] };
      if (d?.error) return new Text(theme.fg("error", `Error: ${d.error}`), 0, 0);
      const count = d?.count ?? 0;
      const warning = d?.warnings?.length ? theme.fg("warning", ` · ${d.warnings.length} engine warning${d.warnings.length === 1 ? "" : "s"}`) : "";
      return new Text(theme.fg("success", `${count} result${count !== 1 ? "s" : ""}`) + warning, 0, 0);
    },

    async execute(_id, params, signal) {
      const baseUrl = getSearXNGUrl();
      const searchConfig = getSearchConfig();
      const maxResults = Math.min(params.max_results ?? 10, 20);

      try {
        const data = await searchSearXNG(baseUrl, params.query, {
          ...searchConfig,
          categories: params.category,
          limit: maxResults,
          signal,
        });

        const results = data.results;
        const warnings = formatUnresponsiveEngines(data);
        const warningText = warnings.length
          ? `Warnings (partial results):\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
          : "";
        if (!results.length) {
          const text = warningText
            ? `No results for: ${params.query}\n\n${warningText}`
            : `No results for: ${params.query}`;
          return { content: [{ type: "text", text }], details: { count: 0, warnings, query: params.query } };
        }

        const lines = [`Search results for: ${params.query}\n`];
        results.forEach((r, i) => {
          lines.push(`${i + 1}. [${r.title || "Untitled"}](${r.url})`);
          if (r.content) lines.push(`   ${r.content.slice(0, 300)}`);
          if (r.engine) lines.push(`   Source: ${r.engine}`);
          lines.push("");
        });
        if (warningText) lines.push(warningText);

        return {
          content: [{ type: "text", text: lines.join("\n").trim() }],
          details: { count: results.length, query: params.query, warnings },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: `Search failed: ${message}` }], details: { error: message } };
      }
    },
  });
}
