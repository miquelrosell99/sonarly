package tags

// PUT /api/songs/{id}/lyrics (admin): the lyrics write path, ported from the
// old features/songs/lyrics-routes.ts. Plain and synced lyrics ride the wire
// as nullable strings — syncedLyrics in LRC text form — and land in TWO
// places: the audio file, through the same TagWriter the tag-edit route
// uses, and the songs row, updated directly (the Go server keeps the row as
// the read source of truth instead of queueing a resync round trip; lyrics
// never change the organize pattern, so there is no reorganization either).

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
)

// optionalLyric is one validated lyrics field: Set marks the key as present,
// Value nil with Set is an explicit null (clear the stored value).
type optionalLyric struct {
	Set   bool
	Value *string
}

// LyricsInput is the validated PUT /songs/{id}/lyrics payload. Absent keys
// leave file and row untouched; a string sets; explicit null clears the row.
type LyricsInput struct {
	Lyrics       optionalLyric
	SyncedLyrics optionalLyric
}

// empty reports a body with neither key — nothing to write, answer ok.
func (in *LyricsInput) empty() bool {
	return !in.Lyrics.Set && !in.SyncedLyrics.Set
}

// validateLyrics parses the body with the tags module's manual-validation
// style: strict allowlist, string-or-null per key (Q8 mass-assignment
// discipline).
func validateLyrics(body map[string]any) (*LyricsInput, error) {
	allowed := map[string]bool{"lyrics": true, "syncedLyrics": true}
	for key := range body {
		if !allowed[key] {
			return nil, &ErrValidation{Message: "Unknown lyrics field: " + key}
		}
	}
	in := &LyricsInput{}
	var err error
	if in.Lyrics, err = lyricField(body, "lyrics"); err != nil {
		return nil, err
	}
	if in.SyncedLyrics, err = lyricField(body, "syncedLyrics"); err != nil {
		return nil, err
	}
	return in, nil
}

func lyricField(body map[string]any, key string) (optionalLyric, error) {
	raw, present := body[key]
	if !present {
		return optionalLyric{}, nil
	}
	if raw == nil {
		return optionalLyric{Set: true}, nil
	}
	s, ok := raw.(string)
	if !ok {
		return optionalLyric{}, &ErrValidation{Message: key + " must be a string or null"}
	}
	return optionalLyric{Set: true, Value: &s}, nil
}

// applySongLyrics writes the lyrics tags into the file (when there is
// anything writable — the mutagen writer cannot clear a tag, so empty
// values only reach the row) and updates the songs row in place.
func (s *Service) applySongLyrics(ctx context.Context, id string, in *LyricsInput) error {
	if in.empty() {
		return nil
	}
	song, err := s.loadSong(ctx, id)
	if err != nil {
		return err
	}
	if song == nil {
		return &stageError{status: 404, message: "Song not found"}
	}

	fileTags := audio.SongTags{}
	if in.Lyrics.Set && in.Lyrics.Value != nil && *in.Lyrics.Value != "" {
		fileTags.Lyrics = in.Lyrics.Value
	}
	if in.SyncedLyrics.Set && in.SyncedLyrics.Value != nil && *in.SyncedLyrics.Value != "" {
		fileTags.SyncedLyrics = audio.ParseLRC(*in.SyncedLyrics.Value)
	}
	if fileTags.Lyrics != nil || fileTags.SyncedLyrics != nil {
		if err := s.writer.Write(ctx, song.filePath, fileTags); err != nil {
			return &stageError{status: 500, message: "Failed to write tags"}
		}
	}

	sets, args := make([]string, 0, 2), make([]any, 0, 2)
	if in.Lyrics.Set {
		sets = append(sets, "lyrics = ?")
		var v any
		if in.Lyrics.Value != nil {
			v = *in.Lyrics.Value
		}
		args = append(args, v)
	}
	if in.SyncedLyrics.Set {
		sets = append(sets, "synced_lyrics = ?")
		var v any
		if in.SyncedLyrics.Value != nil {
			v = *in.SyncedLyrics.Value
		}
		args = append(args, v)
	}
	args = append(args, id)
	res, err := s.db.ExecContext(ctx,
		`UPDATE songs SET `+joinLyricSets(sets)+` WHERE id = ?`, args...)
	if err != nil {
		return &stageError{status: 500, message: "Lyrics saved to the file but the database update failed"}
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return &stageError{status: 404, message: "Song not found"}
	}
	return nil
}

func joinLyricSets(sets []string) string {
	out := sets[0]
	for _, s := range sets[1:] {
		out += ", " + s
	}
	return out
}

// putSongLyrics is PUT /api/songs/{id}/lyrics (admin).
func (h *Handler) putSongLyrics(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSONBody(w, r, &body); err != nil {
		return
	}
	in, err := validateLyrics(body)
	if err != nil {
		var validation *ErrValidation
		if errors.As(err, &validation) {
			httpserver.Error(w, http.StatusBadRequest, validation.Message)
			return
		}
		httpserver.Error(w, http.StatusBadRequest, "Invalid lyrics")
		return
	}
	if err := h.svc.applySongLyrics(r.Context(), chi.URLParam(r, "id"), in); err != nil {
		writeStageError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
