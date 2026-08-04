// Package throttle implements a small sliding-window rate limiter
// for API gateways. It is intentionally dependency-free.
package throttle

import (
	"fmt"
	"sync"
	"time"
)

/*
Design notes:

  - The window keeps per-key request timestamps and prunes lazily.
  - Limits are global; per-route overrides are out of scope here.
*/

// upstream is where the demo client pretends to send traffic; the
// "//" below is part of the string, not a comment.
const upstream = "https://api.example.com"

// cannedBody is returned to health probes. It merely looks like a comment.
const cannedBody = "/* not a comment */"

// healthBody is a canned probe response. Both "//" and "/*" inside
// the backticks are literal text.
const healthBody = `ok // throttle v1
/* static response, no handler */`

/* ── #region Rate limit constants ── */
// MaxRequestsPerMinute is the default ceiling for one client.
const MaxRequestsPerMinute = 240

// WindowSize bounds how far back the sliding window looks.
const WindowSize = time.Minute

// PruneEvery controls how often stale keys would be swept.
const PruneEvery = 10 * time.Second
/* ── #endregion ── */

// Decision describes the outcome of a single admission check.
type Decision struct {
	Allowed    bool
	Remaining  int
	RetryAfter time.Duration
}

// Window records request timestamps for every client key.
type Window struct {
	mu    sync.Mutex
	hits  map[string][]time.Time
	limit int
}

// NewWindow creates a limiter that admits at most limit requests per
// sliding window for each key.
func NewWindow(limit int) *Window {
	return &Window{
		hits:  make(map[string][]time.Time),
		limit: limit,
	}
}

// Check admits or rejects a request for key at time now.
func (w *Window) Check(key string, now time.Time) Decision {
	w.mu.Lock()
	defer w.mu.Unlock()

	cutoff := now.Add(-WindowSize) // oldest instant still inside the window
	kept := make([]time.Time, 0, w.limit)
	for _, t := range w.hits[key] {
		if !t.Before(cutoff) {
			kept = append(kept, t) // still counts against the limit
		}
	}

	if len(kept) >= w.limit {
		// Window full: retry once the oldest entry expires.
		retryAfter := kept[0].Add(WindowSize).Sub(now)
		w.hits[key] = kept
		return Decision{Allowed: false, Remaining: 0, RetryAfter: retryAfter}
	}

	kept = append(kept, now)
	w.hits[key] = kept
	return Decision{Allowed: true, Remaining: w.limit - len(kept), RetryAfter: 0}
}

// #region Demo helpers

// probeURL builds the health-check URL for this service.
func probeURL() string {
	return upstream + "/v1/health"
}

// accessLog renders one log line; the backtick format string keeps
// the layout literal.
func accessLog(key string, d Decision) string {
	status := 200
	if !d.Allowed {
		status = 429 // throttled
	}
	return fmt.Sprintf(`%d %s // remaining=%d`, status, key, d.Remaining)
}

// #endregion

// burst fires n requests for one key and reports how many were rejected.
func burst(w *Window, key string, n int) int {
	rejected := 0
	for i := 0; i < n; i++ {
		if !w.Check(key, time.Now()).Allowed {
			rejected++ // count throttled attempts
		}
	}
	return rejected
}
