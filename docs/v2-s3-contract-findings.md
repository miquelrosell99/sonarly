# S3 — OpenAPI contract pipeline: findings

Date: 2026-09-25. Scope: Sonarly v2 native REST API (Go), branch `feat/go-rewrite`.
Deliverables: `v2/api/openapi.yaml`, the chi-walk coverage test, the codegen
proof under `v2/api/client/`. Nothing committed; all work in the worktree.

## Coverage numbers

| Metric | Count |
|---|---|
| Router routes walked (production registry) | 67 |
| …of which native (in scope for this spec) | 63 |
| …of which OpenSubsonic `/rest` adapter (deliberately excluded) | 4 |
| Spec paths | 50 (48 `/api` + `/health` + `/ready`) |
| Spec operations | 63 (36 GET, 14 POST, 4 PUT, 8 DELETE, 1 HEAD) |

Coverage is asserted **in both directions** by `TestSpecCoversRouter`
(`v2/cmd/sonarly/spec_test.go`): every registered `/api` route+method must be
documented, and every documented operation must have a registered handler.
Drift fails the build. The 4 excluded `/rest` routes are the P6.5
OpenSubsonic skeleton (ping, getLicense, getOpenSubsonicExtensions,
getUser) — a separate Subsonic-compatible contract with its own envelope;
the test fails if they ever leak into this spec.

To support the test, `cmd/sonarly/main.go` was refactored: route mounting
moved from `run()` into `mountRoutes(ctx, srv, database, cfg, log) (*app, error)`,
which registers every route and returns the background-runtime handles
without starting any goroutine. `run()` is unchanged in behavior; the test
walks the exact production registry.

## The pipeline

```
Go route registry + DTOs  →  v2/api/openapi.yaml  →  @redocly/cli lint (0 errors, 0 warnings)
        ↑                                    ↓
  chi.Walk coverage test          npx openapi-typescript → v2/api/client/index.ts
  (cmd/sonarly/spec_test.go)                     ↓
                                        proof.ts + tsc --noEmit (strict, clean)
```

- Lint: `cd v2/api && npx @redocly/cli lint openapi.yaml` (config:
  `v2/api/redocly.yaml`, extends `recommended`; `operation-4xx-response` is
  off for `/health`, `/ready`, `/api/logout`, which genuinely have no 4xx).
- Regenerate client types: `npx openapi-typescript openapi.yaml -o client/index.ts`.
- The Go test additionally pins invariants independent of any external
  linter: OpenAPI 3.1.x, every operation declares responses, the SSE
  endpoint is `text/event-stream`, both security schemes exist, every
  local `$ref` resolves, and the stream HEAD + `shareToken` shapes survive
  spec edits.

## Route shapes that were awkward to spec

1. **Smart playlist rules** — `Rule.Value` is `any` (string | number |
   boolean | two-number array); `Rules` arrives as `json.RawMessage` and is
   strictly decoded. Spec'd as a `oneOf` union under `SmartPlaylistRules`.
   The field/operator whitelists live in the compiler, not the schema, so
   the spec documents structure only — validation errors are runtime 400s
   with precise messages (already the v2 behavior).
2. **Nullable-without-omitempty pointers** — `playlists.Entry.track`,
   `.discNumber`, `.duration` are `*int` **without** `omitempty`, so they
   serialize as explicit `null` (unlike every other optional field in v2,
   which disappears). This is deliberate v1 parity (`fetchPlaylistSongs`
   shape) and is spec'd as `required` + `type: [integer, 'null']`. Clients
   must handle `null`, not absent.
3. **`any` JSON columns** — `Song.syncedLyrics` (usually `SyncedLyricLine[]`,
   spec'd `oneOf` array|string), `Artist.externalUrls` (v1 contract is
   `Record<string,string>`; the Go DTO is the looser `any`), and
   `JobStatus.stats` (arbitrary progress JSON or `null`).
4. **Map-built responses** — the upload-session status handler assembles
   its body as `map[string]any`, so the spec's `UploadSessionStatus` schema
   is tighter than the Go code. Wire-compatible; a typed-struct refactor is
   a good cleanup candidate.
5. **SSE** — no JSON schema exists; the operation documents the
   `text/event-stream` media type, the initial `connected` event, and the
   30s heartbeat comments.
