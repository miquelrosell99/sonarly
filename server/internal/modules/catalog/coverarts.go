package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// CoverArt is the stored blob plus its declared format.
type CoverArt struct {
	Format string
	Data   []byte
}

// getCoverArtByID loads a cover art blob. Reachability is probed by the
// service (IsCoverArtInScope), not folded into this query.
func getCoverArtByID(ctx context.Context, q auth.Queries, id string) (*CoverArt, error) {
	var c CoverArt
	err := q.QueryRowContext(ctx,
		`SELECT format, data FROM cover_arts WHERE id = ?`, id).
		Scan(&c.Format, &c.Data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("get cover art: %w", err)
	}
	return &c, nil
}

// coverArtContentType maps the stored format to a response Content-Type.
// Production rows store MIME types (the old scanner wrote meta.coverArt.format
// verbatim); the extension fallback keeps hand-seeded or legacy rows
// ('jpg', 'png', 'webp', 'gif') serving correctly too.
func coverArtContentType(format string) string {
	if strings.Contains(format, "/") {
		return format
	}
	switch strings.ToLower(format) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	}
	return "application/octet-stream"
}
