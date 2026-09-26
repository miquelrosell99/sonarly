// Media settings routes (P9c): v1's features/settings/routes.ts — GET/PATCH
// /api/settings/media over the settings table keys the ingest pipeline
// already owns (organize_pattern, duplicate_strategy,
// review_retention_days). Admin-gated like v1.
package ingest

import (
	"encoding/json"
	"net/http"
	"strings"

	"strconv"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
)

// patternTemplates is v1's templates list (settings/routes.ts), returned
// verbatim so the settings UI can offer presets.
var patternTemplates = []map[string]string{
	{"label": "Album Artist / (Year) Album / Disc Number Track Number - Title", "value": "{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}"},
	{"label": "Artist / Album / Track - Title", "value": "{artist}/{album}/{track:00} - {title}"},
	{"label": "Artist / Album / Track - Title (no zero pad)", "value": "{artist}/{album}/{track} - {title}"},
	{"label": "Album Artist / Album / Track - Title", "value": "{albumArtist}/{album}/{track:00} - {title}"},
	{"label": "Artist / Year - Album / Track - Title", "value": "{artist}/{year} - {album}/{track:00} - {title}"},
	{"label": "Artist / Title", "value": "{artist}/{title}"},
}

// MediaSettings is the GET/PATCH response body (v1 shape).
type MediaSettings struct {
	OrganizePattern     string              `json:"organizePattern"`
	DuplicateStrategy   string              `json:"duplicateStrategy"`
	ReviewRetentionDays int                 `json:"reviewRetentionDays"`
	Templates           []map[string]string `json:"templates,omitempty"`
}

// currentMediaSettings reads the three settings through the service's
// readers (which carry the v1 defaults and clamps).
func (s *Service) currentMediaSettings(r *http.Request) MediaSettings {
	ctx := r.Context()
	strategy := s.settingsDuplicateStrategy(ctx)
	if strategy == "" {
		strategy = duplicateStrategyDefault
	}
	return MediaSettings{
		OrganizePattern:     s.globalOrganizePattern(ctx),
		DuplicateStrategy:   string(strategy),
		ReviewRetentionDays: s.reviewRetentionDays(ctx),
	}
}

// mediaSettings are served by the ingest handler: GET /api/settings/media
// and PATCH /api/settings/media on the admin sub-router.

func (h *Handler) getMediaSettings(w http.ResponseWriter, r *http.Request) {
	settings := h.svc.currentMediaSettings(r)
	settings.Templates = patternTemplates
	httpserver.JSON(w, http.StatusOK, settings)
}

func (h *Handler) patchMediaSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OrganizePattern     *string `json:"organizePattern"`
		DuplicateStrategy   *string `json:"duplicateStrategy"`
		ReviewRetentionDays *int    `json:"reviewRetentionDays"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	ctx := r.Context()

	if body.OrganizePattern != nil {
		if message := validatePattern(*body.OrganizePattern); message != "" {
			httpserver.Error(w, http.StatusBadRequest, message)
			return
		}
		if err := h.svc.setSetting(ctx, settingOrganizePattern, *body.OrganizePattern); err != nil {
			httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
	}
	if body.DuplicateStrategy != nil {
		if !IsStrategy(*body.DuplicateStrategy) {
			httpserver.Error(w, http.StatusBadRequest, "Invalid duplicate strategy")
			return
		}
		if err := h.svc.setSetting(ctx, settingDuplicateStrategy, *body.DuplicateStrategy); err != nil {
			httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
	}
	if body.ReviewRetentionDays != nil {
		days := *body.ReviewRetentionDays
		if days < reviewRetentionMin || days > reviewRetentionMax {
			httpserver.Error(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		if err := h.svc.setSetting(ctx, settingReviewRetention, strconv.Itoa(days)); err != nil {
			httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
	}

	httpserver.JSON(w, http.StatusOK, h.svc.currentMediaSettings(r))
}

// validatePattern is v1's validatePattern: relative paths only, no '..'
// segments, no NUL bytes.
func validatePattern(pattern string) string {
	if strings.HasPrefix(pattern, "/") {
		return "Pattern must be relative"
	}
	for _, segment := range strings.Split(pattern, "/") {
		if segment == ".." || strings.ContainsRune(segment, '\x00') {
			return "Pattern contains invalid path segments"
		}
	}
	return ""
}
