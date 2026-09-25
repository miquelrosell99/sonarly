package auth

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
)

// APIKeyHeader carries API keys on the native API, mirroring the header v1's
// OpenSubsonic adapter accepted.
const APIKeyHeader = "X-API-Key"

// Identity is the authenticated principal attached to the request context.
type Identity struct {
	UserID   string
	Username string
	// IsAdmin is the snapshot stored in the session at login. Gate admin
	// routes with RequireAdmin, which re-reads the flag from the database.
	IsAdmin bool
}

type identityKey struct{}

// WithIdentity returns a context carrying id, for tests and internal callers.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// IdentityFrom returns the request's authenticated identity, if any.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}

// Middleware authenticates requests: it verifies the signed session cookie
// (falling back to an API key) and attaches the resulting Identity to the
// request context. It never rejects by itself; compose RequireAuth and/or
// RequireAdmin after it.
type Middleware struct {
	store  *Store
	db     Queries
	secret string
	secure bool
}

func NewMiddleware(store *Store, db *sql.DB, sessionSecret string, secureCookie bool) *Middleware {
	return &Middleware{store: store, db: db, secret: sessionSecret, secure: secureCookie}
}

// AuthMiddleware attaches an Identity when credentials are present and valid.
// Invalid or expired credentials simply leave the request anonymous, so
// public routes can share the same chain.
func (m *Middleware) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, ok := m.authenticate(r); ok {
			r = r.WithContext(WithIdentity(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}

func (m *Middleware) authenticate(r *http.Request) (Identity, bool) {
	ctx := r.Context()
	if cookie, err := r.Cookie(CookieName); err == nil {
		if sid, ok := VerifySignedValue(m.secret, cookie.Value); ok {
			if sess, err := m.store.Get(ctx, sid); err == nil {
				return Identity{UserID: sess.UserID, Username: sess.Username, IsAdmin: sess.IsAdmin}, true
			} else if !errors.Is(err, ErrNotFound) {
				slog.Default().ErrorContext(ctx, "session load failed", "err", err)
			}
		}
	}
	if key := r.Header.Get(APIKeyHeader); key != "" {
		userID, err := VerifyAPIKey(ctx, m.db, key)
		if err == nil {
			var username string
			var isAdmin bool
			if err := m.db.QueryRowContext(ctx,
				`SELECT username, is_admin FROM users WHERE id = ?`, userID).
				Scan(&username, &isAdmin); err == nil {
				return Identity{UserID: userID, Username: username, IsAdmin: isAdmin}, true
			}
		} else if !errors.Is(err, ErrNotFound) {
			slog.Default().ErrorContext(ctx, "api key lookup failed", "err", err)
		}
	}
	return Identity{}, false
}

// RequireAuth rejects anonymous requests with 401.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := IdentityFrom(r.Context()); !ok {
			httpserver.Error(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAdmin gates on the is_admin flag re-read from the database on every
// request, so demoted or deleted users lose access immediately even while
// their session cookie is still valid (v1 admin-routes.ts requireAdmin).
// It must be composed after AuthMiddleware/RequireAuth.
func (m *Middleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := IdentityFrom(r.Context())
		if !ok {
			httpserver.Error(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		var isAdmin bool
		err := m.db.QueryRowContext(r.Context(),
			`SELECT is_admin = 1 FROM users WHERE id = ?`, id.UserID).Scan(&isAdmin)
		if err != nil || !isAdmin {
			httpserver.Error(w, http.StatusForbidden, "Forbidden")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RunSweeper purges expired sessions once and then on the given interval
// until ctx is cancelled. Failures are logged, never fatal — a stuck sweep
// must not take the server down (v1: startup sweep + hourly interval).
func RunSweeper(ctx context.Context, store *Store, log *slog.Logger, interval time.Duration) {
	sweep := func() {
		n, err := store.SweepExpired(ctx)
		if err != nil {
			log.ErrorContext(ctx, "session sweep failed", "err", err)
			return
		}
		if n > 0 {
			log.InfoContext(ctx, "swept expired sessions", "count", n)
		}
	}
	sweep()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweep()
		}
	}
}
