// ─── search_broker.ts ───── local-only cross-process SearXNG broker ────────
// This file intentionally uses only Node.js built-ins and the Node fetch API.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isIP } from "node:net";

export interface BrokerSearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine?: string;
  [key: string]: unknown;
}

export interface BrokerSearXNGResponse {
  query: string;
  number_of_results: number;
  results: BrokerSearXNGResult[];
  suggestions?: string[];
  answers?: unknown[];
  unresponsive_engines?: Array<[string, string?] | string>;
  [key: string]: unknown;
}

export interface BrokerSearchRequest {
  query: string;
  categories?: string;
}

export interface SearchBrokerOptions {
  host?: string;
  port?: number;
  searxngUrl?: string;
  minIntervalMs?: number;
  maxQueueSize?: number;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryJitterMs?: number;
  cacheSize?: number;
  /** Test hook; production defaults to Node's global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Test hook for deterministic backoff/cooldown tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export interface SearchBrokerAddress {
  host: string;
  port: number;
  url: string;
}

export interface SearchBroker {
  readonly server: Server;
  readonly options: Required<Pick<SearchBrokerOptions,
    "host" | "port" | "searxngUrl" | "minIntervalMs" | "maxQueueSize" | "cacheTtlMs" |
    "timeoutMs" | "maxRetries" | "retryBaseMs" | "retryMaxMs" | "retryJitterMs" | "cacheSize"
  >>;
  start(): Promise<SearchBrokerAddress>;
  close(): Promise<void>;
  search(request: BrokerSearchRequest, signal?: AbortSignal): Promise<BrokerSearXNGResponse>;
  reset(): void;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8080";
const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_QUEUE_SIZE = 4;
const MAX_QUEUE_SIZE = 10_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 30_000;
const DEFAULT_RETRY_JITTER_MS = 100;
const DEFAULT_CACHE_SIZE = 200;
const DEFAULT_429_COOLDOWN_MS = 5_000;
const MAX_ERROR_BODY_CHARS = 2000;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return minimum;
  if (value === Number.POSITIVE_INFINITY) return maximum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizedWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeBrokerQuery(query: string): string {
  return normalizedWhitespace(query).toLowerCase();
}

export function normalizeBrokerCategory(categories: string): string {
  return normalizedWhitespace(categories)
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

function normalizeBaseUrl(baseUrl: string): string {
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

function cacheKey(query: string, categories: string): string {
  return `${normalizeBrokerQuery(query)}|${normalizeBrokerCategory(categories)}`;
}

function boundedBody(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_ERROR_BODY_CHARS) return compact;
  return `${compact.slice(0, MAX_ERROR_BODY_CHARS)}… [truncated]`;
}

function parseRetryAfter(value: string | null | undefined, now: number, fallbackMs: number | null = null): number | null {
  if (value == null || value.trim() === "") return fallbackMs;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return fallbackMs;
}

export function parseBrokerRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
  fallbackMs = DEFAULT_429_COOLDOWN_MS,
): number {
  return parseRetryAfter(value, now, fallbackMs) ?? fallbackMs;
}

function getHeader(response: Response, name: string): string | null {
  try {
    return response.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

async function responseBody(response: Response): Promise<string> {
  if (typeof response.text !== "function") return "";
  try {
    return boundedBody(await response.text());
  } catch {
    return "";
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return normalized === "localhost" || normalized === "::1" || (isIP(normalized) === 4 && normalized.startsWith("127."));
}

function validateHost(host: string): string {
  if (!isLoopbackHost(host)) {
    throw new Error(`Search broker must bind to loopback; refusing host ${host}`);
  }
  return host;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("The search request was aborted");
  error.name = "AbortError";
  return error;
}

interface BrokerHttpError {
  status?: number;
  body: string;
  retryAfter: string | null;
  retryAfterMs: number | null;
  message: string;
  network: boolean;
}

function makeNetworkError(error: unknown): BrokerHttpError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: undefined,
    body: boundedBody(message),
    retryAfter: null,
    retryAfterMs: null,
    message: `Unable to reach SearXNG: ${boundedBody(message) || "network failure"}`,
    network: true,
  };
}

async function makeHttpError(response: Response, now = Date.now()): Promise<BrokerHttpError> {
  const body = await responseBody(response);
  const retryAfter = getHeader(response, "retry-after");
  return {
    status: response.status,
    body,
    retryAfter,
    retryAfterMs: parseRetryAfter(retryAfter, now),
    message: `SearXNG returned HTTP ${response.status}${body ? `: ${body}` : ""}`,
    network: false,
  };
}

function errorIsTransient(error: BrokerHttpError): boolean {
  return error.network || error.status === 502 || error.status === 503 || error.status === 504;
}

export interface SearchBrokerHealth {
  ok: true;
  status: "ok";
  queueDepth: number;
  inFlightCount: number;
  cacheEntryCount: number;
  cooldownRemainingMs: number;
  cacheHits: number;
  cacheMisses: number;
  deduplicatedWaiterCount: number;
  upstreamRequestCount: number;
  upstreamErrorCount: number;
}

interface CacheEntry {
  data: BrokerSearXNGResponse;
  timestamp: number;
}

interface Flight {
  key: string;
  query: string;
  categories: string;
  promise: Promise<BrokerSearXNGResponse>;
  resolve: (data: BrokerSearXNGResponse) => void;
  reject: (error: BrokerHttpError | Error) => void;
  waiters: number;
  state: "queued" | "running" | "settled";
  cancelled: boolean;
}

class BrokerRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BrokerRequestError";
    this.status = status;
    this.code = code;
  }
}

class LocalSearchBroker implements SearchBroker {
  readonly server: Server;
  readonly options: SearchBroker["options"];
  private readonly upstreamFetch: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly flights = new Map<string, Flight>();
  private readonly queue: Flight[] = [];
  private pumpRunning = false;
  private lastRequestTime = Number.NEGATIVE_INFINITY;
  private cooldownUntil = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private deduplicatedWaiterCount = 0;
  private upstreamRequestCount = 0;
  private upstreamErrorCount = 0;

  constructor(input: SearchBrokerOptions = {}) {
    const host = validateHost(input.host ?? DEFAULT_HOST);
    this.options = {
      host,
      port: clampNumber(input.port ?? DEFAULT_PORT, 0, 65_535),
      searxngUrl: normalizeBaseUrl(input.searxngUrl ?? DEFAULT_SEARXNG_URL),
      minIntervalMs: clampNumber(input.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, 0, 86_400_000),
      maxQueueSize: clampNumber(input.maxQueueSize ?? DEFAULT_QUEUE_SIZE, 1, MAX_QUEUE_SIZE),
      cacheTtlMs: clampNumber(input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 0, 86_400_000),
      timeoutMs: clampNumber(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 86_400_000),
      maxRetries: clampNumber(input.maxRetries ?? DEFAULT_MAX_RETRIES, 0, 5),
      retryBaseMs: clampNumber(input.retryBaseMs ?? DEFAULT_RETRY_BASE_MS, 0, 86_400_000),
      retryMaxMs: clampNumber(input.retryMaxMs ?? DEFAULT_RETRY_MAX_MS, 0, 86_400_000),
      retryJitterMs: clampNumber(input.retryJitterMs ?? DEFAULT_RETRY_JITTER_MS, 0, 86_400_000),
      cacheSize: clampNumber(input.cacheSize ?? DEFAULT_CACHE_SIZE, 1, MAX_QUEUE_SIZE),
    };
    this.upstreamFetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleepFn = input.sleep ?? sleep;
    this.now = input.now ?? (() => Date.now());
    this.random = input.random ?? Math.random;
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response);
    });
  }

  async start(): Promise<SearchBrokerAddress> {
    if (this.server.listening) return this.address();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.options.port, this.options.host);
    });
    return this.address();
  }

  private address(): SearchBrokerAddress {
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Search broker is not listening");
    const displayHost = this.options.host.includes(":") ? `[${this.options.host}]` : this.options.host;
    return { host: this.options.host, port: address.port, url: `http://${displayHost}:${address.port}` };
  }

  async close(): Promise<void> {
    for (const flight of this.queue.splice(0)) {
      flight.cancelled = true;
      flight.state = "settled";
      flight.reject({
        status: 503,
        body: "",
        retryAfter: null,
        retryAfterMs: null,
        message: "Search broker is shutting down",
        network: false,
      });
    }
    this.flights.clear();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  reset(): void {
    this.cache.clear();
    this.lastRequestTime = Number.NEGATIVE_INFINITY;
    this.cooldownUntil = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.deduplicatedWaiterCount = 0;
    this.upstreamRequestCount = 0;
    this.upstreamErrorCount = 0;
  }

  private health(): SearchBrokerHealth {
    const now = this.now();
    this.pruneExpiredCache(now);
    return {
      ok: true,
      status: "ok",
      queueDepth: this.queue.length,
      inFlightCount: this.flights.size,
      cacheEntryCount: this.cache.size,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      deduplicatedWaiterCount: this.deduplicatedWaiterCount,
      upstreamRequestCount: this.upstreamRequestCount,
      upstreamErrorCount: this.upstreamErrorCount,
    };
  }

  async search(request: BrokerSearchRequest, signal?: AbortSignal): Promise<BrokerSearXNGResponse> {
    if (signal?.aborted) throw abortError(signal);
    const query = typeof request.query === "string" ? request.query.trim() : "";
    if (!query) throw new BrokerRequestError("Search query must not be empty", 400, "invalid_query");
    const categories = typeof request.categories === "string" && request.categories.trim()
      ? request.categories.trim()
      : "general";
    const key = cacheKey(query, categories);
    const cached = this.getCached(key);
    if (cached) return cached;

    let flight = this.flights.get(key);
    let shouldPump = false;
    if (!flight) {
      if (this.queue.length >= this.options.maxQueueSize) {
        throw new BrokerRequestError(
          `Search broker queue is full (limit ${this.options.maxQueueSize}); retry later.`,
          503,
          "queue_full",
        );
      }
      let resolveFlight!: (data: BrokerSearXNGResponse) => void;
      let rejectFlight!: (error: BrokerHttpError | Error) => void;
      const promise = new Promise<BrokerSearXNGResponse>((resolve, reject) => {
        resolveFlight = resolve;
        rejectFlight = reject;
      });
      void promise.catch(() => undefined);
      flight = {
        key,
        query,
        categories,
        promise,
        resolve: resolveFlight,
        reject: rejectFlight,
        waiters: 0,
        state: "queued",
        cancelled: false,
      };
      this.flights.set(key, flight);
      this.queue.push(flight);
      shouldPump = true;
    } else {
      this.deduplicatedWaiterCount++;
    }

    const result = this.attach(flight, signal);
    if (shouldPump) void this.pump();
    return result;
  }

  private getCached(key: string): BrokerSearXNGResponse | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheMisses++;
      return null;
    }
    if (this.now() - entry.timestamp > this.options.cacheTtlMs) {
      this.cache.delete(key);
      this.cacheMisses++;
      return null;
    }
    this.cacheHits++;
    return entry.data;
  }

  private pruneExpiredCache(now: number): void {
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.options.cacheTtlMs) this.cache.delete(key);
    }
  }

  private setCached(key: string, data: BrokerSearXNGResponse): void {
    this.cache.set(key, { data, timestamp: this.now() });
    while (this.cache.size > this.options.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private attach(flight: Flight, signal?: AbortSignal): Promise<BrokerSearXNGResponse> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    flight.waiters++;
    return new Promise<BrokerSearXNGResponse>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        flight.waiters--;
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () => {
        if (flight.state === "queued" && flight.waiters === 1) {
          flight.cancelled = true;
          const queueIndex = this.queue.indexOf(flight);
          if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
          this.flights.delete(flight.key);
          flight.state = "settled";
          flight.reject(new Error("Search request was abandoned before it reached SearXNG"));
        }
        finish(() => reject(abortError(signal)));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      flight.promise.then(
        (data) => finish(() => resolve(data)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private async waitForSlot(): Promise<void> {
    const now = this.now();
    const next = Math.max(this.lastRequestTime + this.options.minIntervalMs, this.cooldownUntil);
    const delay = next - now;
    if (delay > 0) await this.sleepFn(delay);
  }

  private async pump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    try {
      while (this.queue.length > 0) {
        const flight = this.queue.shift()!;
        if (flight.cancelled || flight.waiters === 0) {
          flight.state = "settled";
          this.flights.delete(flight.key);
          flight.reject(new Error("Search request was abandoned before it reached SearXNG"));
          continue;
        }
        flight.state = "running";
        try {
          await this.waitForSlot();
          if (flight.cancelled || flight.waiters === 0) {
            flight.state = "settled";
            this.flights.delete(flight.key);
            flight.reject(new Error("Search request was abandoned before it reached SearXNG"));
            continue;
          }
          const data = await this.fetchWithRetries(flight.query, flight.categories);
          this.setCached(flight.key, data);
          flight.state = "settled";
          flight.resolve(data);
        } catch (error) {
          flight.state = "settled";
          flight.reject(error as BrokerHttpError | Error);
        } finally {
          this.flights.delete(flight.key);
        }
      }
    } finally {
      this.pumpRunning = false;
    }
  }

  private async fetchWithRetries(query: string, categories: string): Promise<BrokerSearXNGResponse> {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) await this.waitForSlot();
      this.lastRequestTime = this.now();
      try {
        const url = new URL(`${this.options.searxngUrl}/search`);
        url.searchParams.set("q", query);
        url.searchParams.set("format", "json");
        url.searchParams.set("categories", categories);
        url.searchParams.set("safesearch", "0");
        url.searchParams.set("pageno", "1");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        let response: Response;
        this.upstreamRequestCount++;
        try {
          response = await this.upstreamFetch(url.toString(), { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          this.upstreamErrorCount++;
          const error = await makeHttpError(response, this.now());
          if (error.status === 429) {
            const cooldown = error.retryAfterMs ?? DEFAULT_429_COOLDOWN_MS;
            this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + cooldown);
          }
          if (!errorIsTransient(error) || attempt >= this.options.maxRetries || error.status === 429) throw error;
          await this.backoff(attempt);
          continue;
        }
        const raw = await response.json() as Record<string, unknown>;
        const results = Array.isArray(raw.results) ? raw.results as BrokerSearXNGResult[] : [];
        return {
          ...raw,
          query: typeof raw.query === "string" ? raw.query : query,
          number_of_results: typeof raw.number_of_results === "number" ? raw.number_of_results : results.length,
          results,
          unresponsive_engines: Array.isArray(raw.unresponsive_engines)
            ? raw.unresponsive_engines as Array<[string, string?] | string>
            : undefined,
        };
      } catch (error) {
        const isBrokerHttpError = error && typeof error === "object" && "message" in error && "network" in error;
        if (!isBrokerHttpError) this.upstreamErrorCount++;
        const normalized = isBrokerHttpError
          ? error as BrokerHttpError
          : makeNetworkError(error);
        if (!errorIsTransient(normalized) || attempt >= this.options.maxRetries) throw normalized;
        await this.backoff(attempt);
      }
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const exponential = Math.min(this.options.retryMaxMs, this.options.retryBaseMs * (2 ** attempt));
    const jitter = Math.floor(this.random() * this.options.retryJitterMs);
    await this.sleepFn(exponential + jitter);
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, this.health());
      return;
    }
    if (request.method !== "POST" || request.url !== "/search") {
      writeJson(response, 404, { ok: false, error: { code: "not_found", message: "Not found" } });
      return;
    }

    const controller = new AbortController();
    const onAborted = () => controller.abort();
    request.once("aborted", onAborted);
    response.once("close", onAborted);
    try {
      const body = await readBody(request);
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(body) as Record<string, unknown>;
      } catch {
        throw new BrokerRequestError("Request body must be valid JSON", 400, "invalid_json");
      }
      const result = await this.search({
        query: typeof input.query === "string" ? input.query : "",
        categories: typeof input.categories === "string" ? input.categories : undefined,
      }, controller.signal);
      if (controller.signal.aborted || response.writableEnded) return;
      writeJson(response, 200, { ok: true, data: result });
    } catch (error) {
      if (controller.signal.aborted || response.writableEnded) return;
      const detail = brokerErrorPayload(error);
      if (detail.retryAfter) response.setHeader("retry-after", detail.retryAfter);
      writeJson(response, detail.status ?? 500, { ok: false, error: detail });
    } finally {
      request.off("aborted", onAborted);
      response.off("close", onAborted);
    }
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

function brokerErrorPayload(error: unknown): {
  status?: number;
  code?: string;
  message: string;
  body?: string;
  retryAfter?: string | null;
  retryAfterMs?: number | null;
} {
  if (error instanceof BrokerRequestError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  const detail = error as Partial<BrokerHttpError>;
  const status = typeof detail.status === "number" ? detail.status : detail.network ? 502 : 500;
  return {
    status,
    code: detail.network ? "upstream_network" : "upstream_error",
    message: typeof detail.message === "string" ? detail.message : String(error),
    body: typeof detail.body === "string" ? detail.body : undefined,
    retryAfter: detail.retryAfter ?? null,
    retryAfterMs: detail.retryAfterMs ?? null,
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_REQUEST_BODY_BYTES) {
        reject(new BrokerRequestError("Request body is too large", 413, "request_too_large"));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
    request.once("aborted", () => reject(new Error("Request aborted")));
  });
}

export function createSearchBroker(options: SearchBrokerOptions = {}): SearchBroker {
  return new LocalSearchBroker(options);
}

interface BrokerFileConfig {
  searxng?: string;
  search?: SearchBrokerOptions & { brokerUrl?: string; queueSize?: number };
}

function readToolsConfig(): BrokerFileConfig {
  const path = join(homedir(), ".pi", "tools.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BrokerFileConfig;
  } catch {
    return {};
  }
}

function cliValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberSetting(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function brokerCliOptions(): SearchBrokerOptions {
  const config = readToolsConfig();
  const search = config.search ?? {};
  const args = process.argv.slice(2);
  const env = process.env;
  return {
    host: validateHost(cliValue(args, "--host") ?? env.PI_SEARCH_BROKER_HOST ?? DEFAULT_HOST),
    port: numberSetting(cliValue(args, "--port") ?? env.PI_SEARCH_BROKER_PORT, DEFAULT_PORT),
    searxngUrl: cliValue(args, "--searxng") ?? env.PI_SEARXNG_URL ?? config.searxng ?? DEFAULT_SEARXNG_URL,
    minIntervalMs: numberSetting(cliValue(args, "--min-interval-ms") ?? env.PI_SEARCH_MIN_INTERVAL_MS ?? search.minIntervalMs, DEFAULT_MIN_INTERVAL_MS),
    maxQueueSize: numberSetting(cliValue(args, "--queue-size") ?? env.PI_SEARCH_QUEUE_SIZE ?? search.queueSize, DEFAULT_QUEUE_SIZE),
    cacheTtlMs: numberSetting(cliValue(args, "--cache-ttl-ms") ?? env.PI_SEARCH_CACHE_TTL_MS ?? search.cacheTtlMs, DEFAULT_CACHE_TTL_MS),
    timeoutMs: numberSetting(cliValue(args, "--timeout-ms") ?? env.PI_SEARCH_TIMEOUT_MS ?? search.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxRetries: numberSetting(cliValue(args, "--max-retries") ?? env.PI_SEARCH_MAX_RETRIES ?? search.maxRetries, DEFAULT_MAX_RETRIES),
    retryBaseMs: numberSetting(cliValue(args, "--retry-base-ms") ?? env.PI_SEARCH_RETRY_BASE_MS ?? search.retryBaseMs, DEFAULT_RETRY_BASE_MS),
    retryMaxMs: numberSetting(cliValue(args, "--retry-max-ms") ?? env.PI_SEARCH_RETRY_MAX_MS ?? search.retryMaxMs, DEFAULT_RETRY_MAX_MS),
  };
}

async function main(): Promise<void> {
  const broker = createSearchBroker(brokerCliOptions());
  const address = await broker.start();
  console.log(`pi-tools search broker listening on ${address.url} (SearXNG: ${broker.options.searxngUrl})`);
  const shutdown = () => {
    void broker.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
