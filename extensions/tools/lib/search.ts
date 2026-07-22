// ─── search.ts ───── SearXNG client, diagnostics, cache and broker transport ─

export interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine?: string;
  [key: string]: unknown;
}

export type UnresponsiveEngine = [engine: string, reason?: string] | string;

export interface SearXNGResponse {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
  suggestions?: string[];
  answers?: unknown[];
  unresponsive_engines?: UnresponsiveEngine[];
  [key: string]: unknown;
}

export interface SearchOptions {
  categories?: string;
  limit?: number;
  signal?: AbortSignal;
  /** Use a local search broker instead of calling SearXNG directly. */
  brokerUrl?: string;
  minIntervalMs?: number;
  queueSize?: number;
  cacheTtlMs?: number;
  /** Upstream SearXNG request timeout; retained for backwards compatibility. */
  timeoutMs?: number;
  /** Caller-to-broker HTTP wait timeout; used only when brokerUrl is set. */
  brokerWaitTimeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_MIN_INTERVAL_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_QUEUE_SIZE = 4;
export const DEFAULT_BROKER_WAIT_TIMEOUT_MS = 120_000;
export const MAX_ERROR_BODY_CHARS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return minimum;
  if (value === Number.POSITIVE_INFINITY) return maximum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizedWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSearchQuery(query: string): string {
  return normalizedWhitespace(query).toLowerCase();
}

export function normalizeSearchCategory(categories: string): string {
  return normalizedWhitespace(categories)
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

export function normalizeSearchBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  }
}

export function searchCacheKey(baseUrl: string, query: string, categories: string): string {
  return `${normalizeSearchBaseUrl(baseUrl)}|${normalizeSearchQuery(query)}|${normalizeSearchCategory(categories)}`;
}

export function applySearchLimit(data: SearXNGResponse, limit: number): SearXNGResponse {
  return { ...data, results: data.results.slice(0, limit) };
}

function boundedBody(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_ERROR_BODY_CHARS) return compact;
  return `${compact.slice(0, MAX_ERROR_BODY_CHARS)}… [truncated]`;
}

