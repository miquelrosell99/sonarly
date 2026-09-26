// Library admin routes (P9c): v1's features/libraries/admin-routes.ts —
// the library CRUD, both directions of the user_libraries assignment
// endpoints, and the scoped picker list. v1's restartWatcher callback is
// unnecessary in v2: the filesystem watcher re-reads the libraries table
// every poll cycle, so a created or renamed library is picked up without a
// nudge.
package libraries

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Handler wires the library admin endpoints to HTTP.
type Handler struct {
	db *sql.DB
	mw *auth.Middleware
}

// NewHandler constructs the admin route handler.
func NewHandler(db *sql.DB, mw *auth.Middleware) *Handler {
	return &Handler{db: db, mw: mw}
}

// Routes registers the library endpoints. The picker list needs any
// session (v1 mounted it behind the shared session middleware; a missing
// session yields an empty scope, i.e. an empty list, never host paths).
// Everything under /api/admin is admin-gated.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth)
		r.Get("/api/libraries", h.pickerList)

		r.Route("/api/admin/libraries", func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Get("/", h.list)
			r.Post("/", h.create)
			r.Put("/{id}", h.update)
			r.Delete("/{id}", h.delete)
			r.Get("/{id}/users", h.libraryUsers)
			r.Post("/{id}/users", h.assignUsers)
			r.Delete("/{id}/users/{userId}", h.removeUser)
		})

		r.Route("/api/admin/users/{id}/libraries", func(r chi.Router) {
			r.Use(h.mw.RequireAdmin)
			r.Get("/", h.userLibraries)
			r.Post("/", h.assignLibraries)
			r.Delete("/{libraryId}", h.removeLibrary)
		})
	})
}

// pickerList is GET /api/libraries: the scope-trimmed picker DTO (v1 parity,
// including the B8 fix — the route is auth+scoped, never exposing paths or
// patterns).
func (h *Handler) pickerList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, _ := auth.IdentityFrom(ctx)
	scope, err := GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	libs, err := List(ctx, h.db)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	out := []LibraryPicker{}
	if scope.All {
		for _, lib := range libs {
			out = append(out, LibraryPicker{ID: lib.ID, Name: lib.Name, IsDefault: lib.IsDefault})
		}
	} else {
		// v1 order: the scope's assignment order, not the libraries table order.
		byID := make(map[string]Library, len(libs))
		for _, lib := range libs {
			byID[lib.ID] = lib
		}
		for _, assigned := range scope.IDs {
			if lib, ok := byID[assigned]; ok {
				out = append(out, LibraryPicker{ID: lib.ID, Name: lib.Name, IsDefault: lib.IsDefault})
			}
		}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"libraries": out})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	libs, err := List(r.Context(), h.db)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if libs == nil {
		libs = []Library{}
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"libraries": libs})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name            string `json:"name"`
		Path            string `json:"path"`
		OrganizePattern string `json:"organizePattern"`
		IsDefault       *bool  `json:"isDefault"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.Name == "" || body.Path == "" {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	pattern := body.OrganizePattern
	if pattern == "" {
		pattern = h.defaultOrganizePattern(r)
	}
	isDefault := body.IsDefault != nil && *body.IsDefault
	_, err := Create(r.Context(), h.db, CreateInput{
		Name: body.Name, Path: body.Path, OrganizePattern: pattern, IsDefault: isDefault,
	})
	if err != nil {
		if IsUniqueViolation(err) {
			httpserver.Error(w, http.StatusConflict, "Library path already exists")
			return
		}
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusCreated, map[string]any{"ok": true})
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if existing, _ := GetByID(r.Context(), h.db, id); existing == nil {
		httpserver.Error(w, http.StatusNotFound, "Library not found")
		return
	}
	var body struct {
		Name            *string `json:"name"`
		Path            *string `json:"path"`
		OrganizePattern *string `json:"organizePattern"`
		IsDefault       *bool   `json:"isDefault"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.Name != nil && *body.Name == "" {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.Path != nil && *body.Path == "" {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.OrganizePattern != nil && *body.OrganizePattern == "" {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	_, err := Update(r.Context(), h.db, id, UpdateInput{
		Name: body.Name, Path: body.Path, OrganizePattern: body.OrganizePattern, IsDefault: body.IsDefault,
	})
	if err != nil {
		if IsUniqueViolation(err) {
			httpserver.Error(w, http.StatusConflict, "Library path already exists")
			return
		}
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	deleted, err := Delete(r.Context(), h.db, id)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if !deleted {
		httpserver.Error(w, http.StatusNotFound, "Library not found")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// libraryUsers is GET /api/admin/libraries/{id}/users (v1 shape: a bare
// string array).
func (h *Handler) libraryUsers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if existing, _ := GetByID(r.Context(), h.db, id); existing == nil {
		httpserver.Error(w, http.StatusNotFound, "Library not found")
		return
	}
	users, err := AssignedUserIDs(r.Context(), h.db, id)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"users": users})
}

func (h *Handler) assignUsers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if existing, _ := GetByID(r.Context(), h.db, id); existing == nil {
		httpserver.Error(w, http.StatusNotFound, "Library not found")
		return
	}
	var body struct {
		UserIDs []string `json:"userIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserIDs == nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if err := AssignUsers(r.Context(), h.db, id, body.UserIDs); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) removeUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if existing, _ := GetByID(r.Context(), h.db, id); existing == nil {
		httpserver.Error(w, http.StatusNotFound, "Library not found")
		return
	}
	if err := RemoveUser(r.Context(), h.db, id, chi.URLParam(r, "userId")); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// userLibraries is GET /api/admin/users/{id}/libraries (v1 shape: a bare
// string array).
func (h *Handler) userLibraries(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !h.userExists(r, id) {
		httpserver.Error(w, http.StatusNotFound, "User not found")
		return
	}
	libraryIDs, err := UserLibraryIDs(r.Context(), h.db, id)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"libraries": libraryIDs})
}

func (h *Handler) assignLibraries(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !h.userExists(r, id) {
		httpserver.Error(w, http.StatusNotFound, "User not found")
		return
	}
	var body struct {
		LibraryIDs []string `json:"libraryIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.LibraryIDs == nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if err := AssignToUser(r.Context(), h.db, id, body.LibraryIDs); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) removeLibrary(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !h.userExists(r, id) {
		httpserver.Error(w, http.StatusNotFound, "User not found")
		return
	}
	if err := RemoveFromUser(r.Context(), h.db, id, chi.URLParam(r, "libraryId")); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) userExists(r *http.Request, id string) bool {
	var one int
	err := h.db.QueryRowContext(r.Context(), `SELECT 1 FROM users WHERE id = ?`, id).Scan(&one)
	return err == nil
}

// defaultOrganizePattern resolves the fallback for a create without a
// pattern: the global settings key, else the v1 constant (v1
// getDefaultOrganizePattern).
func (h *Handler) defaultOrganizePattern(r *http.Request) string {
	var value string
	_ = h.db.QueryRowContext(r.Context(),
		`SELECT value FROM settings WHERE key = 'organize_pattern'`).Scan(&value)
	if value == "" {
		return DefaultOrganizePattern
	}
	return value
}
