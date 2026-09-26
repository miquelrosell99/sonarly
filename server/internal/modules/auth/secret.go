package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// AES-256-GCM secret box for at-rest credentials, wire-compatible with the old
// features/auth/encryption.ts: key = SHA-256(secret), stored as
// "base64(iv):base64(authTag):base64(ciphertext)". Subsonic passwords stored
// by either implementation decrypt under the other.

var (
	ErrInvalidSecretBox = errors.New("invalid encrypted value format")
	errSecretBoxOpen    = errors.New("cannot decrypt value")
)

func deriveKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// EncryptSecret seals plaintext with the config secret.
func EncryptSecret(plaintext, secret string) (string, error) {
	block, err := aes.NewCipher(deriveKey(secret))
	if err != nil {
		return "", fmt.Errorf("encrypt: %w", err)
	}
	// the retired server (Node crypto) used a 16-byte IV; Go's default GCM nonce is 12 bytes,
	// so pin the nonce size to stay wire-compatible with the old stored values.
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("encrypt: %w", err)
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("encrypt: iv: %w", err)
	}
	ciphertext := gcm.Seal(nil, iv, []byte(plaintext), nil)
	// gcm.Seal appends the auth tag to the ciphertext; split it back out so
	// the layout matches the old iv:tag:ciphertext.
	tagStart := len(ciphertext) - gcm.Overhead()
	return strings.Join([]string{
		base64.StdEncoding.EncodeToString(iv),
		base64.StdEncoding.EncodeToString(ciphertext[tagStart:]),
		base64.StdEncoding.EncodeToString(ciphertext[:tagStart]),
	}, ":"), nil
}

// DecryptSecret opens a value produced by EncryptSecret (or by the old encrypt).
func DecryptSecret(box, secret string) (string, error) {
	parts := strings.Split(box, ":")
	if len(parts) != 3 {
		return "", ErrInvalidSecretBox
	}
	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", ErrInvalidSecretBox
	}
	tag, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ErrInvalidSecretBox
	}
	ciphertext, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", ErrInvalidSecretBox
	}
	block, err := aes.NewCipher(deriveKey(secret))
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	sealed := make([]byte, 0, len(ciphertext)+len(tag))
	sealed = append(sealed, ciphertext...)
	sealed = append(sealed, tag...)
	plaintext, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", errSecretBoxOpen
	}
	return string(plaintext), nil
}
