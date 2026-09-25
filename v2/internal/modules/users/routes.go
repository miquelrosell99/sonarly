package users

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
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

		r.Route("/api/admin/users", func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Get("/", h.adminList)
			r.Post("/", h.adminCreate)
			r.Put("/{id}", h.adminUpdate)
			r.Delete("/{id}", h.adminDelete)
		})
	})
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
