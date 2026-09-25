package auth_test

import (
	"strings"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

const secretBoxSecret = "0123456789abcdef0123456789abcdef"

func TestSecretBoxRoundTrip(t *testing.T) {
	box, err := auth.EncryptSecret("hunter22", secretBoxSecret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	plaintext, err := auth.DecryptSecret(box, secretBoxSecret)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if plaintext != "hunter22" {
		t.Fatalf("round trip: got %q", plaintext)
	}
}

// TestSecretBoxV1Vector proves wire compatibility with v1's encryption.ts:
// this value was produced by the v1 implementation (Node crypto, aes-256-gcm,
// iv:tag:ciphertext base64) and must decrypt under the Go port.
func TestSecretBoxV1Vector(t *testing.T) {
	const v1Vector = "ETL3CxcXHRiSAtM1r5gdNw==:CBWEqorakSLtFAyZZq1UEw==:hktrrVs1Lzs="
	plaintext, err := auth.DecryptSecret(v1Vector, secretBoxSecret)
	if err != nil {
		t.Fatalf("decrypt v1 vector: %v", err)
	}
	if plaintext != "hunter22" {
		t.Fatalf("v1 vector: got %q", plaintext)
	}
}

func TestSecretBoxRejectsTampering(t *testing.T) {
	box, err := auth.EncryptSecret("hunter22", secretBoxSecret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.DecryptSecret(box, "fedcba9876543210fedcba9876543210"); err == nil {
		t.Fatal("wrong secret must fail")
	}
	parts := strings.Split(box, ":")
	if _, err := auth.DecryptSecret(parts[0]+":AAAA:"+parts[2], secretBoxSecret); err == auth.ErrInvalidSecretBox {
		t.Fatal("structurally valid but wrong tag must be an open failure, not a format error")
	}
	if _, err := auth.DecryptSecret("not-a-box", secretBoxSecret); err != auth.ErrInvalidSecretBox {
		t.Fatalf("malformed box: want ErrInvalidSecretBox, got %v", err)
	}
}
