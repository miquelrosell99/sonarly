package autodj

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// ErrGeneration is the typed failure routes map to 502 Bad Gateway. v1
// caught every error and answered 200 with an empty list, which the audit
// flagged: clients could not distinguish "no candidates" from "server
// broke". v2 keeps the empty list for an honestly empty pool and reserves
// 5xx for failures. The message stays generic — driver errors never reach
// the client.
var ErrGeneration = errors.New("auto-dj generation failed")

// Service generates auto-dj candidates. The clock is injectable so the
// smart scorer's recency window is testable.
type Service struct {
	db  *sql.DB
	now func() time.Time
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db, now: time.Now}
}

// Candidates returns count songs for the mode. The context song is optional
// for every mode (a missing id, or an id outside the catalog, just means
// "no context"); excludeIDs are never repeated in the result; the options
// come from the caller's stored preferences (v1).
func (s *Service) Candidates(ctx context.Context, id auth.Identity, currentSongID string, mode Mode, count int, excludeIDs []string) ([]Song, error) {
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	opts, err := s.resolveOptions(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	songs, err := s.candidates(ctx, id.UserID, currentSongID, mode, count, excludeIDs, opts, scope)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrGeneration, err)
	}
	if songs == nil {
		songs = []Song{}
	}
	return songs, nil
}

func (s *Service) candidates(ctx context.Context, userID, currentSongID string, mode Mode, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	var c *SongContext
	if currentSongID != "" {
		loaded, err := s.songContext(ctx, userID, currentSongID)
		if err != nil {
			return nil, err
		}
		// A current song outside the catalog (or out of scope) simply
		// degrades to context-free generation, like v1's undefined context.
		c = loaded
	}
	switch mode {
	case ModeSimilar:
		return s.similarCandidates(ctx, userID, c, count, excludeIDs, opts, scope)
	case ModeRandom:
		return s.randomCandidates(ctx, userID, count, excludeIDs, opts, scope)
	case ModeSmart:
		return s.smartCandidates(ctx, userID, c, count, excludeIDs, opts, scope)
	default:
		return nil, fmt.Errorf("unknown mode %q", mode)
	}
}

// resolveOptions loads the dj configuration from the user's stored
// preferences (v1): the exclude window through the shared whitelist, the
// discovery dial clamped to [0, 100] with v1's fallback of 50.
func (s *Service) resolveOptions(ctx context.Context, userID string) (Options, error) {
	opts := Options{ExcludeWindow: Window24h, Discovery: 50}
	var raw sql.NullString
	if err := s.db.QueryRowContext(ctx,
		`SELECT preferences FROM user_preferences WHERE user_id = ?`, userID).Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return opts, nil
		}
		return opts, fmt.Errorf("load auto-dj preferences: %w", err)
	}
	if !raw.Valid || raw.String == "" {
		return opts, nil
	}
	prefs, err := decodePreferences(raw.String)
	if err != nil {
		// A corrupt preferences blob falls back to defaults (v1 parsed with
		// a try/catch into the same defaults).
		return opts, nil
	}
	if window, ok := prefs["autoDjExcludeWindow"].(string); ok {
		if _, valid := excludeWindowModifiers[ExcludeWindow(window)]; valid {
			opts.ExcludeWindow = ExcludeWindow(window)
		}
	}
	if fav, ok := prefs["autoDjPreferFavorites"].(bool); ok {
		opts.PreferFavorites = fav
	}
	if d, ok := numberValue(prefs["autoDjDiscovery"]); ok {
		opts.Discovery = clampDiscovery(d)
	}
	return opts, nil
}

// smartCandidates ports v1's getSmartCandidates: score the bounded random
// pool against the context, then pick the top count with a deterministic
// tiebreak, backfilling from random mode when the pool comes up short.
func (s *Service) smartCandidates(ctx context.Context, userID string, c *SongContext, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	candidates, err := s.smartCandidateRows(ctx, userID, c, excludeIDs, opts, scope)
	if err != nil {
		return nil, err
	}
	avgPlayCount, err := s.userAveragePlayCount(ctx, userID)
	if err != nil {
		return nil, err
	}

	discovery := clampDiscovery(float64(opts.Discovery))
	// +1 = fully familiar, -1 = fully adventurous.
	familiarityBias := (50.0 - float64(discovery)) / 50.0

	type scored struct {
		candidate candidateRow
		score     float64
	}
	scoredCandidates := make([]scored, len(candidates))
	for i, candidate := range candidates {
		score := 0.0
		song := candidate.song

		if c != nil {
			if song.ArtistID != nil && c.ArtistID != nil && *song.ArtistID == *c.ArtistID {
				score += 3
			}
			score += float64(candidate.genreOverlap) * 2
			if c.Mood != nil && candidate.mood != nil && strings.EqualFold(*candidate.mood, *c.Mood) {
				score += 2
			}
			if c.BPM != nil && candidate.bpm != nil && *c.BPM != 0 {
				diff := absFloat(float64(*candidate.bpm-*c.BPM)) / float64(*c.BPM)
				if diff <= 0.05 {
					score += 1
				}
			}
			if c.AlbumID != nil && song.AlbumID != nil && *song.AlbumID == *c.AlbumID {
				score -= 5
			}
		}

		if candidate.rating != nil {
			score += *candidate.rating
		}

		if candidate.lastPlayed != nil {
			if playedAt, ok := parseStoredTime(*candidate.lastPlayed); ok {
				if s.now().Sub(playedAt).Hours() < 24 {
					score -= 2
				}
			}
		}

		// Discovery dial: familiar boosts well-played tracks, adventurous
		// penalizes them and lifts never-played deep cuts instead.
		familiarity := float64(min(intValue(candidate.playCount), 20)) / 20
		score += familiarityBias * familiarity * 4
		if familiarityBias < 0 && intValue(candidate.playCount) == 0 {
			score += -familiarityBias * 2
		}

		// Overplayed penalty grows with adventurousness (none at full familiar).
		if avgPlayCount > 0 && float64(intValue(candidate.playCount)) > avgPlayCount {
			score -= float64(discovery) / 100
		}

		if opts.PreferFavorites && song.Starred {
			score += 3
		}

		scoredCandidates[i] = scored{candidate: candidate, score: score}
	}

	sort.SliceStable(scoredCandidates, func(i, j int) bool {
		if scoredCandidates[i].score != scoredCandidates[j].score {
			return scoredCandidates[i].score > scoredCandidates[j].score
		}
		// Deterministic tiebreak by id (v1's localeCompare).
		return scoredCandidates[i].candidate.song.ID < scoredCandidates[j].candidate.song.ID
	})

	picked := []Song{}
	for i := 0; i < len(scoredCandidates) && len(picked) < count; i++ {
		picked = append(picked, scoredCandidates[i].candidate.song)
	}

	if len(picked) < count {
		extra := append([]string{}, excludeIDs...)
		for _, song := range picked {
			extra = append(extra, song.ID)
		}
		if c != nil {
			extra = append(extra, c.ID)
		}
		more, err := s.randomCandidates(ctx, userID, count-len(picked), extra, opts, scope)
		if err != nil {
			return nil, err
		}
		picked = append(picked, more...)
	}
	return picked, nil
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func intValue(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func clampDiscovery(v float64) int {
	return int(min(100, max(0, v)))
}

// parseStoredTime reads the two timestamp shapes the database holds:
// user_songs.last_played is written as datetime('now') ('YYYY-MM-DD
// HH:MM:SS') and older rows may carry ISO 8601 from scrobbles.
func parseStoredTime(value string) (time.Time, bool) {
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
