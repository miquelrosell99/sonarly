package playback

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playlists"
)

// ErrNotFound is the single not-found sentinel for the playback domain: a
// missing song, an inactive song (S2 sign-off S5 — v1 silently streamed
// those), an out-of-scope song, and a vanished file are indistinguishable,
// so ids cannot be probed (same contract as the catalog module).
var ErrNotFound = errors.New("playback: not found")

// ErrUnauthorized is the anonymous-stream answer: no share token presented,
// or a token no link-shared playlist answers to (v1 answered 403; v2 uses
// 401, the same status an anonymous request without credentials gets).
var ErrUnauthorized = errors.New("playback: unauthorized")

// Options configures the streaming service.
type Options struct {
	// MaxConcurrentTranscodes caps simultaneous ffmpeg processes (default 2).
	// Direct streams are never capped.
	MaxConcurrentTranscodes int
	// FFmpegPath is the ffmpeg binary to exec; "" or "ffmpeg" resolves via
	// PATH. A custom path exists for container images that pin the binary.
	FFmpegPath string
}

// Service is the playback domain API: streaming (direct + transcode),
// scrobbling, and bookmarks. Layering follows the v2 convention
// (routes → service → repository): routes parse and validate HTTP, the
// service enforces liveness + library scope and orchestrates, the
// streamers own the wire behavior.
type Service struct {
	db        *sql.DB
	direct    DirectStreamer
	transcode *TranscodingStreamer
	policy    *playlists.Policy
	log       *slog.Logger
}

func NewService(db *sql.DB, opts Options, log *slog.Logger, policy *playlists.Policy) *Service {
	if log == nil {
		log = slog.Default()
	}
	if policy == nil {
		policy = playlists.NewPolicy()
	}
	return &Service{
		db:        db,
		transcode: NewTranscodingStreamer(opts.MaxConcurrentTranscodes, opts.FFmpegPath, log),
		policy:    policy,
		log:       log,
	}
}

// TranscodingStreamer exposes the streamer so tests can observe spawned PIDs
// and so the route layer can answer HEAD without spawning. Production route
// code must not call Stream directly — go through Service.Stream.
func (s *Service) TranscodingStreamer() *TranscodingStreamer { return s.transcode }

// playSong is the slice of the songs row playback needs.
type playSong struct {
	id       string
	filePath string
	bitRate  int // bits per second as stored; 0 = NULL (unknown)
}

// loadPlayableSong resolves a song for playback: the row must exist with
// active = 1 AND sit inside the caller's library scope, otherwise
// ErrNotFound. Anonymous callers (no session identity) are authorized ONLY
// by a playlist share token: the token must belong to a link-shared
// playlist (ErrUnauthorized otherwise — the token itself is bogus) and must
// grant the song through the playlist policy (ErrNotFound otherwise — a
// valid token never authorizes another playlist's content). A valid token
// skips the library-scope check by design: v1 share semantics — the token
// authorizes the linked playlist's own content, scope applies to signed-in
// users only. A signed-in caller always wins: the share token is consulted
// only for anonymous requests.
func (s *Service) loadPlayableSong(ctx context.Context, id auth.Identity, songID, shareToken string) (*playSong, error) {
	if id.UserID == "" {
		if shareToken == "" {
			return nil, ErrUnauthorized
		}
		exists, err := s.policy.TokenExists(ctx, s.db, shareToken)
		if err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrUnauthorized
		}
		granted, err := s.policy.TokenGrantsSong(ctx, s.db, shareToken, songID)
		if err != nil {
			return nil, err
		}
		if !granted {
			return nil, ErrNotFound
		}
		return s.loadActiveSong(ctx, songID)
	}

	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	ok, err := libraries.IsSongInScope(ctx, s.db, scope, songID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return s.loadActiveSong(ctx, songID)
}

// loadActiveSong loads an active song row without any scope check; callers
// have already authorized the id.
func (s *Service) loadActiveSong(ctx context.Context, songID string) (*playSong, error) {
	var song playSong
	var bitRate sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, file_path, bit_rate FROM songs WHERE id = ? AND active = 1`, songID).
		Scan(&song.id, &song.filePath, &bitRate)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if bitRate.Valid {
		song.bitRate = int(bitRate.Int64)
	}
	return &song, nil
}

// transcodePrefs loads the caller's transcode preferences. A format the
// codec table doesn't know is dropped (v1 would hand ffmpeg an empty codec;
// v2 treats it as unset instead).
func (s *Service) transcodePrefs(ctx context.Context, userID string) *UserTranscodePrefs {
	var prefs UserTranscodePrefs
	var maxBR sql.NullInt64
	var format sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT max_bitrate_kbps, transcode_format FROM users WHERE id = ?`, userID).
		Scan(&maxBR, &format)
	if err != nil {
		return &prefs
	}
	if maxBR.Valid {
		prefs.MaxBitrateKbps = int(maxBR.Int64)
	}
	if format.Valid {
		if _, known := formatToCodec[format.String]; known {
			prefs.TranscodeFormat = format.String
		}
	}
	return &prefs
}

// Stream answers w with the song's audio. requested/hasRequested carry the
// parsed maxBitRate query preference; download forces the direct,
// Content-Disposition-tagged variant (v1 download.view never transcodes).
// shareToken carries the P6 share-token hook: consulted ONLY when the
// request is anonymous (a session identity wins), authorizing the song when
// it belongs to the token's link-shared playlist — see loadPlayableSong.
// Errors before the first byte (missing/inactive/out-of-scope song,
// anonymous without a valid token) are returned for the route layer to map
// onto the error contract; once bytes are flowing the response is committed
// and failures are logged instead.
//
// Decision order (v1 retrieval.ts parity, productionized per S2 §8):
// liveness + scope (or token grant) → decide → HEAD shortcut → transcode
// with fallback, or direct. Transcode saturation answers 503 + Retry-After
// and direct streams are never capped.
func (s *Service) Stream(w http.ResponseWriter, r *http.Request, id auth.Identity, songID string, requested int, hasRequested bool, download bool, shareToken string) error {
	song, err := s.loadPlayableSong(r.Context(), id, songID, shareToken)
	if err != nil {
		return err
	}

	decision := TranscodeDecision{}
	if !download {
		decision = DecideTranscode(SongInfo{FilePath: song.filePath, BitRate: song.bitRate},
			s.transcodePrefs(r.Context(), id.UserID), requested, hasRequested)
	}

	if decision.ShouldTranscode {
		if r.Method == http.MethodHead {
			// v1 parity: headers only, no ffmpeg spawned.
			HeadHeaders(w, decision.Format)
			return nil
		}
		_, err := s.transcode.Stream(w, r, song.filePath, decision.Format, decision.MaxBitrateKbps)
		if err == nil {
			return nil
		}
		switch {
		case ErrSlotsFull(err):
			w.Header().Set("Retry-After", RetryAfter())
			http.Error(w, "Transcode slots full", http.StatusServiceUnavailable)
		case errors.Is(err, context.Canceled):
			// Client disconnected before/at spawn; nothing more to do.
		default:
			// Spawn/pipe failure BEFORE any body byte (Go surfaces spawn
			// errors synchronously — no v1-B12 race): fall back to direct
			// serving, the client gets the full original file.
			s.log.ErrorContext(r.Context(), "transcode spawn failed, falling back to direct",
				"req", middleware.GetReqID(r.Context()), "file", song.filePath, "err", err.Error())
			s.direct.Stream(w, r, song.filePath, false)
		}
		return nil
	}

	s.direct.Stream(w, r, song.filePath, download)
	return nil
}
