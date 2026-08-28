import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoadTest } from "@/lib/engine";

let server: Server;
let port = 0;
let hits = 0;
let maxConcurrent = 0;
let current = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    const delay = req.url === "/slow" ? 200 : 5;
    setTimeout(() => {
      current--;
      res.statusCode = req.url === "/err" ? 500 : 200;
      res.end("ok");
    }, delay);
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("runLoadTest", () => {
  it("respects the duration and produces a summary", async () => {
    hits = 0;
    const started = Date.now();
    const res = await runLoadTest(
      {
        url: `http://127.0.0.1:${port}/`,
        method: "GET",
        headers: {},
        requestsPerSecond: 50,
        concurrency: 10,
        durationSeconds: 2,
        requestTimeoutMs: 1000,
        flushIntervalMs: 500,
      },
      {},
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1800);
    expect(elapsed).toBeLessThan(6000);
    expect(res.summary.totalRequests).toBeGreaterThan(10);
    expect(res.buckets.length).toBeGreaterThan(1);
  });

  it("never exceeds the concurrency ceiling", async () => {
    maxConcurrent = 0;
    current = 0;
    await runLoadTest(
      {
        url: `http://127.0.0.1:${port}/slow`,
        method: "GET",
        headers: {},
        requestsPerSecond: 500,
        concurrency: 4,
        durationSeconds: 2,
        requestTimeoutMs: 2000,
        flushIntervalMs: 500,
      },
      {},
    );
    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });

  it("stops early when shouldStop returns true", async () => {
    const started = Date.now();
    const res = await runLoadTest(
      {
        url: `http://127.0.0.1:${port}/`,
        method: "GET",
        headers: {},
        requestsPerSecond: 20,
        concurrency: 5,
        durationSeconds: 30,
        requestTimeoutMs: 1000,
        flushIntervalMs: 200,
      },
      { shouldStop: () => Date.now() - started > 800 },
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.stopped).toBe(true);
  });

  it("aborts promptly via an external AbortSignal", async () => {
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 500);
    const res = await runLoadTest(
      {
        url: `http://127.0.0.1:${port}/slow`,
        method: "GET",
        headers: {},
        requestsPerSecond: 50,
        concurrency: 10,
        durationSeconds: 30,
        requestTimeoutMs: 5000,
        flushIntervalMs: 200,
      },
      {},
      ac.signal,
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.stopped).toBe(true);
  });

  it("records non-2xx responses as failures", async () => {
    const res = await runLoadTest(
      {
        url: `http://127.0.0.1:${port}/err`,
        method: "GET",
        headers: {},
        requestsPerSecond: 30,
        concurrency: 5,
        durationSeconds: 1,
        requestTimeoutMs: 1000,
        flushIntervalMs: 500,
      },
      {},
    );
    expect(res.summary.failures).toBeGreaterThan(0);
    expect(res.summary.successes).toBe(0);
    expect(Object.keys(res.summary.statusCounts)).toContain("500");
  });
});
