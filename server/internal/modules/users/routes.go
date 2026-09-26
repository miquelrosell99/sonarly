package users

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the users service to HTTP. The route layer owns cookie I/O
// and status-code mapping; the service stays transport-agnostic.
type Handler struct {
	svc    *Service
	store  *auth.Store
	mw     *auth.Middleware
	secret string
	secure bool
}

func NewHandler(svc *Service, store *auth.Store, mw *auth.Middleware, sessionSecret string, secureCookie bool) *Handler {
	return &Handler{svc: svc, store: store, mw: mw, secret: sessionSecret, secure: secureCookie}
}

// Routes registers the users endpoints on r.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/api/login", h.login)
	r.Post("/api/logout", h.logout)
	r.Get("/api/setup", h.setupStatus)
	r.Post("/api/setup", h.setup)

	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/me", h.me)
		r.Get("/api/me/preferences", h.getPreferences)
		r.Patch("/api/me/preferences", h.patchPreferences)
		r.Post("/api/me/avatar", h.uploadAvatar)

		r.Route("/api/admin/users", func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Get("/", h.adminList)
			r.Post("/", h.adminCreate)
			r.Put("/{id}", h.adminUpdate)
			r.Delete("/{id}", h.adminDelete)
		})
	})

	// Avatars are publicly reachable: an avatar is rendered by <img> tags,
	// which carry no API-key header and may lack the session cookie (v1
	// parity — GET serves the file when one exists, 404 otherwise).
	r.Get("/api/avatars/{id}", h.avatar)
}

// errStatus maps service sentinel errors to the v1 HTTP contract.
func errStatus(err error) int {
	switch {
	case errors.Is(err, ErrInvalidCredentials):
		return http.StatusUnauthorized
	case errors.Is(err, ErrSetupCompleted):
		return http.StatusForbidden
	case errors.Is(err, ErrUsernameTaken),
		errors.Is(err, ErrLastAdminDemote),
		errors.Is(err, ErrLastAdminDelete),
		errors.Is(err, ErrSelfDelete):
		return http.StatusConflict
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	default: // validation errors
		return http.StatusBadRequest
	}
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	status := errStatus(err)
	if status >= http.StatusInternalServerError {
		slog.ErrorContext(r.Context(), "users service error", "err", err)
		httpserver.Error(w, status, "Internal Server Error")
		return
	}
	httpserver.Error(w, status, err.Error())
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return false
	}
	return true
}

// currentSID returns the verified sid from the request's session cookie, or
// "" when there is none.
func (h *Handler) currentSID(r *http.Request) string {
	cookie, err := r.Cookie(auth.CookieName)
	if err != nil {
		return ""
	}
	sid, ok := auth.VerifySignedValue(h.secret, cookie.Value)
	if !ok {
		return ""
	}
	return sid
}

// startSession regenerates the session id (fixation protection, v1's
// session.regenerate()): the old session row is destroyed, a fresh sid is
// issued, and only then is the new cookie written.
func (h *Handler) startSession(w http.ResponseWriter, r *http.Request, user auth.Session) error {
	ctx := r.Context()
	if old := h.currentSID(r); old != "" {
		if err := h.store.Delete(ctx, old); err != nil {
			return err
		}
	}
	sid := auth.NewSID()
	if err := h.store.Create(ctx, sid, user); err != nil {
		return err
	}
	auth.WriteSessionCookie(w, h.secret, h.secure, sid)
	return nil
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if h.svc.LoginLocked(r.RemoteAddr, body.Username) {
		httpserver.Error(w, http.StatusTooManyRequests, "Too many failed login attempts. Try again later.")
		return
	}
	user, err := h.svc.Login(r.Context(), body.Username, body.Password)
	if err != nil {
		h.svc.RecordLoginFailure(r.RemoteAddr, body.Username)
		writeServiceError(w, r, err)
		return
	}
	h.svc.RecordLoginSuccess(r.RemoteAddr, body.Username)
	if err := h.startSession(w, r, auth.Session{
		UserID: user.ID, Username: user.Username, IsAdmin: user.IsAdmin,
	}); err != nil {
		slog.ErrorContext(r.Context(), "create session", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	// v1 exempted logout from auth: it always answers {ok:true} and destroys
	// whatever session the client presented, if any.
	if sid := h.currentSID(r); sid != "" {
		if err := h.store.Delete(r.Context(), sid); err != nil {
			slog.ErrorContext(r.Context(), "delete session", "err", err)
		}
	}
	auth.ClearSessionCookie(w, h.secure)
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	user, err := h.svc.GetPublicByID(r.Context(), id.UserID)
	if err != nil {
		// Session outlived the user (deleted account): same answer as no
		// session, per v1.
		if errors.Is(err, ErrNotFound) {
			httpserver.Error(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"user": user})
}

// getPreferences is GET /api/me/preferences: the merged defaults+stored
// document (v1 parity — absent row and corrupt blobs both yield defaults).
func (h *Handler) getPreferences(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	preferences, err := h.svc.GetPreferences(r.Context(), id.UserID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"preferences": preferences})
}

// patchPreferences is PATCH /api/me/preferences. The body must be a JSON
// object whose keys are all in the explicit allowlist (Q8 mass-assignment
// fix — unknown keys are rejected, not silently dropped or stored).
func (h *Handler) patchPreferences(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	id, _ := auth.IdentityFrom(r.Context())
	preferences, err := h.svc.UpdatePreferences(r.Context(), id.UserID, body)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"preferences": preferences})
}

