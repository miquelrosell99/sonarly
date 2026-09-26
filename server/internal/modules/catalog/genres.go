package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// GenreRecord is an active genre row plus its resolved path.
type GenreRecord struct {
	ID       string
	Name     string
	ParentID string
	Active   bool
	Path     string
}

// listGenres loads every active genre ordered by name (the old listGenres).
func listGenres(ctx context.Context, q auth.Queries) ([]GenreRecord, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, name, parent_id, active FROM genres WHERE active = 1 ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list genres: %w", err)
	}
	defer rows.Close()
	var genres []GenreRecord
	for rows.Next() {
		var g GenreRecord
		var parentID sql.NullString
		var active int
		if err := rows.Scan(&g.ID, &g.Name, &parentID, &active); err != nil {
			return nil, fmt.Errorf("list genres: %w", err)
		}
		if parentID.Valid {
			g.ParentID = parentID.String
		}
		g.Active = active == 1
		genres = append(genres, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list genres: %w", err)
	}
	return genres, nil
}

// getGenreByID loads a genre regardless of its active flag (the old getGenreById
// for the albums-by-genre route).
func getGenreByID(ctx context.Context, q auth.Queries, id string) (*GenreRecord, error) {
	var g GenreRecord
	var parentID sql.NullString
	var active int
	err := q.QueryRowContext(ctx,
		`SELECT id, name, parent_id, active FROM genres WHERE id = ?`, id).
		Scan(&g.ID, &g.Name, &parentID, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("get genre: %w", err)
	}
	if parentID.Valid {
		g.ParentID = parentID.String
	}
	g.Active = active == 1
	return &g, nil
}

