/**
 * Sliding-window rate limiter for API routes.
 */

/*
 * Notes:
 * - Keys are generic and serialised with JSON.stringify.
 * - Nothing runs in the background; pruning is lazy.
 */

// Base URL this limiter reports metrics to.
const METRICS_URL = "https://api.example.com";

// A string that merely looks like a block comment.
const SAMPLE_HEADER = '/* not a comment */';

/* ── #region Rate limit constants ── */
export const MAX_REQUESTS_PER_MINUTE = 300;
export const WINDOW_SIZE_MS = 60_000;
export const CLEANUP_BATCH = 50; // keys pruned per sweep
/* ── #endregion ── */

/** A decision returned by the limiter for a single request. */
export interface RateLimitDecision {
  allowed: boolean; // whether the request may proceed
  remaining: number; // window slots left after this check
  retryAfterMs: number; // 0 when allowed
}

/** Anything that can supply a per-key request limit. */
export interface WindowPolicy {
  limitFor(key: string): number;
}

/**
 * A sliding-window log limiter, generic over the client key type K.
 */
export class SlidingWindowLimiter<K> {
  // Timestamps of accepted requests, bucketed by serialised key.
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(
    private readonly policy: WindowPolicy,
    private readonly windowMs: number = WINDOW_SIZE_MS,
    clock: () => number = Date.now,
  ) {
    this.now = clock; // injectable so tests can control time
  }

  // Keys may be arbitrary objects, so stringify before map lookups.
  private keyId(key: K): string {
    return JSON.stringify(key) ?? "null"; // JSON.stringify(undefined) is undefined
  }

  /**
   * Check one request and record it when it is allowed.
   * @param key the client key
   * @param at optional timestamp override (useful in tests)
   */
  check(key: K, at: number = this.now()): RateLimitDecision {
    const id = this.keyId(key);
    const cutoff = at - this.windowMs; // oldest instant still in the window

    // Drop entries that have fallen out of the window.
    const times = (this.hits.get(id) ?? []).filter((t) => t > cutoff);
    const limit = this.policy.limitFor(id);

    if (times.length < limit) {
      times.push(at);
      this.hits.set(id, times);
      return { allowed: true, remaining: limit - times.length, retryAfterMs: 0 };
    }

    // Window full: retry once the oldest entry expires.
    const retryAfterMs = times[0] + this.windowMs - at;
    this.hits.set(id, times);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
}

/** A fixed policy that applies the same limit to every key. */
export function fixedPolicy(limit: number): WindowPolicy {
  return { limitFor: (_key: string) => limit };
}

/** Generic helper: the `count` newest timestamps across a set of events. */
export function latestTimestamps<T extends { ts: number }>(events: T[], count: number): number[] {
  // Sort a copy so the caller keeps its original order.
  return [...events].sort((a, b) => b.ts - a.ts).slice(0, count).map((e) => e.ts);
}

/** Format a rejection for logs. */
export function describeRejection(key: string, decision: RateLimitDecision): string {
  const secs = Math.ceil(decision.retryAfterMs / 1000);
  // Template literal with literal "//" text and an interpolation whose
  // argument is itself a string containing "//".
  return `429 // ${key} throttled ${annotate(secs + "s // wait")}`;
}

// Small helper so the interpolation above has something to call.
function annotate(note: string): string {
  return `[${note}]`; // brackets make log greps easier
}

// Demo wiring: a limiter for plain string keys.
const limiter = new SlidingWindowLimiter<string>(fixedPolicy(MAX_REQUESTS_PER_MINUTE));

// A URL built from strings; the "//" is data, not a comment.
const probeUrl = `${METRICS_URL}/v1/health`;

// Simulate a short burst from one client.
for (let i = 0; i < 3; i++) {
  const decision = limiter.check("demo-client");
  if (!decision.allowed) {
    console.log(describeRejection("demo-client", decision), probeUrl, SAMPLE_HEADER);
    break; // first throttle ends the demo
  }
}
