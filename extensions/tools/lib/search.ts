// ─── search.ts ───── SearXNG API client ───────────────────────────────────
export interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine?: string;
}

interface SearXNGResponse {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
  suggestions?: string[];
  answers?: string[];
}

export async function searchSearXNG(
  baseUrl: string,
  query: string,
  options: { categories?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<SearXNGResponse> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const categories = options.categories || "general";
  const limit = Math.min(options.limit || 20, 50);

  const url = new URL(`${cleanBase}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", categories);
  url.searchParams.set("safesearch", "0");
  url.searchParams.set("pageno", "1");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });

  if (!res.ok) {
    throw new Error(`SearXNG returned ${res.status}`);
  }

  const data = (await res.json()) as SearXNGResponse & { results: SearXNGResult[] };
  return { ...data, results: (data.results || []).slice(0, limit) };
}
