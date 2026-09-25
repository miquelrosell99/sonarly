package playback

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// maxScrobbleStringLen bounds the free-form client/source strings the history
// row stores (v2 hardening on top of audit B13 — v1 bounded nothing).
const maxScrobbleStringLen = 255

// ScrobbleDetails is the parsed POST /api/songs/{id}/scrobble body (v1's
// ScrobbleDetails). Nil fields were absent from the body.
type ScrobbleDetails struct {
	DurationListened *float64
	Completion       *float64
	Client           *string
	Source           *string
	PlayedAt         *string
}

// scrobbleDateLayouts approximates the formats JavaScript's Date.parse
// accepts (ISO 8601 dates and datetimes, RFC 1123/822, a few ctime-style
// shapes). The original string is stored verbatim, exactly like v1.
var scrobbleDateLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04:05Z07:00",
	time.RFC1123,
	time.RFC1123Z,
	time.RFC822,
	time.RFC822Z,
	time.ANSIC,
	time.UnixDate,
	time.RubyDate,
	"January 2, 2006",
	"Jan 2, 2006",
}

func parseScrobbleDate(value string) bool {
	for _, layout := range scrobbleDateLayouts {
		if _, err := time.Parse(layout, value); err == nil {
			return true
		}
	}
	return false
}

// parseScrobbleBody ports v1's parseScrobbleBody (main checkout, audit B13
// fix): type errors are 400s, completion is clamped to [0,100],
// durationListened to >= 0, playedAt must parse as a date, and client/source
// must be strings within maxScrobbleStringLen. An absent body is valid and
// means "no details" (v1 parity).
func parseScrobbleBody(body any) (*ScrobbleDetails, error) {
	if body == nil {
		return nil, nil
	}
	object, ok := body.(map[string]any)
	if !ok {
		return nil, errors.New("Scrobble body must be an object")
	}
	details := &ScrobbleDetails{}

	if raw, present := object["durationListened"]; present {
		n, ok := raw.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, errors.New("durationListened must be a finite number")
		}
		if n < 0 {
			n = 0
		}
		details.DurationListened = &n
	}

	if raw, present := object["completion"]; present {
		n, ok := raw.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, errors.New("completion must be a finite number")
		}
		n = math.Min(100, math.Max(0, n))
		details.Completion = &n
	}

	if raw, present := object["client"]; present {
		s, ok := raw.(string)
		if !ok {
			return nil, errors.New("client must be a string")
		}
		if len(s) > maxScrobbleStringLen {
			return nil, fmt.Errorf("client must be at most %d characters", maxScrobbleStringLen)
		}
		details.Client = &s
	}

	if raw, present := object["source"]; present {
		s, ok := raw.(string)
		if !ok {
			return nil, errors.New("source must be a string")
		}
		if len(s) > maxScrobbleStringLen {
			return nil, fmt.Errorf("source must be at most %d characters", maxScrobbleStringLen)
		}
		details.Source = &s
	}

	if raw, present := object["playedAt"]; present {
		s, ok := raw.(string)
		if !ok || !parseScrobbleDate(s) {
			return nil, errors.New("playedAt must be a valid date string")
		}
		details.PlayedAt = &s
	}

	return details, nil
}

// decodeScrobbleBody decodes the request body the way v1's JSON parser saw
// it: empty body → nil (no details), malformed or non-object JSON → error.
func decodeScrobbleBody(r io.Reader) (any, error) {
	var body any
	dec := json.NewDecoder(r)
	if err := dec.Decode(&body); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil // no body: v1 treated it as "no details"
		}
		return nil, err
	}
	return body, nil
}

// newHistoryID generates listening_history ids; replaceable in tests to force
// collisions and prove the scrobble transaction is atomic.
var newHistoryID = func() string { return uuid.NewString() }

// nowISO renders t like v1's toISOString: UTC, millisecond precision.
func nowISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// Scrobble records one play: upserts user_songs (play_count + 1, last_played)
// and inserts the listening_history row in ONE transaction — either both land
// or neither (v1 wrapped the same pair in db.transaction). The song must be
// active and in scope, else ErrNotFound. There is deliberately no idempotency
// key: v1 has none, so a retried scrobble double-counts in v1 and does so
// here too (see doc.go).
func (s *Service) Scrobble(ctx context.Context, id auth.Identity, songID string, details *ScrobbleDetails) error {
	if _, err := s.loadPlayableSong(ctx, id, songID, ""); err != nil {
		return err
	}

	playedAt := nowISO(time.Now())
	if details != nil && details.PlayedAt != nil {
		playedAt = *details.PlayedAt
	}
	var durationListened, completion any
	var client, source any
	if details != nil {
		if details.DurationListened != nil {
			durationListened = *details.DurationListened
		}
		if details.Completion != nil {
			completion = *details.Completion
		}
		if details.Client != nil {
			client = *details.Client
		}
		if details.Source != nil {
			source = *details.Source
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_songs (user_id, song_id, play_count, last_played)
		VALUES (?, ?, 1, datetime('now'))
		ON CONFLICT(user_id, song_id) DO UPDATE SET
			play_count = play_count + 1,
			last_played = datetime('now')`,
		id.UserID, songID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened, completion, client, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		newHistoryID(), id.UserID, songID, playedAt, durationListened, completion, client, source); err != nil {
		return err
	}
	return tx.Commit()
}