6. **HEAD /api/stream/{id}** — registered explicitly (v1 parity); spec'd
   with a bodyless 200.
7. **Admin update semantics** — `AdminUpdateInput` distinguishes absent
   (untouched) from explicit `null` (clear) for seven fields via custom
   `Optional*` unmarshalers. OpenAPI 3.1 cannot express "absent vs null"
   distinction; the schema marks those nullable and the description carries
   the semantics. Codegen users get `| null` and must read the description.
8. **chi trailing-slash registration** — `r.Route("/api/ingest", …)` style
   groups register index routes as `/api/ingest/`; chi answers the bare path
   via redirect. The coverage test normalizes the trailing slash and the
   spec documents the canonical bare form.

## Deviations discovered while writing the spec — and their dispositions

Fixed (spec side, code was right):

- `SearchPlaylist.songIds` was first spec'd nullable; the service
  initializes `[]string{}` in the row mapper, so the wire value is always
  an array. Spec tightened to a plain array.
- `IngestJob.status` first draft invented enum values; corrected to the
  real five (`pending`, `needs_review`, `imported`, `skipped`, `failed`).
- `Artist.externalUrls` first spec'd as arbitrary JSON; v1's contract is a
  string map, so the spec pins `additionalProperties: {type: string}` and
  notes the Go `any` looseness.

Kept deliberate (documented in the spec, not bugs):

- `PlaylistEntry.album` / `.artist` are plain `string` (empty when unset)
  while catalog DTOs use nullable — v1 parity.
- Auto-DJ GET silently caps `excludeIds` at 500; the POST variant 400s
  above 500. Both are v1 parity.
- Statistics `range` parsing is lenient (unknown → `all`); `groupBy` is
  strict (400). Both mirror v1.
- Upload chunk PUT is raw `application/octet-stream` (v2 deviation from
  v1's multipart, documented in the package and spec).
- Login/setup differ in success status (200 vs 201) — matches the Go code.

Not fixed, flagged for later phases:

- **`PublicUser.avatarUrl` points at `/api/avatars/{id}`, which has no v2
  route yet.** The field is spec'd with that caveat. When the avatars phase
  lands, the coverage test forces the spec update. Needs sign-off that this
  gap is expected in the current phase plan.
- The duplicate-strategy enum is defined twice in Go
  (`uploads.DuplicateStrategies` and `ingest.Strategy*` constants) with two
  validators. Same five wire values; consolidation candidate, no contract
  impact.

## Codegen recommendation for Track 3

**Use `openapi-typescript` as the typed layer, plus a small hand-written
fetch wrapper — not orval.**

Reasons:

- The generated output is dependency-free types (zero runtime, ~115 KB for
  all 63 operations); the spike's wrapper (`v2/api/client/proof.ts`, ~40
  lines of types + 20 lines of fetch) covers path/query/body typing,
  envelope unwrapping, and the uniform `{error}` contract. It typechecks
  under the repo's strict TS 5.9 and rejects excess query properties and
  bad enum values (verified deliberately in this spike).
- orval generates react-query/SWR hooks, MSW mocks and client classes from
  the same spec — a large config and runtime surface for a client whose
  v1 architecture is thin fetch hooks. The v2 web client regeneration
  (Track 3) should stay close to that shape.
- The spec already carries `operationId`s for all 63 operations, so if
  Track 3 later wants per-operation react-query hooks, orval can be layered
  on the same `openapi.yaml` without spec changes.
- One gotcha worth carrying forward: openapi-typescript emits response keys
  as **numeric** literals (`200`, not `'200'`); filters keyed on
  `` `2${string}` `` must stringify first (see `SuccessBody` in proof.ts).

## Sign-off items

1. Confirm the missing avatars route is a known phase gap (see above).
2. Confirm the `/rest` exclusion: the OpenSubsonic adapter gets its own
   contract document in a later spike (its DTOs/envelope differ radically).
3. `gopkg.in/yaml.v3` was added to `v2/go.mod` (test-only use via the spec
   coverage test).
4. `operation-4xx-response` is disabled in `v2/api/redocly.yaml` for the
   three routes that genuinely have no 4xx response.
