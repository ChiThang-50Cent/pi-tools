// ─── search.ts ───── SearXNG API client with rate limiting & cache ───────
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

// ─── Rate limiter: serialize requests with minimum interval ───
const MIN_INTERVAL_MS = 1000;
let lastRequestTime = 0;
let searchQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Cache: avoid repeated searches within TTL ───
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const searchCache = new Map<string, { data: SearXNGResponse; timestamp: number }>();

function cacheKey(baseUrl: string, query: string, categories: string, limit: number): string {
  return `${baseUrl}|${query}|${categories}|${limit}`;
}

function getCached(key: string): SearXNGResponse | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: SearXNGResponse): void {
  searchCache.set(key, { data, timestamp: Date.now() });
  // Evict old entries if cache grows too large
  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
}

/** Reset rate limiter and cache. For testing only. */
export function _resetSearchState(): void {
  lastRequestTime = 0;
  searchQueue = Promise.resolve();
  searchCache.clear();
}

async function doFetch(baseUrl: string, query: string, categories: string, limit: number, signal?: AbortSignal): Promise<SearXNGResponse> {
  const cleanBase = baseUrl.replace(/\/+$/, "");

  const url = new URL(`${cleanBase}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", categories);
  url.searchParams.set("safesearch", "0");
  url.searchParams.set("pageno", "1");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(signal ? [signal] : []),
    ]),
  });

  if (!res.ok) {
    throw new Error(`SearXNG returned ${res.status}`);
  }

  const data = (await res.json()) as SearXNGResponse & { results: SearXNGResult[] };
  return { ...data, results: (data.results || []).slice(0, limit) };
}

export async function searchSearXNG(
  baseUrl: string,
  query: string,
  options: { categories?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<SearXNGResponse> {
  const categories = options.categories || "general";
  const limit = Math.min(options.limit || 20, 50);

  // Check cache first
  const key = cacheKey(baseUrl, query, categories, limit);
  const cached = getCached(key);
  if (cached) return cached;

  // Serialize with rate limiting
  return new Promise<SearXNGResponse>((resolve, reject) => {
    searchQueue = searchQueue.then(async () => {
      try {
        // Enforce minimum interval between requests
        const elapsed = Date.now() - lastRequestTime;
        if (elapsed < MIN_INTERVAL_MS) {
          await sleep(MIN_INTERVAL_MS - elapsed);
        }
        lastRequestTime = Date.now();

        const data = await doFetch(baseUrl, query, categories, limit, options.signal);
        setCache(key, data);
        resolve(data);
      } catch (e) {
        reject(e);
      }
    });
  });
}
