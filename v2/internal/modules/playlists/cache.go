package playlists

import (
	"sync"
	"time"
)

// grantCache is the bounded replacement for v1's unbounded smartGrantCache:
// a size-capped map with insertion-order eviction plus a per-entry TTL.
// When full, the oldest inserted entry is dropped; expired entries are
// dropped lazily on access. Not LRU: get does not refresh insertion order,
// keeping the eviction policy exactly "first in, first out".
type grantCache struct {
	mu      sync.Mutex
	entries map[string]*grantCacheEntry
	order   []string // insertion order, front = oldest
	max     int
	ttl     time.Duration
	now     func() time.Time
}

type grantCacheEntry struct {
	ids       map[string]struct{}
	expiresAt time.Time
}

func newGrantCache(max int, ttl time.Duration, now func() time.Time) *grantCache {
	if max <= 0 {
		max = 128
	}
	if now == nil {
		now = time.Now
	}
	return &grantCache{
		entries: make(map[string]*grantCacheEntry, max),
		max:     max,
		ttl:     ttl,
		now:     now,
	}
}

// get returns the cached id set for key. A miss means absent or expired;
// expired entries are removed so a later set cannot resurrect them.
func (c *grantCache) get(key string) (map[string]struct{}, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if !c.now().Before(e.expiresAt) {
		c.removeLocked(key)
		return nil, false
	}
	return e.ids, true
}

// set stores ids under key, refreshing the TTL and re-queueing the key at
// the back, then evicts the oldest entries past the cap.
func (c *grantCache) set(key string, ids map[string]struct{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; ok {
		c.removeLocked(key)
	}
	c.entries[key] = &grantCacheEntry{ids: ids, expiresAt: c.now().Add(c.ttl)}
	c.order = append(c.order, key)
	for len(c.order) > c.max {
		oldest := c.order[0]
		c.removeLocked(oldest)
	}
}

// removeLocked drops key from both indexes. The key must be present.
func (c *grantCache) removeLocked(key string) {
	delete(c.entries, key)
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
}

// len reports the live entry count (tests).
func (c *grantCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}
