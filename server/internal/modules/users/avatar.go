// Avatar upload and serving (P9c): the old features/users/profile-routes.ts
// avatar half ported. Storage is file-based exactly like the retired server — the
// users.avatar_path column names a file under DATA_DIR/avatars — and the
// upload is validated by magic-byte sniffing (jpeg/png/webp/gif), not by
// trusting a mimetype, with the same 2 MiB cap.
package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// maxAvatarBytes mirrors the old 2 MiB cap.
const maxAvatarBytes = 2 * 1024 * 1024

// sniffAvatarFormat identifies jpeg/png/webp/gif by magic bytes (the old 
// ALLOWED_AVATAR_TYPES, content-verified).
func sniffAvatarFormat(data []byte) (ext string, ok bool) {
	switch {
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return ".jpg", true
	case len(data) >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4e && data[3] == 0x47:
		return ".png", true
	case len(data) >= 12 &&
		data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 &&
		data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50:
		return ".webp", true
	case len(data) >= 4 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38:
		return ".gif", true
	}
	return "", false
}

func (s *Service) avatarsDir() string { return filepath.Join(s.dataDir, "avatars") }

// SaveAvatar validates, stores, and records the caller's avatar. The file
// lands at DATA_DIR/avatars/<userId>.<ext>; a previous avatar file with a
// different extension is removed (old profile-routes.ts).
func (s *Service) SaveAvatar(ctx context.Context, userID string, r *http.Request) (*PublicUser, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxAvatarBytes+1))
	if err != nil || len(body) == 0 {
		return nil, ErrNoAvatar
	}
	if len(body) > maxAvatarBytes {
		return nil, ErrAvatarTooLarge
	}
	ext, ok := sniffAvatarFormat(body)
	if !ok {
		return nil, ErrAvatarFormat
	}
	if err := os.MkdirAll(s.avatarsDir(), 0o755); err != nil {
		return nil, err
	}
	existing, err := GetByID(ctx, s.db, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrNotFound
	}

	filename := userID + ext
	if err := os.WriteFile(filepath.Join(s.avatarsDir(), filename), body, 0o644); err != nil {
		return nil, fmt.Errorf("write avatar: %w", err)
	}
	if err := SetAvatarPath(ctx, s.db, userID, &filename); err != nil {
		return nil, err
	}

	if existing.AvatarPath != nil && *existing.AvatarPath != "" && *existing.AvatarPath != filename {
		if err := os.Remove(filepath.Join(s.avatarsDir(), *existing.AvatarPath)); err != nil && !errors.Is(err, os.ErrNotExist) {
			// the retired server ignores cleanup errors.
		}
	}
	return s.GetPublicByID(ctx, userID)
}

// AvatarErrors are the upload validation failures mapped to 400s.
var (
	ErrNoAvatar       = errors.New("No file uploaded")
	ErrAvatarFormat   = errors.New("Invalid image format")
	ErrAvatarTooLarge = errors.New("Avatar must be smaller than 2 MB")
)

// LoadAvatar resolves the user's avatar file for serving: the recorded
// avatar_path must exist on disk (old checks existsSync), else not-found.
func (s *Service) LoadAvatar(ctx context.Context, userID string) (data []byte, contentType string, err error) {
	user, err := GetByID(ctx, s.db, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if user == nil || user.AvatarPath == nil || *user.AvatarPath == "" {
		return nil, "", ErrNotFound
	}
	path := filepath.Join(s.avatarsDir(), *user.AvatarPath)
	data, err = os.ReadFile(path)
	if err != nil {
		return nil, "", ErrNotFound
	}
	switch filepath.Ext(*user.AvatarPath) {
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".png":
		contentType = "image/png"
	case ".webp":
		contentType = "image/webp"
	case ".gif":
		contentType = "image/gif"
	default:
		contentType = "application/octet-stream"
	}
	return data, contentType, nil
}

// avatarErrorStatus maps avatar validation errors to the old 400s.
func avatarErrorStatus(err error) int {
	switch {
	case errors.Is(err, ErrNoAvatar),
		errors.Is(err, ErrAvatarFormat),
		errors.Is(err, ErrAvatarTooLarge):
		return http.StatusBadRequest
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}