// genreIDsForLibraries returns the genres touched by active songs in the
// given libraries, via both song-level and album-level genre junctions (the old 
// getGenreIdsForLibraries). An empty library list matches nothing.
func genreIDsForLibraries(ctx context.Context, q auth.Queries, libraryIDs []string) (map[string]bool, error) {
	out := make(map[string]bool)
	if len(libraryIDs) == 0 {
		return out, nil
	}
	scopeCond := libraries.ScopeCondition(libraries.Scope{IDs: libraryIDs}, "s.library_id")
	args := append(append([]any{}, scopeCond.Params...), scopeCond.Params...)
	rows, err := q.QueryContext(ctx,
		`SELECT DISTINCT sg.genre_id AS id
		FROM song_genres sg
		JOIN songs s ON s.id = sg.song_id
		WHERE s.active = 1 `+scopeCond.SQL+`
		UNION
		SELECT DISTINCT ag.genre_id AS id
		FROM album_genres ag
		JOIN songs s ON s.album_id = ag.album_id
		WHERE s.active = 1 `+scopeCond.SQL, args...)
	if err != nil {
		return nil, fmt.Errorf("genre ids for libraries: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("genre ids for libraries: %w", err)
		}
		out[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("genre ids for libraries: %w", err)
	}
	return out, nil
}

// genreIDsForLibrary is genreIDsForLibraries for one library (the old 
// getGenreIdsForLibrary), used by the libraryId query filter.
func genreIDsForLibrary(ctx context.Context, q auth.Queries, libraryID string) (map[string]bool, error) {
	return genreIDsForLibraries(ctx, q, []string{libraryID})
}

// buildGenrePaths resolves "Root > ... > Leaf" paths with a cycle guard (the old 
// buildGenrePaths).
func buildGenrePaths(genres []GenreRecord) map[string]string {
	byID := make(map[string]GenreRecord, len(genres))
	for _, g := range genres {
		byID[g.ID] = g
	}
	paths := make(map[string]string, len(genres))
	for _, g := range genres {
		var parts []string
		visited := map[string]bool{g.ID: true}
		for cur := g; ; {
			parts = append([]string{cur.Name}, parts...)
			if cur.ParentID == "" || visited[cur.ParentID] {
				break
			}
			parent, ok := byID[cur.ParentID]
			if !ok {
				break
			}
			visited[parent.ID] = true
			cur = parent
		}
		paths[g.ID] = strings.Join(parts, " > ")
	}
	return paths
}

// buildGenreTree assembles the genre tree and prunes it against the allowed
// set (nil = unrestricted). Pruning mirrors old: a node survives when it is
// itself allowed or keeps at least one surviving child, so an out-of-scope
// parent stays in the tree as a structural carrier for its in-scope
// descendants (e.g. Electronic survives with only Techno allowed, keeping
// Techno nested under it rather than promoting it to a root).
func buildGenreTree(genres []GenreRecord, allowed map[string]bool) []*GenreNode {
	nodes := make(map[string]*GenreNode, len(genres))
	// genres arrives ordered by name from listGenres; wiring children from
	// the slice (not the map) keeps sibling order deterministic.
	for _, g := range genres {
		nodes[g.ID] = &GenreNode{
			ID:       g.ID,
			Name:     g.Name,
			ParentID: g.ParentID,
			Path:     g.Name,
			Active:   g.Active,
			Children: []*GenreNode{},
		}
	}
	var roots []*GenreNode
	for _, g := range genres {
		node := nodes[g.ID]
		if node.ParentID != "" {
			if parent, ok := nodes[node.ParentID]; ok {
				parent.Children = append(parent.Children, node)
				continue
			}
		}
		roots = append(roots, node)
	}

	var setPath func(n *GenreNode, prefix string)
	setPath = func(n *GenreNode, prefix string) {
		if prefix != "" {
			n.Path = prefix + " > " + n.Name
		} else {
			n.Path = n.Name
		}
		for _, child := range n.Children {
			setPath(child, n.Path)
		}
	}

	var prune func(n *GenreNode) bool
	prune = func(n *GenreNode) bool {
		kept := n.Children[:0]
		for _, child := range n.Children {
			if prune(child) {
				kept = append(kept, child)
			}
		}
		n.Children = kept
		return allowed == nil || allowed[n.ID] || len(n.Children) > 0
	}
	if allowed == nil {
		for _, root := range roots {
			setPath(root, "")
		}
		return roots
	}
	keptRoots := roots[:0]
	for _, root := range roots {
		if prune(root) {
			setPath(root, "")
			keptRoots = append(keptRoots, root)
		}
	}
	return keptRoots
}

// genreAlbums returns up to limit random active albums carrying the genre,
// restricted to in-scope (and optionally one-library) active songs (the old 
// getRandomAlbumsByGenre). Albums that would show no songs once explicit
// ones are hidden are dropped.
func genreAlbums(ctx context.Context, q auth.Queries, genreID string, limit int, hideExplicit bool, libraryID string, scope libraries.Scope) ([]Album, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	joinArgs := []any(nil)
	join := `LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1`
	if libraryID != "" || !scope.All {
		join = `JOIN songs s ON s.album_id = a.id AND s.active = 1`
		if libraryID != "" {
			join += ` AND s.library_id = ?`
			joinArgs = append(joinArgs, libraryID)
		}
		join += ` ` + scopeCond.SQL
		joinArgs = append(joinArgs, scopeCond.Params...)
	}
	having := ``
	if hideExplicit {
		having = `HAVING SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) > 0`
	}
	args := append(append(append([]any{}, joinArgs...), genreID), limit)
	rows, err := q.QueryContext(ctx,
		`SELECT `+albumColumns+`
		FROM albums a
		JOIN album_genres ag ON ag.album_id = a.id
		`+join+`
		WHERE a.active = 1 AND ag.genre_id = ?
		GROUP BY a.id
		`+having+`
		ORDER BY RANDOM()
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("genre albums: %w", err)
	}
	defer rows.Close()
	var albums []Album
	for rows.Next() {
		r := &albumRow{}
		if err := rows.Scan(albumDests(r)...); err != nil {
			return nil, fmt.Errorf("genre albums: %w", err)
		}
		albums = append(albums, r.toAlbum())
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("genre albums: %w", err)
	}
	return albums, nil
}
