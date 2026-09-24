# Smart Playlists (Smart Filters)

Smart playlists are playlists defined by a set of rules instead of a manual track list. The server compiles the rules into SQL and resolves the matching songs at request time, so the track list updates automatically as the library changes.

## Data model

A smart playlist is a row in `playlists` with `is_smart = 1`. The rules are stored as JSON in `rules_json` (migration `012_smart_playlists.sql`) and typed in `@sonarly/shared` as `SmartPlaylistRules`:

```ts
interface SmartPlaylistRules {
  rules?: {
    all?: SmartPlaylistRule[];   // AND-ed together
    any?: SmartPlaylistRule[];   // OR-ed together
  };
  sort?: SmartPlaylistSort[];    // ordered sort clauses, or { random: true }
  limit?: number;                // hard cap on resolved tracks
  limitPercent?: number;         // cap as a percentage of the matched count
}

interface SmartPlaylistRule {
  field: string;
  operator: SmartPlaylistOperator;
  value?: string | number | boolean | string[] | number[];
}
```

`all` and `any` groups are each parenthesized and combined with `AND`, so a ruleset like "genre is Jazz **and** (rating ≥ 4 **or** loved)" is expressed as `all: [genre…]` plus `any: [rating…, loved…]`. An empty ruleset resolves to every active song (`1=1`).

## Fields

The canonical field list is `SMART_PLAYLIST_FIELDS` in `packages/shared/src/smart-playlist.ts` — the UI rule editor and the API both derive from it, so adding a field there is enough to surface it in the editor.

| Field | Type | SQL source | User-scoped | Notes |
|---|---|---|---|---|
| `title` | string | `songs.title` | | |
| `album` | string | `albums.name` | | requires albums join |
| `artist` | string | `artists.name` | | |
| `albumArtist` | string | album artist name | | requires albums + albumArtist joins |
| `genre` | string | `genres.name` | | |
| `releaseType` | string | `albums.release_type` | | album, EP, single, soundtrack, … (renamed from `albumType` in migration 049) |
| `year` | number | `songs.year` | | |
| `duration` | number | `songs.duration` (seconds) | | |
| `bitDepth` | number | `songs.bits_per_sample` | | |
| `loved` | boolean | `user_songs.starred` | yes | |
| `rating` | number | `user_songs.rating` | yes | supports half ratings |
| `playcount` | number | `user_songs.play_count` | yes | |
| `lastplayed` | date | `user_songs.last_played` | yes | |