function getHeader(response: Response, name: string): string | null {
  try {
    return response.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

/** Parse Retry-After seconds or an HTTP date. Null means use the caller's fallback. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
  fallbackMs: number | null = null,
): number | null {
  if (value == null || value.trim() === "") return fallbackMs;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return fallbackMs;
}

function retryAdvice(status: number, retryAfterMs: number | null): string {
  if (retryAfterMs != null) {
    if (retryAfterMs === 0) return "retry now, preferably after reducing search concurrency.";
    const seconds = Math.ceil(retryAfterMs / 1000);
    return `retry after about ${seconds} second${seconds === 1 ? "" : "s"}.`;
  }
  if (status === 429) return "The search service is rate-limited; retry later instead of issuing repeated requests.";
  if (status === 502 || status === 503 || status === 504) return "This may be temporary; retry later.";
  return "Check the search service configuration and response details.";
}

export interface SearXNGHttpErrorOptions {
  status: number;
  body?: string;
  retryAfter?: string | null;
  retryAfterMs?: number | null;
}

export class SearXNGHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfter: string | null;
  readonly retryAfterMs: number | null;

  constructor(options: SearXNGHttpErrorOptions) {
    const body = boundedBody(options.body ?? "");
    const retryAfter = options.retryAfter ?? null;
    const retryAfterMs = options.retryAfterMs ?? parseRetryAfter(retryAfter);
    const parts = [`SearXNG returned ${options.status}`];
    if (body) parts.push(`response body: ${body}`);
    if (retryAfter) parts.push(`Retry-After: ${retryAfter}`);
    parts.push(retryAdvice(options.status, retryAfterMs));
    super(parts.join("; "));
    this.name = "SearXNGHttpError";
    this.status = options.status;
    this.body = body;
    this.retryAfter = retryAfter;
    this.retryAfterMs = retryAfterMs;
  }
}

export class SearXNGNetworkError extends Error {
  constructor(message: string) {
    super(`Unable to reach SearXNG: ${message || "network failure"}; retry later if the service is temporarily unavailable.`);
    this.name = "SearXNGNetworkError";
  }
}

export interface SearchBrokerErrorOptions {
  message: string;
  status?: number;
  body?: string;
  retryAfter?: string | null;
  retryAfterMs?: number | null;
  code?: string;
}

export class SearchBrokerError extends Error {
  readonly status?: number;
  readonly body: string;
  readonly retryAfter: string | null;
  readonly retryAfterMs: number | null;
  readonly code?: string;

  constructor(options: SearchBrokerErrorOptions) {
    const retryAfter = options.retryAfter ?? null;
    const retryAfterMs = options.retryAfterMs ?? parseRetryAfter(retryAfter);
    const retrySeconds = retryAfterMs == null ? null : Math.ceil(retryAfterMs / 1000);
    const advice = options.status === 429
      ? retrySeconds == null
        ? " retry later."
        : retrySeconds === 0
          ? " retry now, preferably with less concurrency."
          : ` retry after about ${retrySeconds} second${retrySeconds === 1 ? "" : "s"}.`
      : options.status === 502 || options.status === 503 || options.status === 504
        ? " retry later; this may be temporary."
        : "";
    super(`${options.message}${advice}`);
    this.name = "SearchBrokerError";
    this.status = options.status;
    this.body = boundedBody(options.body ?? "");
    this.retryAfter = retryAfter;
    this.retryAfterMs = retryAfterMs;
    this.code = options.code;
  }
}

interface CacheEntry {
  data: SearXNGResponse;
  timestamp: number;
}

interface SearchFlight {
  key: string;
  promise: Promise<SearXNGResponse>;
  resolve: (data: SearXNGResponse) => void;
  reject: (error: unknown) => void;
  waiters: number;
  state: "queued" | "running" | "settled";
  cancelled: boolean;
  request: () => Promise<SearXNGResponse>;
}

const searchCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, SearchFlight>();
const directQueue: SearchFlight[] = [];
let directPumpRunning = false;
let lastDirectRequestTime = Number.NEGATIVE_INFINITY;

function getCached(key: string, ttlMs: number): SearXNGResponse | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: SearXNGResponse): void {
  searchCache.set(key, { data, timestamp: Date.now() });
  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
}

function abortedError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException("The search request was aborted", "AbortError");
}

function createFlight(key: string, request: () => Promise<SearXNGResponse>): SearchFlight {
  let resolveFlight!: (data: SearXNGResponse) => void;
  let rejectFlight!: (error: unknown) => void;
  const promise = new Promise<SearXNGResponse>((resolve, reject) => {
    resolveFlight = resolve;
    rejectFlight = reject;
  });
  // A queued request can be cancelled after all callers disconnect. It has no
  // consumer at that point, so prevent Node from reporting an unhandled reject.
  void promise.catch(() => undefined);
  return {
    key,
    promise,
    resolve: resolveFlight,
    reject: rejectFlight,
    waiters: 0,
    state: "queued",
    cancelled: false,
    request,
  };
}

function removeFlight(flight: SearchFlight): void {
  if (inFlight.get(flight.key) === flight) inFlight.delete(flight.key);
}

function cancelQueuedFlight(flight: SearchFlight): void {
  if (flight.state !== "queued" || flight.cancelled) return;
  flight.cancelled = true;
  const queueIndex = directQueue.indexOf(flight);
  if (queueIndex >= 0) directQueue.splice(queueIndex, 1);
  removeFlight(flight);
  flight.state = "settled";
  flight.reject(new Error("Search request was abandoned before it reached the upstream service"));
}

function attachFlight(
  flight: SearchFlight,
  limit: number,
  signal?: AbortSignal,
): Promise<SearXNGResponse> {
  if (signal?.aborted) return Promise.reject(abortedError(signal));
  flight.waiters++;

  return new Promise<SearXNGResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      flight.waiters--;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      if (flight.state === "queued" && flight.waiters === 1) cancelQueuedFlight(flight);
      finish(() => reject(abortedError(signal)));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    flight.promise.then(
      (data) => finish(() => resolve(applySearchLimit(data, limit))),
      (error) => finish(() => reject(error)),
    );
  });
}

async function runDirectQueue(): Promise<void> {
  if (directPumpRunning) return;
  directPumpRunning = true;
  while (directQueue.length > 0) {
    const flight = directQueue.shift()!;
    if (flight.cancelled || flight.waiters === 0) {
      cancelQueuedFlight(flight);
      continue;
    }

    flight.state = "running";
    const minIntervalMs = (flight as SearchFlight & { minIntervalMs?: number }).minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    const elapsed = Date.now() - lastDirectRequestTime;
    if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);

    // A caller may have aborted while this flight was sleeping in the queue.
    // Check again so it never consumes an upstream request slot.
    if (flight.cancelled || flight.waiters === 0) {
      flight.state = "settled";
      removeFlight(flight);
      flight.reject(new Error("Search request was abandoned before it reached the upstream service"));
      continue;
    }

    lastDirectRequestTime = Date.now();
    try {
      const data = await flight.request();
      setCache(flight.key, data);
      flight.state = "settled";
      flight.resolve(data);
      // Keep the cache even when all waiters have disconnected.
    } catch (error) {
      flight.state = "settled";
      flight.reject(error);
    } finally {
      removeFlight(flight);
    }
  }
  directPumpRunning = false;
}

function enqueueDirect(
  key: string,
  request: () => Promise<SearXNGResponse>,
  options: SearchOptions,
): SearchFlight {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const queueSize = clampInteger(options.queueSize ?? DEFAULT_QUEUE_SIZE, 1, 10_000);
  if (directQueue.length >= queueSize) {
    throw new SearchBrokerError({
      message: `Search queue is full (limit ${queueSize}); retry after queued searches complete.`,
      status: 503,
      code: "queue_full",
    });
  }

  const flight = createFlight(key, request) as SearchFlight & { minIntervalMs?: number };
  flight.minIntervalMs = clampInteger(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, 0, 86_400_000);
  inFlight.set(key, flight);
  directQueue.push(flight);
  return flight;
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function readResponseBody(response: Response): Promise<string> {
  if (typeof response.text !== "function") return "";
  try {
    return boundedBody(await response.text());
  } catch {
    return "";
  }
}

async function fetchSearXNG(
  baseUrl: string,
  query: string,
  categories: string,
  timeoutMs: number,
): Promise<SearXNGResponse> {
  const cleanBase = normalizeSearchBaseUrl(baseUrl);
  const url = new URL(`${cleanBase}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", categories);
  url.searchParams.set("safesearch", "0");
  url.searchParams.set("pageno", "1");

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal: createTimeoutSignal(timeoutMs) });
  } catch (error) {
    throw new SearXNGNetworkError(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const body = await readResponseBody(response);
    const retryAfter = getHeader(response, "retry-after");
    throw new SearXNGHttpError({
      status: response.status,
      body,
      retryAfter,
      retryAfterMs: parseRetryAfter(retryAfter),
    });
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const results = Array.isArray(raw.results) ? raw.results as SearXNGResult[] : [];
  return {
    ...raw,
    query: typeof raw.query === "string" ? raw.query : query,
    number_of_results: typeof raw.number_of_results === "number" ? raw.number_of_results : results.length,
    results,
    unresponsive_engines: Array.isArray(raw.unresponsive_engines)
      ? raw.unresponsive_engines as UnresponsiveEngine[]
      : undefined,
  };
}

function brokerEndpoint(brokerUrl: string): string {
  const clean = brokerUrl.trim().replace(/\/+$/, "");
  return clean.endsWith("/search") ? clean : `${clean}/search`;
}

async function fetchBroker(
  brokerUrl: string,
  query: string,
  categories: string,
  waitTimeoutMs: number,
): Promise<SearXNGResponse> {
  let response: Response;
  try {
    response = await fetch(brokerEndpoint(brokerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, categories }),
      signal: createTimeoutSignal(waitTimeoutMs),
    });
  } catch (error) {
    throw new SearchBrokerError({
      message: `Search broker unavailable: ${error instanceof Error ? error.message : String(error)}`,
      status: 502,
      code: "broker_unavailable",
    });
  }

  let payload: Record<string, unknown> = {};
  let body = "";
  try {
    if (typeof response.text === "function") {
      const rawBody = await response.text();
      body = boundedBody(rawBody);
      payload = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
    } else {
      payload = await response.json() as Record<string, unknown>;
    }
  } catch {
    // Preserve the HTTP status even when a broken broker sends non-JSON text.
  }

  if (!response.ok || payload.ok === false) {
    const error = (payload.error && typeof payload.error === "object")
      ? payload.error as Record<string, unknown>
      : {};
    const status = typeof error.status === "number" ? error.status : response.status;
    const retryAfter = typeof error.retryAfter === "string"
      ? error.retryAfter
      : getHeader(response, "retry-after");
    const retryAfterMs = typeof error.retryAfterMs === "number"
      ? error.retryAfterMs
      : parseRetryAfter(retryAfter);
    const message = typeof error.message === "string"
      ? error.message
      : `Search broker returned HTTP ${status}`;
    throw new SearchBrokerError({
      message,
      status,
      body: typeof error.body === "string" ? error.body : body,
      retryAfter,
      retryAfterMs,
      code: typeof error.code === "string" ? error.code : undefined,
    });
  }

  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : payload;
  const results = Array.isArray(data.results) ? data.results as SearXNGResult[] : [];
  return {
    ...data,
    query: typeof data.query === "string" ? data.query : query,
    number_of_results: typeof data.number_of_results === "number" ? data.number_of_results : results.length,
    results,
    unresponsive_engines: Array.isArray(data.unresponsive_engines)
      ? data.unresponsive_engines as UnresponsiveEngine[]
      : undefined,
  };
}

export function formatUnresponsiveEngines(data: Pick<SearXNGResponse, "unresponsive_engines">): string[] {
  return (data.unresponsive_engines ?? []).map((engine) => {
    if (Array.isArray(engine)) {
      const name = String(engine[0] ?? "unknown engine");
      const reason = engine[1] ? `: ${String(engine[1])}` : "";
      return `${name}${reason}`;
    }
    return String(engine);
  });
}

function searchKey(baseUrl: string, query: string, categories: string, brokerUrl?: string): string {
  const mode = brokerUrl ? `broker:${normalizeSearchBaseUrl(brokerUrl)}` : "direct";
  return `${mode}|${searchCacheKey(baseUrl, query, categories)}`;
}

/**
 * Search SearXNG directly, or use the configured local broker. Cache entries
 * always contain the complete upstream response; `limit` is caller-local.
 */
export async function searchSearXNG(
  baseUrl: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearXNGResponse> {
  const categories = normalizedWhitespace(options.categories || "general") || "general";
  const limit = clampInteger(options.limit ?? DEFAULT_SEARCH_LIMIT, 0, MAX_SEARCH_LIMIT);
  if (options.signal?.aborted) throw abortedError(options.signal);

  const key = searchKey(baseUrl, query, categories, options.brokerUrl);
  const cacheTtlMs = clampInteger(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 0, 86_400_000);
  const cached = getCached(key, cacheTtlMs);
  if (cached) return applySearchLimit(cached, limit);

  let flight = inFlight.get(key);
  if (!flight) {
    if (options.brokerUrl) {
      flight = createFlight(key, () => fetchBroker(
        options.brokerUrl!,
        query.trim(),
        categories,
        clampInteger(options.brokerWaitTimeoutMs ?? DEFAULT_BROKER_WAIT_TIMEOUT_MS, 1, 86_400_000),
      ));
      inFlight.set(key, flight);
      void flight.promise.then(
        (data) => setCache(key, data),
        () => undefined,
      ).finally(() => {
        flight!.state = "settled";
        removeFlight(flight!);
      });
      flight.state = "running";
      void flight.request().then(flight.resolve, flight.reject);
    } else {
      flight = enqueueDirect(key, () => fetchSearXNG(
        baseUrl,
        query.trim(),
        categories,
        clampInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 86_400_000),
      ), options);
    }
  }

  const result = attachFlight(flight, limit, options.signal);
  if (!options.brokerUrl && flight.state === "queued") void runDirectQueue();
  return result;
}

/** Reset process-local cache, flights and direct limiter. For testing only. */
export function _resetSearchState(): void {
  for (const flight of directQueue) {
    flight.cancelled = true;
    flight.reject(new Error("Search state reset"));
  }
  directQueue.length = 0;
  searchCache.clear();
  inFlight.clear();
  lastDirectRequestTime = Number.NEGATIVE_INFINITY;
  directPumpRunning = false;
}
