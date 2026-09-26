package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"time"
)

// CookieName matches the old @fastify/session default cookie name.
const CookieName = "sessionId"

// Signed-cookie format, byte-compatible with the old @fastify/cookie signing:
// "<sid>.<base64url(HMAC-SHA256(sid, secret))>".
func signCookieValue(secret, value string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(value))
	return value + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// VerifySignedValue splits and verifies a signed cookie value, returning the
// bare sid. Verification is constant-time and allocates nothing on the
// attacker-controlled length path beyond the decode.
func VerifySignedValue(secret, signed string) (string, bool) {
	value, rawSig, ok := splitLast(signed, '.')
	if !ok {
		return "", false
	}
	sig, err := base64.RawURLEncoding.DecodeString(rawSig)
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(value))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return "", false
	}
	return value, true
}

func splitLast(s string, sep byte) (string, string, bool) {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == sep {
			return s[:i], s[i+1:], true
		}
	}
	return "", "", false
}

// NewSID mints a cryptographically random session id.
func NewSID() string {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// rand.Read only fails if the OS entropy source fails; the process
		// cannot recover session integrity from that.
		panic("auth: no entropy for session id: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(buf[:])
}

// WriteSessionCookie sets the signed session cookie on the response.
func WriteSessionCookie(w http.ResponseWriter, secret string, secure bool, sid string) {
	expires := time.Now().Add(SessionTTL)
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    signCookieValue(secret, sid),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(SessionTTL.Seconds()),
		Expires:  expires,
	})
}

// ClearSessionCookie expires the session cookie on the client.
func ClearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
}
