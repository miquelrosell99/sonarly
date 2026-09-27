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

// ErrGeneration is the typed failure routes map to 502 Bad Gateway. The old
// server caught every error and answered 200 with an empty list, which the audit
// flagged: clients could not distinguish "no candidates" from "server
// broke". The Go server keeps the empty list for an honestly empty pool and reserves
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

// Candidates returns count songs for the mode. The seed is the caller's
// current song when it carries similarity signal, else the last queued track
// with signal (the posted queue tail), else the user's most recently played
// song — so a session that starts from Jazz keeps scoring against Jazz.
// excludeIDs are never repeated; queueIDs are the caller's current queue and
// are a hard guarantee: no returned song duplicates one of them, whatever the
// SQL exclusion caps. Generation is stateless and idempotent: the same
// (currentSongId, mode, count, excludeIds, queueIds, preferences) always
// yields an equivalent batch, and a refresh just re-posts with the previous
// suggestions added to the exclusion lists.
func (s *Service) Candidates(ctx context.Context, id auth.Identity, currentSongID string, mode Mode, count int, excludeIDs, queueIDs []string) ([]Song, error) {
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	opts, err := s.resolveOptions(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	songs, err := s.candidates(ctx, id.UserID, currentSongID, mode, count, excludeIDs, queueIDs, opts, scope)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrGeneration, err)
	}
	if songs == nil {
		songs = []Song{}
	}
	return songs, nil
}

func (s *Service) candidates(ctx context.Context, userID, currentSongID string, mode Mode, count int, excludeIDs, queueIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	seed, err := s.resolveSeed(ctx, userID, currentSongID, queueIDs)
	if err != nil {
		return nil, err
	}
	// The SQL-level exclusion sees the capped union of caller exclusions and
	// the queue; the hard post-filter below sees the uncapped queue set.
	excludeSet := append(append([]string{}, excludeIDs...), queueIDs...)
	if seed != nil {
		excludeSet = append(excludeSet, seed.ID)
	}
	blocked := idSet(queueIDs)
	if seed != nil {
		blocked[seed.ID] = true
	}

	var picked []Song
	switch mode {
	case ModeSimilar:
		picked, err = s.similarCandidates(ctx, userID, seed, count, excludeSet, opts, scope)
	case ModeRandom:
		picked, err = s.randomCandidates(ctx, userID, count, excludeSet, opts, scope)
	case ModeSmart:
		picked, err = s.smartCandidates(ctx, userID, seed, count, excludeSet, opts, scope)
	default:
		return nil, fmt.Errorf("unknown mode %q", mode)
	}
	if err != nil {
		return nil, err
	}

	// Hard rule: a suggestion never duplicates the posted queue (or the
	// seed), even past the SQL exclusion cap.
	picked = dropQueuedSongs(picked, blocked)
	if len(picked) < count {
		extra := append(append([]string{}, excludeSet...), songIDsOf(picked)...)
		more, err := s.randomCandidates(ctx, userID, count-len(picked), extra, opts, scope)
		if err != nil {
			return nil, err
		}
		picked = append(picked, dropQueuedSongs(more, blocked)...)
	}
	return picked, nil
}

// resolveSeed picks the similarity anchor: the current song when it has
// signal, else the newest queued track with signal, else the most recently
// played song. A song "has signal" when it can steer scoring at all (artist,
// album, or genres); a context-free request degrades to nil, like the old
// undefined context.
func (s *Service) resolveSeed(ctx context.Context, userID, currentSongID string, queueIDs []string) (*SongContext, error) {
	if currentSongID != "" {
		c, err := s.songContext(ctx, userID, currentSongID)
		if err != nil {
			return nil, err
		}
		if hasSignal(c) {
			return c, nil
		}
	}
	for i := len(queueIDs) - 1; i >= 0; i-- {
		c, err := s.songContext(ctx, userID, queueIDs[i])
		if err != nil {
			return nil, err
		}
		if hasSignal(c) {
			return c, nil
		}
	}
	latest, err := s.latestPlayedSong(ctx, userID)
	if err != nil {
		return nil, err
	}
	if latest == "" {
		return nil, nil
	}
	c, err := s.songContext(ctx, userID, latest)
	if err != nil {
		return nil, err
	}
	if hasSignal(c) {
		return c, nil
	}
	return nil, nil
}

func hasSignal(c *SongContext) bool {
	return c != nil && (c.ArtistID != nil || c.AlbumID != nil || len(c.GenreIDs) > 0)
}

func songIDsOf(songs []Song) []string {
	ids := make([]string, len(songs))
	for i := range songs {
		ids[i] = songs[i].ID
	}
	return ids
}

// resolveOptions loads the dj configuration from the user's stored
// preferences (the retired server): the exclude window through the shared whitelist, the
// discovery dial clamped to [0, 100] with the old fallback of 50.
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
		// A corrupt preferences blob falls back to defaults (old parsed with
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

// smartCandidates ports the old getSmartCandidates: score the bounded random
// pool against the seed, then pick through the diversity caps with a
// deterministic tiebreak, backfilling from random mode when the pool comes up
// short.
func (s *Service) smartCandidates(ctx context.Context, userID string, seed *SongContext, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	candidates, err := s.smartCandidateRows(ctx, userID, seed, excludeIDs, opts, scope)
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

	scoredCandidates := make([]scoredCandidate, len(candidates))
	for i, candidate := range candidates {
		score := 0.0
		song := candidate.song

		if seed != nil {
			if song.ArtistID != nil && seed.ArtistID != nil && *song.ArtistID == *seed.ArtistID {
				score += 3
			}
			score += float64(candidate.genreOverlap) * 2
			if seed.Mood != nil && candidate.mood != nil && strings.EqualFold(*candidate.mood, *seed.Mood) {
				score += 2
			}
			if seed.BPM != nil && candidate.bpm != nil && *seed.BPM != 0 {
				diff := absFloat(float64(*candidate.bpm-*seed.BPM)) / float64(*seed.BPM)
				if diff <= 0.05 {
					score += 1
				}
			}
			if seed.AlbumID != nil && song.AlbumID != nil && *song.AlbumID == *seed.AlbumID {
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

		scoredCandidates[i] = scoredCandidate{row: candidate, score: score}
	}

	sort.SliceStable(scoredCandidates, func(i, j int) bool {
		if scoredCandidates[i].score != scoredCandidates[j].score {
			return scoredCandidates[i].score > scoredCandidates[j].score
		}
		// Deterministic tiebreak by id (the old localeCompare).
		return scoredCandidates[i].row.song.ID < scoredCandidates[j].row.song.ID
	})

	picked := []Song{}
	for _, sc := range diversePick(scoredCandidates, count) {
		song := sc.row.song
		song.Reason = reasonFor(sc.row, seed)
		picked = append(picked, song)
	}

	if len(picked) < count {
		extra := append([]string{}, excludeIDs...)
		for _, song := range picked {
			extra = append(extra, song.ID)
		}
		if seed != nil {
			extra = append(extra, seed.ID)
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
