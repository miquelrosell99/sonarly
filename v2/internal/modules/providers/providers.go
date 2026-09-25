// Package providers is the admin external-metadata proxy surface (P9c):
// MusicBrainz search and LRCLIB lyrics search, ported from v1's
// features/musicbrainz/{search,routes}.ts and features/lrclib/{search,
// routes}.ts.
//
// Both providers get: a 10s timeout, the v1 User-Agent, NO caching (v1
// parity), and bounded error surfaces — upstream statuses and bodies never
// reach the client, only a generic 502. MusicBrainz additionally enforces
// its 1 req/sec anonymous etiquette with a process-global rate limiter
// (mutex + last-request timestamp, v1's module-global lastRequestAt); a
// request arriving sooner than 1.2s after the previous one waits.
package providers

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// userAgent is v1's USER_AGENT.
const userAgent = "Sonarly/0.1.0 (https://github.com/miquelrosell99/sonarly)"

// fetchTimeout is v1's FETCH_TIMEOUT_MS.
const fetchTimeout = 10 * time.Second

// rateLimiter is v1's process-global MusicBrainz throttle: at most one
// request per minInterval, with latecomers waiting their turn.
type rateLimiter struct {
	mu            sync.Mutex
	lastRequestAt time.Time
	minInterval   time.Duration
}

// wait blocks until minInterval has elapsed since the previous request.
func (l *rateLimiter) wait() {
	l.mu.Lock()
	elapsed := time.Since(l.lastRequestAt)
	if elapsed < l.minInterval {
		remaining := l.minInterval - elapsed
		l.mu.Unlock()
		time.Sleep(remaining)
		l.mu.Lock()
	}
	l.lastRequestAt = time.Now()
	l.mu.Unlock()
}

// newRequest builds a provider GET request with the shared timeout context
// and the v1 headers.
func newRequest(ctx context.Context, url string) (*http.Request, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	return req, cancel, nil
}