**User-scoped fields** (`loved`, `rating`, `playcount`, `lastplayed`) live in `user_songs` and are resolved against a specific user — see [Resolve modes](#resolve-modes) below. All other fields are library facts.

String comparisons are case-insensitive (`COLLATE NOCASE`).

## Operators

The editor offers operators per field type (`SmartPlaylistBlockEditor.tsx`); the compiler (`features/smart-playlists/compiler.ts`) implements the semantics:

| Type | Operators |
|---|---|
| string | `is`, `isNot`, `contains`, `notContains`, `startsWith`, `endsWith` |
| number | `is`, `isNot`, `gt`, `gte`, `lt`, `lte`, `inTheRange` (value is `[min, max]`) |
| date | `is`, `isNot`, `after`, `before`, `inTheLast`, `notInTheLast` (value is a day count) |
| boolean | `is`, `isNot` |
| any | `isMissing`, `isPresent`, `inPlaylist`, `notInPlaylist` |

Semantics worth knowing:

- `notContains` also matches songs where the field is `NULL` (same for numeric `isNot` and date `notInTheLast`).
- `inTheLast` / `notInTheLast` compare against `datetime('now', '-N days')`; any non-digits in the value are stripped.
- `inPlaylist` / `notInPlaylist` take a playlist id and compile to an `EXISTS` subquery on `playlist_songs`.
- For user-scoped fields, `isMissing` / `isPresent` also check the `user_songs` row itself (`us.user_id IS NULL OR …`), so "rating is missing" includes songs the user has never rated.

## Sorting and limits

- `sort` is an ordered list of `{ field, direction }` clauses plus optional `{ random: true }` entries; clauses are appended in order.
- `limit` caps the resolved track count directly.
- `limitPercent` resolves against the matched count first (the compiler runs a `COUNT(DISTINCT …)` query, then `ceil(total * percent / 100)`, minimum 1).

## Resolve modes

User-scoped rule fields need a "whose data?" answer when someone else views the playlist. `resolve_mode` on the playlist (migration `048_playlist_resolve_mode.sql`, `PlaylistResolveMode` in shared) controls this:

| Mode | UI label | Behavior |
|---|---|---|
| `tracks` | Shared track list | Rules resolve against the **owner's** data — every viewer receives the same curated track list (default). |
| `query` | Live query | Rules re-resolve against **each viewer's own** data. |

Without this, a rating-based playlist shared with another user would resolve against that user's own (unrated) library and come back empty.

## Compiler internals

`packages/server/src/features/smart-playlists/compiler.ts` turns `SmartPlaylistRules` into parameterized SQL:

- `fieldColumn()` maps each field to its SQL expression and declares required joins (`albums`, `artist`, `albumArtist`, `genre`, `userSongs`); joins are collected in a set and emitted once. The `albumArtist` join implies the `albums` join.
- `buildJoins()` renders the `LEFT JOIN` clauses; the `userSongs` join binds the resolving user id, which must precede WHERE parameters in the bind order (joins appear before WHERE).
- Every value is bound as a parameter — never interpolated. `LIKE` values are built with `%`/`_` escaping (`ESCAPE '\'`), and a dedicated `formatLike()` handles `contains`/`startsWith`/`endsWith`.
- The final query is `SELECT DISTINCT s.id FROM songs s … WHERE s.active = 1 AND <rules> <order> <limit>`; a parallel `songCountSql` powers counts and `limitPercent`.
- The compiled result (`CompiledSmartPlaylist`) carries `{ sql, params, songCountSql, songCountParams }`.

Resolution results are cached briefly in `features/playlists/repository.ts`, keyed by playlist id + `rules_json`, so rule edits invalidate immediately.

## API surface

Smart playlists use the normal playlist endpoints with `isSmart: true` and a `rules` payload (see [api.md](api.md#playlists)):

- `POST /api/playlists` / `PUT /api/playlists/:id` — accept `rules: SmartPlaylistRules` and `resolveMode`.
- `GET /api/playlists/:id` — resolves and returns the current entries; converting to manual (`isSmart: false`) freezes the resolved list.
- Validation in `serializeRules()` is intentionally loose (shape check only); unknown fields compile to a `title` fallback rather than erroring.

## Web editor

`packages/web/src/features/playlists/components/SmartPlaylistBlockEditor.tsx` edits rules inline in the playlist modal:

- Field dropdown from `SMART_PLAYLIST_FIELDS`; operator dropdown filtered by field type.
- Rules with `artist`, `album`, `albumArtist`, `genre`, or `releaseType` get an autocomplete input backed by `GET /api/suggestions?field=…` (admin-only endpoint; release type merges a canonical seed list — Album, EP, Single, Compilation, Live, Soundtrack, Remix — with values already in the library).
- Sort rows, `limit` / `limitPercent`, and the resolve-mode selector ("Shared track list" / "Live query") round out the editor.

## Where things live

| Piece | Location |
|---|---|
| Rule types + field list | `packages/shared/src/smart-playlist.ts` |
| SQL compiler | `packages/server/src/features/smart-playlists/compiler.ts` |
| Resolution + caching | `packages/server/src/features/playlists/repository.ts` |
| API validation/routes | `packages/server/src/features/playlists/management-routes.ts` |
| Rule editor UI | `packages/web/src/features/playlists/components/SmartPlaylistBlockEditor.tsx` |
| Autocomplete | `packages/web/src/components/ui/AutocompleteInput.tsx`, `packages/server/src/features/suggestions/routes.ts` |
| Compiler tests | `packages/server/tests/features/smart-playlists/compiler.test.ts` |

## Renaming note: `albumType` → `releaseType`

The album-type rule field was renamed to `releaseType` (matching the `albums.release_type` column, migration `049_rename_album_type.sql`). Because rules are persisted as JSON with the field name inline, the same migration rewrites stored `rules_json` (`"field":"albumType"` → `"field":"releaseType"`), so existing smart playlists keep working. If you rename a rule field in the future, update `SMART_PLAYLIST_FIELDS`, the compiler's `fieldColumn()`, and ship a data migration for stored rules.
