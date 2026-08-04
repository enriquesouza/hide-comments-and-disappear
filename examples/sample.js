/*! throttle-core v2.3.1 | MIT License | https://example.com/license */

/**
 * A small token-bucket rate limiter for API gateways.
 * Tokens refill continuously; requests are rejected (not queued)
 * once the bucket is empty.
 */

/*
 * Design notes:
 * - The bucket starts full so warm-up traffic is not penalised.
 * - Rejections carry a Retry-After hint in milliseconds.
 * - Clock skew is tolerated by ignoring negative elapsed time.
 */

// Default upstream used by the demo client at the bottom of this file.
const DEFAULT_ENDPOINT = "https://api.example.com";

// Looks like a block comment, but it is just a string:
const PLACEHOLDER_BODY = '/* not a comment */';

/* ── #region Rate limit constants ── */
const MAX_REQUESTS_PER_MINUTE = 120;
const BURST_ALLOWANCE = 20;
const REFILL_PER_SECOND = MAX_REQUESTS_PER_MINUTE / 60; // 2 tokens/sec
/* ── #endregion ── */

/**
 * Token bucket that admits requests while tokens remain.
 */
class TokenBucket {
  /**
   * @param {number} capacity maximum tokens the bucket can hold
   * @param {number} refillPerSecond tokens added per second
   */
  constructor(capacity, refillPerSecond) {
    this.capacity = capacity;
    this.tokens = capacity; // start full
    this.refillPerSecond = refillPerSecond;
    this.lastRefill = Date.now();
  }

  // Top up based on elapsed time since the last refill.
  refill(now = Date.now()) {
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return; // ignore clock skew
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefill = now;
  }

  /**
   * Try to consume a single token.
   * @returns {{ allowed: boolean, retryAfterMs: number }}
   */
  take() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    // How long until the next whole token exists?
    const retryAfterMs = Math.ceil((1 - this.tokens) * (1000 / this.refillPerSecond));
    return { allowed: false, retryAfterMs };
  }
}

/**
 * Format a retry delay for logs and error payloads.
 * @param {number} ms delay in milliseconds
 * @param {string} suffix appended after the seconds count
 */
function formatRetry(ms, suffix) {
  return `${Math.ceil(ms / 1000)}s${suffix}`;
}

// Build the message a throttled client sees. The template literal below
// holds literal "//" text plus an interpolation whose argument is itself
// a string containing "//".
const rejectionNote = (retryAfterMs) =>
  `throttled // retry in ${formatRetry(retryAfterMs, "// soon")}`;

/**
 * Guard one request with the bucket and return an HTTP-ish decision.
 */
function admit(bucket, path) {
  const decision = bucket.take();
  if (!decision.allowed) {
    // Log the rejection; the "//" in the URL is part of the scheme.
    console.log(`GET ${DEFAULT_ENDPOINT}${path} // ${rejectionNote(decision.retryAfterMs)}`);
    return { status: 429, body: PLACEHOLDER_BODY };
  }
  return { status: 200, body: "ok" };
}

// Demo: a bucket sized by the constants above.
const bucket = new TokenBucket(BURST_ALLOWANCE, REFILL_PER_SECOND);

// Fire a few requests; some are rejected once the burst is exhausted.
for (let i = 0; i < 25; i++) {
  const result = admit(bucket, `/v1/items/${i}`);
  if (result.status === 429) break; // stop at the first throttle
}
