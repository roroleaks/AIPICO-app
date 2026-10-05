import test from "node:test";
import assert from "node:assert/strict";
import { SingleFlight, TtlLruCache } from "./pubmed-cache.ts";

test("an expired entry is a miss even though its key is still present", () => {
  let now = 1_000;
  const cache = new TtlLruCache<string>(10, 500, () => now);
  cache.set("a", "value");
  now = 1_400;
  assert.equal(cache.get("a"), "value", "still inside the TTL");
  now = 1_500;
  assert.equal(cache.get("a"), undefined, "TTL boundary is a miss");
  assert.equal(cache.size, 0, "the expired key is dropped on read");
});

test("the cache never exceeds its entry cap under unbounded distinct keys", () => {
  // Clinician free text produces unbounded distinct queries, so the cap is the only thing
  // standing between a long-lived server process and unbounded memory growth.
  const cache = new TtlLruCache<number>(3, 10_000);
  for (let i = 0; i < 100; i++) cache.set(`key-${i}`, i);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("key-0"), undefined, "the oldest key was evicted");
  assert.equal(cache.get("key-99"), 99, "the newest key survived");
});

test("eviction is least-recently-used, not insertion order", () => {
  const cache = new TtlLruCache<number>(2, 10_000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.equal(cache.get("a"), 1, "recently read entry survives");
  assert.equal(cache.get("b"), undefined, "the entry not touched since insertion is evicted");
  assert.equal(cache.get("c"), 3);
});

test("a falsy cached value is served rather than re-fetched", () => {
  // `undefined` would be indistinguishable from a miss; `null` and `0` must round-trip.
  const cache = new TtlLruCache<number | null>(4, 10_000);
  cache.set("zero", 0);
  cache.set("null", null);
  assert.equal(cache.get("zero"), 0);
  assert.equal(cache.get("null"), null);
});

test("wrap returns the cached value without calling the loader again", async () => {
  const cache = new TtlLruCache<string>(4, 10_000);
  let loads = 0;
  const load = async () => {
    loads++;
    return "loaded";
  };
  assert.equal(await cache.wrap("k", load), "loaded");
  assert.equal(await cache.wrap("k", load), "loaded");
  assert.equal(loads, 1);
});

test("a cache with an unusable size or TTL is rejected rather than silently unbounded", () => {
  assert.throws(() => new TtlLruCache<number>(0, 1_000));
  assert.throws(() => new TtlLruCache<number>(1, 0));
});

test("single-flight collapses a burst of identical keys into one execution", async () => {
  const flight = new SingleFlight<string, number>();
  let executions = 0;
  const task = async () => {
    executions++;
    await new Promise(r => setTimeout(r, 5));
    return executions;
  };
  const results = await Promise.all(Array.from({ length: 25 }, () => flight.run("same", task)));
  assert.equal(executions, 1, "25 concurrent callers must not become 25 upstream calls");
  for (const value of results) assert.equal(value, 1, "every caller receives the same result");
  assert.equal(flight.pending, 0, "the in-flight slot is released");
});

test("single-flight keeps distinct keys independent", async () => {
  const flight = new SingleFlight<string, string>();
  const [a, b] = await Promise.all([flight.run("a", async () => "A"), flight.run("b", async () => "B")]);
  assert.equal(a, "A");
  assert.equal(b, "B");
});

test("a failed flight releases its slot so a retry is not pinned to the rejection", async () => {
  const flight = new SingleFlight<string, string>();
  await assert.rejects(() => flight.run("k", async () => {
    throw new Error("upstream 429");
  }));
  assert.equal(flight.pending, 0);
  assert.equal(await flight.run("k", async () => "recovered"), "recovered");
});

test("a task throwing synchronously also releases its slot", async () => {
  const flight = new SingleFlight<string, string>();
  await assert.rejects(() => flight.run("k", (() => {
    throw new Error("sync boom");
  }) as () => Promise<string>));
  assert.equal(flight.pending, 0);
});