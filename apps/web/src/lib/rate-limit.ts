// B-203: in-memory sliding-window rate limiter, keyed per client (IP) and
// per named bucket (e.g. "search", "checkout") so one client's traffic on
// one bucket never affects another client's budget or another bucket's
// budget — this is what keeps a legitimate burst (blueprint §23 scenario:
// 1000 different customers reserving the last unit of a popular card)
// unaffected, since each of those 1000 clients gets its own limit.
//
// In-memory means the limit is per server process, not global across a
// horizontally-scaled deployment (multiple Node instances behind a load
// balancer each get their own budget). That is a real tradeoff, accepted
// here rather than adding a Redis/Upstash dependency this repo has no
// provisioned credentials for; swap the storage in `hitBuckets` for a
// distributed store (e.g. @upstash/ratelimit) if/when the app runs with
// more than one instance in production.

interface RateLimitRule {
  windowMs: number;
  max: number;
}

// Bound memory: once a bucket's key count exceeds this, evict the
// oldest-inserted key. Map preserves insertion order, so this is a cheap
// approximate LRU without needing a timer (timers are unreliable in
// serverless/edge environments that can be frozen or recycled between
// requests).
const MAX_TRACKED_CLIENTS_PER_BUCKET = 10_000;

const hitBuckets = new Map<string, Map<string, number[]>>();

function getBucket(bucketName: string): Map<string, number[]> {
  let bucket = hitBuckets.get(bucketName);
  if (!bucket) {
    bucket = new Map();
    hitBuckets.set(bucketName, bucket);
  }
  return bucket;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  bucketName: string,
  clientId: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = getBucket(bucketName);

  if (bucket.size >= MAX_TRACKED_CLIENTS_PER_BUCKET && !bucket.has(clientId)) {
    const oldestKey = bucket.keys().next().value;
    if (oldestKey !== undefined) {
      bucket.delete(oldestKey);
    }
  }

  const windowStart = now - rule.windowMs;
  const previousHits = bucket.get(clientId) ?? [];
  const recentHits = previousHits.filter((timestamp) => timestamp > windowStart);

  const limited = recentHits.length >= rule.max;
  if (!limited) {
    recentHits.push(now);
  }
  bucket.set(clientId, recentHits);

  const oldestInWindow = recentHits[0] ?? now;
  const retryAfterSeconds = limited
    ? Math.max(1, Math.ceil((oldestInWindow + rule.windowMs - now) / 1000))
    : 0;

  return {
    limited,
    remaining: Math.max(0, rule.max - recentHits.length),
    retryAfterSeconds,
  };
}

// Test-only: clears all tracked state between test cases.
export function _resetRateLimitState(): void {
  hitBuckets.clear();
}

export const RATE_LIMIT_RULES = {
  // Catalogue browsing/search: generous enough that a customer clicking
  // through filters/pages in one session never trips it, per the perf
  // budget's INP < 200ms filter-click expectation implying frequent
  // interaction.
  search: { windowMs: 60_000, max: 60 } satisfies RateLimitRule,
  // Checkout-adjacent (cart, checkout): tighter, since legitimate traffic
  // here is form submissions, not rapid browsing, but loose enough to
  // allow a few retries after a declined card or validation error.
  checkout: { windowMs: 60_000, max: 20 } satisfies RateLimitRule,
} as const;
