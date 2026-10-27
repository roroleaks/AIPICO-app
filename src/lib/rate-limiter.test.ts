import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, resetMemoryRateLimits } from "./rate-limiter.ts";

test.beforeEach(() => {
  resetMemoryRateLimits();
});

test("RL1. Allows requests under the limit", async () => {
  const r1 = await checkRateLimit("192.168.1.1", "engine", 3, 60);
  assert.equal(r1.success, true);
  assert.equal(r1.remaining, 2);

  const r2 = await checkRateLimit("192.168.1.1", "engine", 3, 60);
  assert.equal(r2.success, true);
  assert.equal(r2.remaining, 1);

  const r3 = await checkRateLimit("192.168.1.1", "engine", 3, 60);
  assert.equal(r3.success, true);
  assert.equal(r3.remaining, 0);
});

test("RL2. Blocks requests exceeding the limit", async () => {
  for (let i = 0; i < 3; i++) {
    await checkRateLimit("10.0.0.1", "pubmed", 3, 60);
  }

  const blocked = await checkRateLimit("10.0.0.1", "pubmed", 3, 60);
  assert.equal(blocked.success, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.reset > Date.now(), "Reset timestamp must be in the future");
});

test("RL3. Isolates limits by IP address", async () => {
  for (let i = 0; i < 3; i++) {
    await checkRateLimit("10.0.0.1", "pdf", 3, 60);
  }
  const ip1Blocked = await checkRateLimit("10.0.0.1", "pdf", 3, 60);
  assert.equal(ip1Blocked.success, false);

  // Different IP should still have remaining allowance
  const ip2 = await checkRateLimit("10.0.0.2", "pdf", 3, 60);
  assert.equal(ip2.success, true);
  assert.equal(ip2.remaining, 2);
});

test("RL4. Isolates limits by route key", async () => {
  for (let i = 0; i < 3; i++) {
    await checkRateLimit("10.0.0.5", "docx", 3, 60);
  }
  const docxBlocked = await checkRateLimit("10.0.0.5", "docx", 3, 60);
  assert.equal(docxBlocked.success, false);

  // Same IP on different route should be allowed
  const pubmedAllowed = await checkRateLimit("10.0.0.5", "pubmed", 3, 60);
  assert.equal(pubmedAllowed.success, true);
});
