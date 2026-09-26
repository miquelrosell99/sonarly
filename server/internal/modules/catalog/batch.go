package catalog

import (
	"context"
	"fmt"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// idChunkSize bounds the bind variables per IN query. SQLite caps host
// parameters per statement; chunking keeps the batch loaders correct for
// arbitrarily large lists while still issuing exactly one query per chunk
// (v1's anti-N+1 batch pattern, made safe for big libraries).
const idChunkSize = 400

func chunkIDs(ids []string) [][]string {
	if len(ids) == 0 {
		return nil
	}
	chunks := make([][]string, 0, (len(ids)+idChunkSize-1)/idChunkSize)
	for len(ids) > 0 {
		n := min(idChunkSize, len(ids))
		chunks = append(chunks, ids[:n])
		ids = ids[n:]
	}
	return chunks
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func stringArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// songIDs returns the ids of a song slice in order.
func songIDs(songs []Song) []string {
	ids := make([]string, len(songs))
	for i := range songs {
		ids[i] = songs[i].ID
	}
	return ids
}

func albumIDs(albums []Album) []string {
	ids := make([]string, len(albums))
	for i := range albums {
		ids[i] = albums[i].ID
	}
	return ids
}

// entriesForMany loads {id, name} entries grouped by an owner id, issuing
// one chunked IN query — v1's getSongArtistEntriesForMany pattern. joinSQL
// is a fixed internal fragment naming the junction alias j and the entry
// alias e and ending at the owner predicate, e.g.
//
//	"FROM song_artists j JOIN artists e ON e.id = j.artist_id WHERE j.song_id"
//
// The helper appends the operator and placeholders (" IN (?, ...)" or
// " = ?") and the deterministic ORDER BY; ownerCol is the junction column
// selected for grouping ("song_id").
func entriesForMany(ctx context.Context, q auth.Queries, ownerCol, joinSQL string, ids []string) (map[string][]Entry, error) {
	out := make(map[string][]Entry)
	for _, chunk := range chunkIDs(ids) {
		rows, err := q.QueryContext(ctx,
			`SELECT j.`+ownerCol+`, e.id, e.name `+joinSQL+
				` IN (`+placeholders(len(chunk))+`) ORDER BY j.`+ownerCol+`, j.position`,
			stringArgs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("batch-load %s entries: %w", ownerCol, err)
		}
		for rows.Next() {
			var owner, id, name string
			if err := rows.Scan(&owner, &id, &name); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch-load %s entries: %w", ownerCol, err)
			}
			out[owner] = append(out[owner], Entry{ID: id, Name: name})
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch-load %s entries: %w", ownerCol, err)
		}
		rows.Close()
	}
	return out, nil
}

// namesForMany loads entry name lists grouped by an owner id — v1's
// getSongGenreNamesForMany pattern. joinSQL matches entriesForMany.
func namesForMany(ctx context.Context, q auth.Queries, ownerCol, joinSQL string, ids []string) (map[string][]string, error) {
	out := make(map[string][]string)
	for _, chunk := range chunkIDs(ids) {
		rows, err := q.QueryContext(ctx,
			`SELECT j.`+ownerCol+`, e.name `+joinSQL+
				` IN (`+placeholders(len(chunk))+`) ORDER BY j.`+ownerCol+`, j.position`,
			stringArgs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("batch-load %s names: %w", ownerCol, err)
		}
		for rows.Next() {
			var owner, name string
			if err := rows.Scan(&owner, &name); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch-load %s names: %w", ownerCol, err)
			}
			out[owner] = append(out[owner], name)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch-load %s names: %w", ownerCol, err)
		}
		rows.Close()
	}
	return out, nil
}
