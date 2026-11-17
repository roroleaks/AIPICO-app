import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "./rate-limiter.ts";

test("P2-1. checkRateLimit handles sliding-window requests under the 20/min ceiling", async () => {
  const ip = "192.168.1.100";
  for (let i = 0; i < 20; i++) {
    const res = await checkRateLimit(ip, "engine-test", 20, 60);
    assert.equal(res.success, true, `Request ${i + 1} should be permitted`);
  }
  const over = await checkRateLimit(ip, "engine-test", 20, 60);
  assert.equal(over.success, false, "Request 21 must be rate limited");
  assert.equal(over.remaining, 0);
});

test("P2-2. checkRateLimit isolates buckets by IP address", async () => {
  const ip1 = "10.1.1.1";
  const ip2 = "10.1.1.2";
  for (let i = 0; i < 20; i++) {
    await checkRateLimit(ip1, "engine-test-iso", 20, 60);
  }
  const res1 = await checkRateLimit(ip1, "engine-test-iso", 20, 60);
  assert.equal(res1.success, false, "ip1 should be exhausted");

  const res2 = await checkRateLimit(ip2, "engine-test-iso", 20, 60);
  assert.equal(res2.success, true, "ip2 should still have quota");
});
