package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
)

// VerifyAPIKey hashes key with SHA-256 (hex, like v1's api-keys.ts) and looks
// it up in api_keys. It returns the owning user's id. Keys are digests at
// rest, so a lookup never reveals or accepts plaintext material beyond what
// the caller presented.
func VerifyAPIKey(ctx context.Context, q Queries, key string) (string, error) {
	sum := sha256.Sum256([]byte(key))
	var userID string
	err := q.QueryRowContext(ctx,
		`SELECT user_id FROM api_keys WHERE key_hash = ?`, hex.EncodeToString(sum[:])).
		Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("verify api key: %w", err)
	}
	return userID, nil
}
