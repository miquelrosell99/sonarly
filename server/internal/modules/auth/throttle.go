package auth

import (
	"strings"
	"sync"
	"time"
)

// Login throttle, ported from the old auth-routes.ts: keyed per client IP +
// lowercase username, five failures lock the pair out for 15 minutes. It is
// deliberate brute-force friction, not a quota; it lives in memory so a
// restart clears it (and it never blocks the setup-created admin for long).
const (
	MaxLoginFailures = 5
	LoginLockout     = 15 * time.Minute
)

type loginThrottle struct {
	failures    int
	lockedUntil time.Time
}

// LoginThrottle tracks failed logins per ip:username pair.
type LoginThrottle struct {
	mu       sync.Mutex
	attempts map[string]*loginThrottle
	// now is replaceable in tests.
	now func() time.Time
}

func NewLoginThrottle() *LoginThrottle {
	return &LoginThrottle{attempts: make(map[string]*loginThrottle), now: time.Now}
}

func throttleKey(remoteAddr, username string) string {
	return remoteAddr + ":" + strings.ToLower(username)
}

// Locked reports whether the pair is currently locked out.
func (t *LoginThrottle) Locked(remoteAddr, username string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	th, ok := t.attempts[throttleKey(remoteAddr, username)]
	return ok && t.now().Before(th.lockedUntil)
}

// RecordFailure adds one failure, locking the pair out once the count
// reaches MaxLoginFailures.
func (t *LoginThrottle) RecordFailure(remoteAddr, username string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	th := t.attempts[throttleKey(remoteAddr, username)]
	if th == nil {
		th = &loginThrottle{}
		t.attempts[throttleKey(remoteAddr, username)] = th
	}
	th.failures++
	if th.failures >= MaxLoginFailures {
		th.lockedUntil = t.now().Add(LoginLockout)
		th.failures = 0
	}
}

// RecordSuccess clears the failure state for the pair.
func (t *LoginThrottle) RecordSuccess(remoteAddr, username string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.attempts, throttleKey(remoteAddr, username))
}
