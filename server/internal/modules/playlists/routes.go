package playlists

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the playlists service to HTTP. Route handlers parse and
// validate; the service enforces the access policy through Resolve; the
// route layer maps sentinel errors onto the Go server error contract
// ({"error": "..."}). Every route is behind RequireAuth — anonymous
// share-token consumption happens through the streaming endpoint (P5) and,
// in P9, the OpenSubsonic adapter, both of which consult the same policy.
type Handler struct {
	svc *Service
	mw  *auth.Middleware
}

func NewHandler(svc *Service, mw *auth.Middleware) *Handler {
	return &Handler{svc: svc, mw: mw}
}

// Routes registers the playlist endpoints behind session auth. The detail
// GET exempts requests carrying a shareToken from the session requirement
// (the old public-route list, docs/api.md): the service's policy is the one
// access gate — a wrong token still answers the service's 404, and
// anonymous callers without any token are rejected here exactly like the old 
// session preHandler rejected them.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/playlists", h.list)
		r.Post("/api/playlists", h.create)
		r.Put("/api/playlists/{id}", h.update)
		r.Delete("/api/playlists/{id}", h.delete)
		r.Post("/api/playlists/{id}/share", h.share)
		r.Delete("/api/playlists/{id}/share/{userId}", h.unshare)
		r.Post("/api/playlists/{id}/share-link", h.createShareLink)
		r.Delete("/api/playlists/{id}/share-link", h.deleteShareLink)
	})
	r.With(h.shareTokenOrAuth).Get("/api/playlists/{id}", h.get)
}

// shareTokenOrAuth runs the session parser always, but enforces a logged-in
// caller only when no shareToken is present (mirrors the old exemption of
// GET /api/playlists/:id?shareToken=... from the session gate).
func (h *Handler) shareTokenOrAuth(next http.Handler) http.Handler {
	return h.mw.AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("shareToken") != "" {
			next.ServeHTTP(w, r)
			return
		}
		auth.RequireAuth(next).ServeHTTP(w, r)
	}))
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpserver.Error(w, http.StatusNotFound, "Not found")
	case errors.Is(err, ErrForbidden):
		httpserver.Error(w, http.StatusForbidden, "Forbidden")
	case IsRulesError(err):
		httpserver.Error(w, http.StatusBadRequest, err.Error())
	default:
		slog.ErrorContext(r.Context(), "playlists service error", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
	}
}

func identity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.List(r.Context(), identity(r))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if items == nil {
		items = []ListItem{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"playlists": items})
}

// createBody mirrors the POST body; presence of Rules makes the playlist
// smart (the old explicit isSmart flag folded into the rules presence).
type createBody struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Visibility  string          `json:"visibility"`
	SongIDs     []string        `json:"songIds"`
	Rules       json.RawMessage `json:"rules"`
	ResolveMode string          `json:"resolveMode"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var body createBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	rules, err := ParseRules(body.Rules)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	detail, err := h.svc.Create(r.Context(), identity(r), Input{
		Name:        body.Name,
		Description: body.Description,
		Visibility:  body.Visibility,
		SongIDs:     body.SongIDs,
		Rules:       rules,
		ResolveMode: body.ResolveMode,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusCreated, map[string]any{"playlist": detail})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	detail, err := h.svc.Get(r.Context(), identity(r), chi.URLParam(r, "id"),
		r.URL.Query().Get("shareToken"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"playlist": detail})
}

// updateBody mirrors the PUT body; every field is optional.
type updateBody struct {
	Name        *string          `json:"name"`
	Description *string          `json:"description"`
	Visibility  *string          `json:"visibility"`
	SongIDs     *[]string        `json:"songIds"`
	IsSmart     *bool            `json:"isSmart"`
	Rules       *json.RawMessage `json:"rules"`
	ResolveMode *string          `json:"resolveMode"`
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	var body updateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	var rules *Rules
	if body.Rules != nil {
		parsed, err := ParseRules(*body.Rules)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		rules = parsed
	}
	detail, err := h.svc.Update(r.Context(), identity(r), chi.URLParam(r, "id"), UpdateInput{
		Name:        body.Name,
		Description: body.Description,
		Visibility:  body.Visibility,
		SongIDs:     body.SongIDs,
		IsSmart:     body.IsSmart,
		Rules:       rules,
		ResolveMode: body.ResolveMode,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"playlist": detail})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), identity(r), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

type shareBody struct {
	UserID  string `json:"userId"`
	CanEdit bool   `json:"canEdit"`
}

func (h *Handler) share(w http.ResponseWriter, r *http.Request) {
	var body shareBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.UserID == "" {
		httpserver.Error(w, http.StatusBadRequest, "userId is required")
		return
	}
	if err := h.svc.Share(r.Context(), identity(r), chi.URLParam(r, "id"), body.UserID, body.CanEdit); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) unshare(w http.ResponseWriter, r *http.Request) {
	err := h.svc.Unshare(r.Context(), identity(r), chi.URLParam(r, "id"), chi.URLParam(r, "userId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) createShareLink(w http.ResponseWriter, r *http.Request) {
	token, err := h.svc.CreateShareLink(r.Context(), identity(r), chi.URLParam(r, "id"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"shareToken": token})
}

func (h *Handler) deleteShareLink(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteShareLink(r.Context(), identity(r), chi.URLParam(r, "id")); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
