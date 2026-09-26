package auth_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

func TestSignedCookieRoundTrip(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	value := signForTest(secret, "somesid")
	got, ok := auth.VerifySignedValue(secret, value)
	if !ok || got != "somesid" {
		t.Fatalf("round trip: got %q ok=%v", got, ok)
	}
}

func signForTest(secret, sid string) string {
	// Exercise the public write path and pull the signed value back out.
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, secret, false, sid)
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.CookieName {
			return c.Value
		}
	}
	panic("no cookie written")
}

func TestSignedCookieTamperRejected(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	cases := map[string]string{
		"wrong secret":  func() string { return signForTest("fedcba9876543210fedcba9876543210", "sid") }(),
		"flipped value": func() string { v := signForTest(secret, "sid"); return "xid" + v[3:] }(),
		"flipped sig": func() string {
			v := signForTest(secret, "sid")
			last := v[len(v)-1]
			replacement := byte('A')
			if last == 'A' {
				replacement = 'B'
			}
			return v[:len(v)-1] + string(replacement)
		}(),
		"no signature": "barevalue",
		"empty":        "",
		"bad base64":   "sid.!!!",
	}
	for name, value := range cases {
		if got, ok := auth.VerifySignedValue(secret, value); ok {
			t.Fatalf("%s: accepted %q as %q", name, value, got)
		}
	}
}

func TestNewSIDUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		sid := auth.NewSID()
		if seen[sid] {
			t.Fatalf("duplicate sid %q", sid)
		}
		seen[sid] = true
		if len(sid) < 32 {
			t.Fatalf("sid too short: %q", sid)
		}
	}
}

func TestWriteSessionCookieAttributes(t *testing.T) {
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, "secretsecretsecretsecretsecretsecret", true, "the-sid")

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies: %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != auth.CookieName {
		t.Errorf("name: %q", c.Name)
	}
	if !c.HttpOnly {
		t.Error("must be HttpOnly")
	}
	if c.SameSite != http.SameSiteStrictMode {
		t.Errorf("SameSite: %v", c.SameSite)
	}
	if !c.Secure {
		t.Error("secure flag not propagated")
	}
	if c.Path != "/" {
		t.Errorf("path: %q", c.Path)
	}
	if c.MaxAge != 7*24*60*60 {
		t.Errorf("MaxAge: %d", c.MaxAge)
	}
	sid, ok := auth.VerifySignedValue("secretsecretsecretsecretsecretsecret", c.Value)
	if !ok || sid != "the-sid" {
		t.Errorf("signed value does not verify")
	}
	if !strings.HasPrefix(c.Value, "the-sid.") {
		t.Errorf("cookie not in value.signature form: %q", c.Value)
	}
}

func TestClearSessionCookie(t *testing.T) {
	rec := httptest.NewRecorder()
	auth.ClearSessionCookie(rec, false)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge >= 0 {
		t.Fatalf("clear must expire the cookie: %+v", cookies)
	}
	if cookies[0].Name != auth.CookieName || cookies[0].Value != "" {
		t.Errorf("unexpected cleared cookie: %+v", cookies[0])
	}
}