// avatar is GET /api/avatars/{id}: serves the user's avatar file when one
// exists, else 404. Publicly reachable like v1 (avatars render in <img>
// tags); a day of public caching matches v1.
func (h *Handler) avatar(w http.ResponseWriter, r *http.Request) {
	data, contentType, err := h.svc.LoadAvatar(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		if avatarErrorStatus(err) == http.StatusNotFound {
			httpserver.Error(w, http.StatusNotFound, "Not found")
			return
		}
		slog.ErrorContext(r.Context(), "load avatar", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// uploadAvatar is POST /api/me/avatar: magic-byte-validated, size-capped,
// stored under DATA_DIR/avatars and recorded on the user row (v1
// profile-routes.ts). Answers the refreshed public user, like v1.
func (h *Handler) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	user, err := h.svc.SaveAvatar(r.Context(), id.UserID, r)
	if err != nil {
		status := avatarErrorStatus(err)
		if status >= http.StatusInternalServerError {
			slog.ErrorContext(r.Context(), "save avatar", "err", err)
			httpserver.Error(w, status, "Internal Server Error")
			return
		}
		httpserver.Error(w, status, err.Error())
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *Handler) setupStatus(w http.ResponseWriter, r *http.Request) {
	needed, err := h.svc.SetupNeeded(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"needsSetup": needed})
}

func (h *Handler) setup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Surname  string `json:"surname"`
		Email    string `json:"email"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user, err := h.svc.Setup(r.Context(), SetupInput{
		Username: body.Username, Password: body.Password,
		Name: body.Name, Surname: body.Surname, Email: body.Email,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	if err := h.startSession(w, r, auth.Session{
		UserID: user.ID, Username: user.Username, IsAdmin: true,
	}); err != nil {
		slog.ErrorContext(r.Context(), "create session", "err", err)
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (h *Handler) adminList(w http.ResponseWriter, r *http.Request) {
	users, err := h.svc.ListPublic(r.Context())
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"users": users})
}

func (h *Handler) adminCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username        string  `json:"username"`
		Password        string  `json:"password"`
		IsAdmin         bool    `json:"isAdmin"`
		Name            string  `json:"name"`
		Surname         string  `json:"surname"`
		Email           string  `json:"email"`
		MaxBitrateKbps  *int    `json:"maxBitrateKbps"`
		TranscodeFormat *string `json:"transcodeFormat"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err := h.svc.CreateUser(r.Context(), CreateInput{
		Username: body.Username, Password: body.Password, IsAdmin: body.IsAdmin,
		Name: body.Name, Surname: body.Surname, Email: body.Email,
		MaxBitrateKbps: body.MaxBitrateKbps, TranscodeFormat: body.TranscodeFormat,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusCreated, map[string]any{"ok": true})
}

func (h *Handler) adminUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in AdminUpdateInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := h.svc.UpdateUser(r.Context(), id, in); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) adminDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actor, _ := auth.IdentityFrom(r.Context())
	if err := h.svc.DeleteUser(r.Context(), actor.UserID, id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
