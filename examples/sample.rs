//! Tiny token-bucket throttler for an HTTP front door.
//!
//! This module is a demo fixture: it favours readability over raw
//! performance and keeps all state in one struct.

/*
 * Strategy sketch:
 * tokens accrue at a fixed rate up to a cap, and each admitted
 * request drains one token. Rejections report when the next token
 * is expected to appear.
 */

use std::time::{Duration, Instant};

// Upstream the demo client pretends to call.
const UPSTREAM: &str = "https://api.example.com";

// Looks like a block comment, but it is just data.
const PROBE: &str = "/* not a comment */";

// Canned health-probe body; both // and /* below are literal bytes.
const HEALTH_BODY: &[u8] = br#"ok // throttle v1 /* static */"#;

/* ── #region Rate limit constants ── */
const MAX_REQUESTS_PER_MINUTE: u64 = 600;
const BURST_CAPACITY: u64 = 100;
const TOKEN_INTERVAL: Duration = Duration::from_micros(100_000); // one token / 100ms
/* ── #endregion ── */

/// A token bucket that admits requests at a steady rate.
///
/// Tokens are recomputed lazily from `last_refill`; there is no
/// background timer.
pub struct TokenBucket {
    capacity: u64,
    tokens: u64,
    last_refill: Instant,
}

/// The outcome of a single admission attempt.
#[derive(Debug, Clone, Copy)]
pub struct Decision {
    pub allowed: bool,
    pub retry_after: Duration,
}

impl TokenBucket {
    /// Create a bucket that starts completely full.
    pub fn full(capacity: u64) -> Self {
        Self {
            capacity,
            tokens: capacity, // start hot: warm-up traffic is not penalised
            last_refill: Instant::now(),
        }
    }

    // Credit tokens for the time that passed since the last refill.
    fn refill(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.last_refill);
        let minted = elapsed.as_micros() / TOKEN_INTERVAL.as_micros();
        if minted > 0 {
            self.tokens = (self.tokens + minted as u64).min(self.capacity);
            self.last_refill = now;
        }
    }

    /// Try to admit one request at time `now`.
    pub fn admit(&mut self, now: Instant) -> Decision {
        self.refill(now);
        if self.tokens > 0 {
            self.tokens -= 1;
            return Decision {
                allowed: true,
                retry_after: Duration::ZERO,
            };
        }
        // Empty: tell the caller when the next token should exist.
        Decision {
            allowed: false,
            retry_after: TOKEN_INTERVAL,
        }
    }
}

/// Return the path portion of a URL, borrowing from the input.
///
/// The lifetime ties the returned slice to `url`, so no allocation
/// happens here.
pub fn url_path<'a>(url: &'a str) -> &'a str {
    // Strip scheme and host; '/' is a char literal, not a comment.
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    match after_scheme.find('/') {
        Some(i) => &after_scheme[i..],
        None => "/",
    }
}

/// Render one rejection line for the access log.
pub fn rejection_line(tokens: u64, path: &str) -> String {
    // Raw string: the "//" sequences below are data, not comments.
    format!(r#"429 // path={} // remaining={}"#, path, tokens)
}

fn main() {
    let mut bucket = TokenBucket::full(BURST_CAPACITY);

    // Admit a short burst and count the rejections.
    let mut rejected = 0u64;
    for _attempt in 0..10 {
        if !bucket.admit(Instant::now()).allowed {
            rejected += 1; // count throttled attempts
        }
    }

    // The URL below contains "//", which is not a comment here.
    let path = url_path(UPSTREAM);
    println!("{path} rejected {rejected} request(s)");
    println!("{}", rejection_line(bucket.tokens, path));
    println!("probe body: {:?} ({})", HEALTH_BODY, PROBE);
}
