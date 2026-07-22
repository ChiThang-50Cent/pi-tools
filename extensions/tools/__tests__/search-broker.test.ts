import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSearchBroker,
  parseBrokerRetryAfter,
  type BrokerSearXNGResponse,
  type SearchBrokerHealth,
} from "../lib/search_broker.js";
import {
  formatUnresponsiveEngines,
  normalizeSearchBaseUrl,
  searchSearXNG,
  SearXNGHttpError,
  _resetSearchState,
  DEFAULT_BROKER_WAIT_TIMEOUT_MS,
} from "../lib/search.js";

function response(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => data,
    text: async () => body,
  } as unknown as Response;
}

function searchResponse(count = 5): BrokerSearXNGResponse {
  return {
    query: "test",
    number_of_results: count,
    results: Array.from({ length: count }, (_, index) => ({
      title: `Result ${index}`,
      url: `https://example.com/${index}`,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function brokerHealth(address: { url: string }): Promise<SearchBrokerHealth> {
  const result = await fetch(`${address.url}/health`);
  return await result.json() as SearchBrokerHealth;
}

function brokerSearch(address: { url: string }, query: string): Promise<Response> {
  return fetch(`${address.url}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

describe("direct search correctness", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    _resetSearchState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetSearchState();
  });

  it("deduplicates concurrent searches while preserving each caller limit", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const first = searchSearXNG("http://localhost:8080", "same query", { limit: 2, minIntervalMs: 0 });
    const second = searchSearXNG("http://localhost:8080/", " SAME   QUERY ", { limit: 4, minIntervalMs: 0 });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(response(searchResponse(5)));
    await expect(first).resolves.toMatchObject({ results: expect.any(Array) });
    await expect(second).resolves.toMatchObject({ results: expect.any(Array) });
    expect((await first).results).toHaveLength(2);
    expect((await second).results).toHaveLength(4);
  });

  it("shares normalized cache entries across limits and URL spellings", async () => {
    fetchMock.mockResolvedValueOnce(response(searchResponse(6)));

    const first = await searchSearXNG("HTTP://LOCALHOST:8080///", "  Hello   World ", { limit: 1, minIntervalMs: 0 });
    const second = await searchSearXNG("http://localhost:8080", "hello world", { limit: 5, minIntervalMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.results).toHaveLength(1);
    expect(second.results).toHaveLength(5);
    expect(normalizeSearchBaseUrl("http://localhost:8080///")).toBe("http://localhost:8080");
  });

  it("does not consume an upstream slot when a queued caller aborts", async () => {
    const firstPending = deferred<Response>();
    fetchMock.mockReturnValueOnce(firstPending.promise);
    const first = searchSearXNG("http://localhost:8080", "first", { minIntervalMs: 0 });
    await Promise.resolve();

    const controller = new AbortController();
    const queued = searchSearXNG("http://localhost:8080", "second", { minIntervalMs: 0, signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    firstPending.resolve(response(searchResponse(1)));
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes bounded HTTP error diagnostics and Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(response("x".repeat(10_000), 429, { "retry-after": "7" }));

    const error = await searchSearXNG("http://localhost:8080", "rate limited", { minIntervalMs: 0 }).catch((value) => value);
    expect(error).toBeInstanceOf(SearXNGHttpError);
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("7");
    expect(error.retryAfterMs).toBe(7000);
    expect(error.body.length).toBeLessThanOrEqual(2015);
    expect(error.message).toContain("retry");
  });

  it("keeps the upstream timeout separate from the broker wait timeout", async () => {
    const timeoutValues: number[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      timeoutValues.push(ms);
      return new AbortController().signal;
    });
    try {
      fetchMock.mockResolvedValueOnce(response(searchResponse(1)));
      await searchSearXNG("http://localhost:8080", "direct", { timeoutMs: 111, minIntervalMs: 0 });
      expect(timeoutValues).toEqual([111]);

      _resetSearchState();
      fetchMock.mockResolvedValueOnce(response({ ok: true, data: searchResponse(1) }));
      await searchSearXNG("http://unused", "through broker", {
        brokerUrl: "http://127.0.0.1:8787",
        timeoutMs: 222,
        brokerWaitTimeoutMs: 333,
      });
      expect(timeoutValues).toEqual([111, 333]);

      _resetSearchState();
      fetchMock.mockResolvedValueOnce(response({ ok: true, data: searchResponse(1) }));
      await searchSearXNG("http://unused", "default broker wait", {
        brokerUrl: "http://127.0.0.1:8787",
        timeoutMs: 222,
      });
      expect(timeoutValues).toEqual([111, 333, DEFAULT_BROKER_WAIT_TIMEOUT_MS]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("preserves and formats unresponsive engine diagnostics", async () => {
    fetchMock.mockResolvedValueOnce(response({
      query: "partial",
      results: [{ title: "one", url: "https://example.com" }],
      unresponsive_engines: [["google", "too many requests"], "another-engine"],
    }));

    const result = await searchSearXNG("http://localhost:8080", "partial", { minIntervalMs: 0 });
    expect(result.unresponsive_engines).toEqual([["google", "too many requests"], "another-engine"]);
    expect(formatUnresponsiveEngines(result)).toEqual(["google: too many requests", "another-engine"]);
  });
});

describe("local search broker", () => {
  const brokers: Array<ReturnType<typeof createSearchBroker>> = [];

  afterEach(async () => {
    await Promise.all(brokers.splice(0).map((broker) => broker.close()));
  });

  it("uses a bounded practical queue default and clamps invalid limits", () => {
    expect(() => createSearchBroker({ host: "127.example.com" })).toThrow("loopback");
    const defaults = createSearchBroker();
    expect(defaults.options.maxQueueSize).toBe(4);
    expect(defaults.options.timeoutMs).toBe(15_000);
    void defaults.close();

    const bounded = createSearchBroker({ maxQueueSize: Number.POSITIVE_INFINITY, timeoutMs: -10, port: 0 });
    expect(bounded.options.maxQueueSize).toBe(10_000);
    expect(bounded.options.timeoutMs).toBe(1);
    void bounded.close();
  });

  it("reports health metrics for FIFO, single-flight, cache, and reset", async () => {
    const pending = deferred<Response>();
    const upstream = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(response(searchResponse(1)));
    const broker = createSearchBroker({ port: 0, fetch: upstream, minIntervalMs: 0 });
    brokers.push(broker);
    const address = await broker.start();

    expect(await brokerHealth(address)).toMatchObject({
      ok: true,
      status: "ok",
      queueDepth: 0,
      inFlightCount: 0,
      cacheEntryCount: 0,
      cooldownRemainingMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      deduplicatedWaiterCount: 0,
      upstreamRequestCount: 0,
      upstreamErrorCount: 0,
    });

    const first = brokerSearch(address, "same");
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    const duplicate = brokerSearch(address, " SAME ");
    const queued = brokerSearch(address, "other");
    await vi.waitFor(async () => {
      expect(await brokerHealth(address)).toMatchObject({
        queueDepth: 1,
        inFlightCount: 2,
        deduplicatedWaiterCount: 1,
      });
    });

    pending.resolve(response(searchResponse(1)));
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(duplicate).resolves.toMatchObject({ status: 200 });
    await expect(queued).resolves.toMatchObject({ status: 200 });
    expect(upstream).toHaveBeenCalledTimes(2);

    const afterRequests = await brokerHealth(address);
    expect(afterRequests).toMatchObject({
      queueDepth: 0,
      inFlightCount: 0,
      cacheEntryCount: 2,
      cacheHits: 0,
      cacheMisses: 3,
      deduplicatedWaiterCount: 1,
      upstreamRequestCount: 2,
      upstreamErrorCount: 0,
    });

    await expect(brokerSearch(address, "same")).resolves.toMatchObject({ status: 200 });
    await expect(brokerSearch(address, "other")).resolves.toMatchObject({ status: 200 });
    expect((await brokerHealth(address)).cacheHits).toBe(2);

    broker.reset();
    expect(await brokerHealth(address)).toMatchObject({
      queueDepth: 0,
      inFlightCount: 0,
      cacheEntryCount: 0,
      cooldownRemainingMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      deduplicatedWaiterCount: 0,
      upstreamRequestCount: 0,
      upstreamErrorCount: 0,
    });
  });

  it("deduplicates concurrent HTTP requests and applies global FIFO throttling", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const upstream = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      return response({ ...searchResponse(3), query: new URL(requestUrl).searchParams.get("q") });
    });
    const broker = createSearchBroker({
      port: 0,
      fetch: upstream,
      minIntervalMs: 20,
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
      retryJitterMs: 0,
    });
    brokers.push(broker);
    const address = await broker.start();

    const request = (query: string) => fetch(`${address.url}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, categories: "general" }),
    });
    const [one, duplicate, two] = await Promise.all([request("one"), request(" ONE "), request("two")]);
    expect(one.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(two.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(20);
    expect(upstream.mock.calls.map(([url]) => new URL(url as string).searchParams.get("q"))).toEqual(["one", "two"]);
  });

  it("parses HTTP-date Retry-After values", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    const retryAt = new Date(now + 15_000).toUTCString();
    expect(parseBrokerRetryAfter(retryAt, now)).toBe(15_000);
    expect(parseBrokerRetryAfter("not-a-date", now)).toBe(5_000);
  });

  it("shares a 429 cooldown with later queued requests", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ error: "slow down" }, 429, { "retry-after": "0.1" }))
      .mockResolvedValueOnce(response(searchResponse(1)));
    const broker = createSearchBroker({
      port: 0,
      fetch: upstream,
      minIntervalMs: 0,
      maxRetries: 3,
      retryJitterMs: 0,
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
    });
    brokers.push(broker);
    const address = await broker.start();

    const request = (query: string) => fetch(`${address.url}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const first = request("limited");
    await Promise.resolve();
    const second = request("after cooldown");
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(429);
    expect(secondResponse.status).toBe(200);
    expect(sleeps).toContain(100);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("reports cooldown remaining after a rate-limit error without leaking query data", async () => {
    let now = 10_000;
    const upstream = vi.fn().mockResolvedValue(response({ error: "slow down" }, 429, { "retry-after": "2" }));
    const broker = createSearchBroker({
      port: 0,
      fetch: upstream,
      minIntervalMs: 0,
      maxRetries: 0,
      now: () => now,
    });
    brokers.push(broker);
    const address = await broker.start();

    const result = await brokerSearch(address, "private query");
    expect(result.status).toBe(429);
    const health = await brokerHealth(address);
    expect(health).toMatchObject({
      queueDepth: 0,
      inFlightCount: 0,
      cacheEntryCount: 0,
      cooldownRemainingMs: 2_000,
      cacheHits: 0,
      cacheMisses: 1,
      deduplicatedWaiterCount: 0,
      upstreamRequestCount: 1,
      upstreamErrorCount: 1,
    });
    expect(JSON.stringify(health)).not.toContain("private query");

    now += 2_000;
    expect((await brokerHealth(address)).cooldownRemainingMs).toBe(0);
  });

  it("lets clients use the broker while applying their own result limits", async () => {
    const upstream = vi.fn(async () => response(searchResponse(6)));
    const broker = createSearchBroker({ port: 0, fetch: upstream, minIntervalMs: 0 });
    brokers.push(broker);
    const address = await broker.start();

    const first = await searchSearXNG("http://unused", "broker query", {
      brokerUrl: address.url,
      limit: 2,
      timeoutMs: 2_000,
    });
    const second = await searchSearXNG("http://unused", "BROKER   QUERY", {
      brokerUrl: `${address.url}/`,
      limit: 5,
      timeoutMs: 2_000,
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(first.results).toHaveLength(2);
    expect(second.results).toHaveLength(5);
  });

  it("does not retry permanent errors but retries bounded transient/network failures", async () => {
    const permanentUpstream = vi.fn().mockResolvedValue(response({ error: "bad request" }, 400));
    const permanent = createSearchBroker({ port: 0, fetch: permanentUpstream, minIntervalMs: 0, maxRetries: 3, retryJitterMs: 0 });
    brokers.push(permanent);
    const permanentAddress = await permanent.start();
    const permanentResponse = await fetch(`${permanentAddress.url}/search`, {
      method: "POST",
      body: JSON.stringify({ query: "permanent" }),
    });
    expect(permanentResponse.status).toBe(400);
    expect(permanentUpstream).toHaveBeenCalledTimes(1);
    expect(await brokerHealth(permanentAddress)).toMatchObject({
      upstreamRequestCount: 1,
      upstreamErrorCount: 1,
    });

    let now = 0;
    const sleeps: number[] = [];
    const transientUpstream = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(response(searchResponse(1)));
    const transient = createSearchBroker({
      port: 0,
      fetch: transientUpstream,
      minIntervalMs: 0,
      maxRetries: 2,
      retryBaseMs: 5,
      retryMaxMs: 50,
      retryJitterMs: 0,
      now: () => now,
      sleep: async (ms) => { sleeps.push(ms); now += ms; },
    });
    brokers.push(transient);
    const transientAddress = await transient.start();
    const transientResponse = await fetch(`${transientAddress.url}/search`, {
      method: "POST",
      body: JSON.stringify({ query: "transient" }),
    });
    expect(transientResponse.status).toBe(200);
    expect(transientUpstream).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([5, 10]);
    expect(await brokerHealth(transientAddress)).toMatchObject({
      upstreamRequestCount: 3,
      upstreamErrorCount: 2,
    });
  });
});
