/**
 * Application-level sliding-window rate limiter for Vercel Serverless.
 *
 * Implements sliding-window counter:
 * - If Vercel KV / Upstash Redis credentials are set (KV_REST_API_URL + KV_REST_API_TOKEN),
 *   executes atomic REST commands to Redis for global consistency across serverless instances.
 * - Otherwise (local development, test runner, unprovisioned KV), operates an in-memory
 *   sliding window with LRU cleanup.
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in ms when window resets
}

// In-memory sliding window log: key -> timestamps[]
const memoryBuckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

export async function checkRateLimit(
  ip: string,
  routeKey: string,
  maxRequests = 10,
  windowSeconds = 60
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const key = `${routeKey}:${ip || "anonymous"}`;

  // Check if Upstash Redis credentials are set in environment
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (kvUrl && kvToken) {
    try {
      // Upstash REST API multi-exec sliding window pipeline:
      // ZREMRANGEBYSCORE key 0 (now - window)
      // ZADD key now now
      // ZCARD key
      // EXPIRE key windowSeconds
      const minScore = now - windowMs;
      const pipelineUrl = `${kvUrl.replace(/\/+$/, "")}/pipeline`;
      const response = await fetch(pipelineUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${kvToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["ZREMRANGEBYSCORE", key, 0, minScore],
          ["ZADD", key, now, String(now)],
          ["ZCARD", key],
          ["EXPIRE", key, windowSeconds],
        ]),
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        const results = await response.json();
        const currentCount = Number(results[2]?.result ?? 1);
        const remaining = Math.max(0, maxRequests - currentCount);
        const reset = now + windowMs;

        return {
          success: currentCount <= maxRequests,
          limit: maxRequests,
          remaining,
          reset,
        };
      }
    } catch {
      // Fallback to in-memory on remote KV timeout / network partition
    }
  }

  // In-memory fallback
  if (memoryBuckets.size > MAX_BUCKETS) {
    // Evict oldest entries
    const iter = memoryBuckets.keys();
    for (let i = 0; i < 1000; i++) {
      const nextKey = iter.next().value;
      if (nextKey) memoryBuckets.delete(nextKey);
    }
  }

  let timestamps = memoryBuckets.get(key) || [];
  const cutoff = now - windowMs;
  timestamps = timestamps.filter(t => t > cutoff);

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0] || now;
    const reset = oldest + windowMs;
    memoryBuckets.set(key, timestamps);
    return {
      success: false,
      limit: maxRequests,
      remaining: 0,
      reset,
    };
  }

  timestamps.push(now);
  memoryBuckets.set(key, timestamps);

  return {
    success: true,
    limit: maxRequests,
    remaining: maxRequests - timestamps.length,
    reset: now + windowMs,
  };
}

/** Reset in-memory rate limit store (for unit tests). */
export function resetMemoryRateLimits(): void {
  memoryBuckets.clear();
}
