package opensubsonic

import (
	"context"
	"crypto/md5"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Auth is the /rest/* authentication hook (port of the retired server opensubsonic/auth.ts
// + auth/token.ts; quirks doc A1-A8). It runs after the session middleware,
// which already attached an identity for a valid session cookie or a valid
// X-API-Key header — this hook consumes that as its fallback and adds the
// Subsonic-specific methods on top.
type Auth struct {
	db     *sql.DB
	secret string // session secret, opens the wire-compatible with the retired server secret box
}

func NewAuth(db *sql.DB, sessionSecret string) *Auth {
	return &Auth{db: db, secret: sessionSecret}
}

// Hook authenticates /rest/* requests. On success the identity is attached
// to the context for handlers; on failure an enveloped error is written and
// the chain stops. Precedence (wire parity): apiKey query param → X-API-Key
// header → u/t/s token → session cookie. Plaintext p= auth is deliberately
// not implemented (wire parity, quirks doc A7).
func (a *Auth) Hook(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		q := r.URL.Query()

		// A8: an anonymous shareToken authorizes getPlaylist.view on its own;
		// the endpoint (P9) validates the token against the playlist policy.
		if r.URL.Path == "/rest/getPlaylist.view" && q.Get("shareToken") != "" {
			next.ServeHTTP(w, r)
			return
		}

		// A1/A2: apiKey query param. A presented-but-invalid key short-circuits
		// with 40; it never falls through to the other methods.
		if key := q.Get("apiKey"); key != "" {
			id, ok := a.apiKeyIdentity(ctx, key)
			if !ok {
				Error(w, r, CodeUnauthorized, "Wrong username or password")
				return
			}
			next.ServeHTTP(w, r.WithContext(auth.WithIdentity(ctx, id)))
			return
		}

		// A1/A2: X-API-Key header. The session middleware already tried it: an
		// attached identity means the key was valid (authenticate and stop, as
		// the retired server did for apiKey); a header without an identity was rejected — 40.
		if r.Header.Get(auth.APIKeyHeader) != "" {
			if _, ok := auth.IdentityFrom(ctx); ok {
				next.ServeHTTP(w, r)
				return
			}
			Error(w, r, CodeUnauthorized, "Wrong username or password")
			return
		}

		// A3-A5: u/t/s token. Wrong token falls through to the session
		// identity below (wire parity), it does not reject on its own.
		u, t, s := q.Get("u"), q.Get("t"), q.Get("s")
		if u != "" && t != "" && s != "" {
			if id, ok := a.tokenIdentity(ctx, u, t, s); ok {
				next.ServeHTTP(w, r.WithContext(auth.WithIdentity(ctx, id)))
				return
			}
		}

		// Session cookie fallback: reuse the identity the session middleware
		// attached (A1 step 4, A5 rescue).
		if _, ok := auth.IdentityFrom(ctx); ok {
			next.ServeHTTP(w, r)
			return
		}

		// A6/A7: nothing authenticated. No u/t/s at all (fully anonymous, or
		// a p= password attempt which the retired server never implemented) → 10; u/t/s
		// presented but wrong → 40.
		if u == "" || t == "" || s == "" {
			Error(w, r, CodeMissingParam, "Missing authentication")
			return
		}
		Error(w, r, CodeUnauthorized, "Wrong username or password")
	})
}

// apiKeyIdentity verifies a plaintext API key against the SHA-256 digest
// table (old api-keys.ts parity via auth.VerifyAPIKey) and loads the user's
// flags. A key whose user row vanished is rejected, mirroring the old
// server's getUserById null check.
func (a *Auth) apiKeyIdentity(ctx context.Context, key string) (auth.Identity, bool) {
	userID, err := auth.VerifyAPIKey(ctx, a.db, key)
	if err != nil {
		if !errors.Is(err, auth.ErrNotFound) {
			slog.Default().ErrorContext(ctx, "subsonic api key lookup failed", "err", err)
		}
		return auth.Identity{}, false
	}
	var username string
	var isAdmin bool
	if err := a.db.QueryRowContext(ctx,
		`SELECT username, is_admin FROM users WHERE id = ?`, userID).
		Scan(&username, &isAdmin); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.Default().ErrorContext(ctx, "subsonic api key user lookup failed", "err", err)
		}
		return auth.Identity{}, false
	}
	return auth.Identity{UserID: userID, Username: username, IsAdmin: isAdmin}, true
}

// tokenIdentity implements the Subsonic token check (port of the old
// auth/token.ts): the presented t must equal the hex of
// md5(subsonicPassword + salt), where the password comes from decrypting
// the users.subsonic_password_encrypted column with the session secret.
// The P2 secret box is wire-compatible with the old encryption.ts, so tokens
// minted against a retired-server database verify here unchanged. The comparison is
// timing-safe and length-mismatch-safe (crypto/subtle, quirks doc A3).
func (a *Auth) tokenIdentity(ctx context.Context, username, token, salt string) (auth.Identity, bool) {
	var (
		userID  string
		box     *string
		isAdmin bool
	)
	err := a.db.QueryRowContext(ctx,
		`SELECT id, subsonic_password_encrypted, is_admin FROM users WHERE username = ?`, username).
		Scan(&userID, &box, &isAdmin)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.Identity{}, false
	}
	if err != nil {
		slog.Default().ErrorContext(ctx, "subsonic token user lookup failed", "err", err)
		return auth.Identity{}, false
	}
	if box == nil || *box == "" {
		return auth.Identity{}, false
	}
	password, err := auth.DecryptSecret(*box, a.secret)
	if err != nil {
		slog.Default().ErrorContext(ctx, "subsonic password decrypt failed", "err", err)
		return auth.Identity{}, false
	}
	expected := md5.Sum([]byte(password + salt))
	presented, err := hex.DecodeString(token)
	if err != nil {
		return auth.Identity{}, false
	}
	if subtle.ConstantTimeCompare(presented, expected[:]) != 1 {
		return auth.Identity{}, false
	}
	return auth.Identity{UserID: userID, Username: username, IsAdmin: isAdmin}, true
}
