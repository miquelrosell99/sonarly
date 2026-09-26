package users

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

// This file is the /api/me/preferences surface (P9c native-parity gap).
// the retired server stored a JSON blob and PATCHed it by spreading the request body over
// the stored map — the audit's Q8 mass-assignment flag: any key a client
// sent was persisted verbatim. The Go server keeps the blob (the shape is the shared
// UserPreferences document) but PATCH runs through an explicit allowlist
// with per-key validation; unknown keys are REJECTED (400), not silently
// dropped like the old five-handpicked fields (which also silently lost the
// frontend's theme keys on every save).

// defaultPreferences mirrors shared/types DEFAULT_USER_PREFERENCES; stored
// values win over these (the old {...defaults, ...parsed} merge).
var defaultPreferences = map[string]any{
	"autoDjEnabled":         false,
	"autoDjMode":            "smart",
	"autoDjTopUpThreshold":  float64(5),
	"autoDjBatchSize":       float64(10),
	"autoDjExcludeWindow":   "24h",
	"autoDjPreferFavorites": false,
	"autoDjDiscovery":       float64(50),
}

// ErrInvalidInput marks a request-body validation failure (400); the route
// layer surfaces the message.
var ErrInvalidInput = errors.New("invalid input")

// ErrUnknownPreferenceKey marks a PATCH key outside the allowlist (400).
var ErrUnknownPreferenceKey = fmt.Errorf("%w: unknown preference key", ErrInvalidInput)

// preferenceValidator validates and normalizes one allowlisted value.
type preferenceValidator struct {
	validate func(any) (any, error)
}

func boolValidator(key string) preferenceValidator {
	return preferenceValidator{func(v any) (any, error) {
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("%s must be a boolean", key)
		}
		return b, nil
	}}
}

func clampedNumberValidator(key string, min, max float64) preferenceValidator {
	return preferenceValidator{func(v any) (any, error) {
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, fmt.Errorf("%s must be a number", key)
		}
		// the retired server clamped out-of-range numbers into range (Math.min/max) instead
		// of rejecting; that normalization is preserved.
		if n < min {
			n = min
		}
		if n > max {
			n = max
		}
		return n, nil
	}}
}

func enumValidator(key string, allowed ...string) preferenceValidator {
	set := make(map[string]bool, len(allowed))
	for _, a := range allowed {
		set[a] = true
	}
	return preferenceValidator{func(v any) (any, error) {
		s, ok := v.(string)
		if !ok || !set[s] {
			return nil, fmt.Errorf("%s must be one of %q", key, allowed)
		}
		return s, nil
	}}
}

func objectValidator(key string) preferenceValidator {
	return preferenceValidator{func(v any) (any, error) {
		if _, ok := v.(map[string]any); !ok {
			return nil, fmt.Errorf("%s must be an object", key)
		}
		return v, nil
	}}
}

// preferenceAllowlist is THE set of patchable keys (Q8 fix). Anything else
// answers 400 — including keys the retired server would have silently ignored, so a client
// bug surfaces immediately instead of corrupting or losing data.
var preferenceAllowlist = map[string]preferenceValidator{
	"autoDjEnabled":         boolValidator("autoDjEnabled"),
	"autoDjMode":            enumValidator("autoDjMode", "similar", "random", "smart"),
	"autoDjTopUpThreshold":  clampedNumberValidator("autoDjTopUpThreshold", 1, 20),
	"autoDjBatchSize":       clampedNumberValidator("autoDjBatchSize", 1, 50),
	"autoDjExcludeWindow":   enumValidator("autoDjExcludeWindow", "24h", "7d", "30d"),
	"autoDjPreferFavorites": boolValidator("autoDjPreferFavorites"),
	"autoDjDiscovery":       clampedNumberValidator("autoDjDiscovery", 0, 100),
	"hideSponsorButton":     boolValidator("hideSponsorButton"),
	"themeMode":             enumValidator("themeMode", "light", "dark", "oled", "auto"),
	"accentColor": enumValidator("accentColor", "auto", "monochrome", "brown", "green",
		"orange", "teal", "purple", "yellow", "cyan", "blue"),
	"playlistsCollapsed": boolValidator("playlistsCollapsed"),
	// Structural documents (sidebar layout, theme, per-view options) are
	// validated as JSON objects and stored verbatim — same contract as the old
	// repository, now behind the allowlist.
	"sidebar":       objectValidator("sidebar"),
	"theme":         objectValidator("theme"),
	"sidebarConfig": objectValidator("sidebarConfig"),
	"viewOptions":   objectValidator("viewOptions"),
}

// loadPreferences returns the merged preferences document: defaults under
// the stored blob. A missing row or a corrupt blob yields the defaults
// (the old try/catch → defaults parity).
func (s *Service) loadPreferences(ctx context.Context, userID string) (map[string]any, error) {
	merged := make(map[string]any, len(defaultPreferences)+16)
	for k, v := range defaultPreferences {
		merged[k] = v
	}
	var raw sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT preferences FROM user_preferences WHERE user_id = ?`, userID).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("load preferences: %w", err)
	}
	if raw.Valid && raw.String != "" {
		var stored map[string]any
		if err := json.Unmarshal([]byte(raw.String), &stored); err == nil {
			for k, v := range stored {
				merged[k] = v
			}
		}
	}
	return merged, nil
}

// GetPreferences answers GET /api/me/preferences.
func (s *Service) GetPreferences(ctx context.Context, userID string) (map[string]any, error) {
	return s.loadPreferences(ctx, userID)
}

// UpdatePreferences answers PATCH /api/me/preferences: every key must be in
// the allowlist (else ErrUnknownPreferenceKey/400), values are validated,
// the patch merges over the stored document, and the upserted result is
// returned (old replied with the merged document too).
func (s *Service) UpdatePreferences(ctx context.Context, userID string, body map[string]any) (map[string]any, error) {
	patch := make(map[string]any, len(body))
	for key, raw := range body {
		validator, ok := preferenceAllowlist[key]
		if !ok {
			return nil, fmt.Errorf("%w %q", ErrUnknownPreferenceKey, key)
		}
		value, err := validator.validate(raw)
		if err != nil {
			return nil, fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
		}
		patch[key] = value
	}
	merged, err := s.loadPreferences(ctx, userID)
	if err != nil {
		return nil, err
	}
	for k, v := range patch {
		merged[k] = v
	}
	blob, err := json.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("encode preferences: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO user_preferences (user_id, preferences, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(user_id) DO UPDATE SET
			preferences = excluded.preferences,
			updated_at = excluded.updated_at`,
		userID, string(blob))
	if err != nil {
		return nil, fmt.Errorf("store preferences: %w", err)
	}
	return merged, nil
}
