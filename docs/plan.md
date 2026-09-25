# Sonarly — Engineering Plan (living document)

> Last updated: 2026-09-24. Keep this file updated as tracks progress.
> Backend audit: `docs/audits/2026-09-24-backend-architecture-audit.md` (findings F1–F16, decision record DR-1).

## Tracks

### Track 1 — v2 Go rewrite (branch `feat/go-rewrite`, worktree `.worktrees/go-rewrite`, code in `v2/`)

Greenfield backend per DR-1 status change. **Quality bar: no hacky solutions or shortcuts in stack choice, coding, schema, or testing — with explicitly accepted trade-offs (see below), so ambition can't silently inflate later phases.**

Stack: Go 1.23 · chi v5 · `modernc.org/sqlite` (pure Go, WAL/FK/busy_timeout/synchronous=NORMAL, single writer conn) · embedded SQL migrations with ledger · `signal.NotifyContext` graceful shutdown · slog JSON logging.

### Accepted trade-offs (written down so phases can't silently absorb ambition)

- **Single-node only.** No clustering, no multi-replica, no read replicas. SQLite single writer is a feature, not a limitation to engineer around.
- **FTS5 without ranking tuning.** Prefix/substring search over title/artist/album; bm25 ranking refinement only if the S1-era product review demands it.
- **Coarse ACL.** Library-level assignment only (enforced `user_libraries`); no per-album/per-artist grants, no roles beyond admin/user.
- **Quirk preservation over spec purity** in the OpenSubsonic adapter where real clients depend on v1 behavior; deviations from spec documented in the quirks checklist.
- **Tag richness may be reduced at v2.0** vs v1's `music-metadata` reader, pending the S1 accept/reject list and product sign-off — not silently.
- **No transcode cache, no artwork derivatives at v2.0** — concurrency cap and original-blob serving first; caches only if usage proves the need.
- **Parity is defined by the v1 behavior checklist, not the OpenSubsonic spec text.**

Target architecture: audit §16–§19 (modular monolith, `internal/modules/<domain>`, OpenSubsonic as adapter over one application core, typed DB-backed job queue, FTS5 search, enforced library isolation, Track/MediaFile separation where justified).

Phases:

- [x] P0 — scaffold: config, db+migrate, httpserver, `/health`+`/ready`, smoke-tested
- [x] P1 — baseline schema distilled from v1 migrations (+ audit schema fixes)
- [x] **S1 — metadata spike (gates P4)** ✅ DONE (`7f5b5aa`, verdict **GO**, **sign-off APPROVED 2026-09-25**): `dhowden/tag` + own fork (multi-value W1, m4a `rtng`/`tmpo` W2) + ~300-line pure-Go properties reader (W5) reaches full v1 parity without CGO. Deliverable: `docs/v2-s1-metadata-findings.md` §6 sign-off list. Surprise finding: v1's native SYLT branch is dead code — synced-lyrics parity is the LRC-in-tag path.
- [x] P2 — auth + users (sessions, API keys, admin) with enforced library isolation ✅ (`e38c230`): SQLite session store, v1-wire-compatible signed cookie + AES-GCM secret box (interop-tested), fixation-safe login, TOCTOU-fixed setup, last-admin protections, session invalidation on role/password change, login throttle, Go port of the isolation policy. 49 test functions green. (Also fixed `.gitignore` blanket `config/` rule that had excluded `v2/internal/config/` since the scaffold commit.)
- [x] P3 — catalog (artists/albums/songs/genres) + repositories + native API ✅ (`036c9f0`): read APIs fully isolation-scoped (404 details), N+1 guarded by counting-driver tests (5 queries for album+25 songs), song DTOs drop filePath/checksum (contract-tested), genre-tree pruning ported, deliberate v1 deviations documented. 25 test functions.
- [x] **S2 — streaming spike (gates P5)** ✅ DONE (`bcc8356`, verdict **GO**, **sign-off APPROVED 2026-09-25**): stdlib-only `StreamingService → DirectStreamer/TranscodingStreamer`. Measured: direct TTFB 95 µs vs transcode 42.3 ms; disconnect→SIGKILL 3.4 ms median; semaphore cap 2 → 503+Retry-After at 2× overload, direct unaffected; RSS 9.3→13.8 MB under 20 streams + 2 transcodes. Parity guards found: Go 1.21+ `ServeContent` does multipart/byteranges (v1→416) and `bytes=-0` yields invalid Content-Range (v1→416). No v1-B12 trap in Go (spawn errors synchronous). Deliverable: `docs/v2-s2-streaming-findings.md` §10.
- [ ] P4 — library runtime: scanner, watcher, scheduler, job queue/worker (typed payloads, coalescing, cancellation)
- [ ] P5 — playback: streaming service (range, transcode w/ concurrency cap), scrobble, bookmarks
- [ ] P6 — playlists (static + smart compiler) + sharing policy
- [ ] P6.5 — OpenSubsonic adapter skeleton + **quirks checklist** (`docs/v2-opensubsonic-quirks.md`) started from day one: every v1 endpoint behavior, quirks included (envelope-on-error, search3 empty-query pagination, getAlbumInfo→albumInfo element, getIndexes lastModified, toStarredDate epoch dates, submission=false no-op, etc.). Quirk preservation is where rewrites lose users — the checklist makes the parity tail (P9) a lookup exercise instead of an archaeology project
- [ ] P7 — ingestion: uploads (streaming reassembly), ingest pipeline, duplicates, organize
- [ ] P8 — search (FTS5 — verified on modernc.org/sqlite 2026-09-24) + statistics + home/auto-dj
- [ ] P9 — OpenSubsonic adapter full parity (43 endpoints) against the quirks checklist — budgeted as the largest phase, not an afterthought
- [ ] **S3 — contract spike (gates Track 3)**: OpenAPI from Go routes + client codegen (DR-2 risk 2)
- [ ] P10 — parity test suite + cutover evaluation
- [ ] **P10b — v1→v2 data migration + dual-run**: import a production v1 DB snapshot into v2, diff library state end-to-end (songs/albums/artists/playlists/history/ratings), run v2 alongside v1 against the real library, write the rollback story. Cutover is not discussed without this phase passing

### Track 2 — v1 TypeScript hardening (branch `main`)

Continues regardless of v2 outcome. Done 2026-09-24: CI workflow (`61ac4a6`), transactional playlist writes (`afdf545`), `average_rating` preservation (`48123b2`), conflicts file deletion (`1554b0d`), resync coalescing (`a5c19eb`) — 515/515 tests green.

**F1 DECISION (2026-09-24, product owner): per-user library assignment IS a security boundary.** `user_libraries` must be enforced in every content query and stream/download path on v1 (admins bypass; share-token grants stay scoped to playlist content). **Done (`0a8a354`): enforced across all native + OpenSubsonic content paths with an authorization-matrix suite — 525 tests green.**

Phase 2 security batch done 2026-09-24: SIGTERM graceful shutdown (`b3469ce`), authenticated+scoped `/api/libraries` (`7d181e7`), session invalidation on password reset (`579ce1c`), shareToken owner-only (`4f27147`), ffmpeg spawn fallback + maxBitRate clamp (`ff4a1ec`), scrobble validation (`4cca221`), `/healthz` + container healthchecks (`3fe9abd`) — **541 tests green**. v2 builds with the same enforcement from the start. CI pinned to Node 22 (`278785f`).

Remaining Phase 2 (lower priority): ffmpeg concurrency cap + rate limiting, login hardening (timing equalization, throttle eviction, trustProxy), default-secret warning, upload reassembly streaming.

### Track 3 — Frontend audit (TRIGGER: S3 contract spike lands — runs IN PARALLEL with v2 P4–P8, not after "backend done")

A stable contract is the prerequisite, not a finished backend. Once S3 (OpenAPI codegen) lands, the frontend audit proceeds against the frozen contract while backend phases continue — auditing against a stable contract is better than against a moving one, and this avoids serializing months of work. Prompt: Appendix A below. Prerequisite: v2 exposes the contracted API surface.

---

## Appendix A — Frontend Audit Prompt

Execute this prompt when the v2 backend is complete. It is the frontend equivalent of the backend audit prompt; same rigor, same rules.

---

# ROLE

Act as a **principal frontend architect, staff-level software engineer, and web codebase modernization specialist**.

You are auditing the production-oriented web client of a **music streaming and personal music library management application** (Sonarly, `packages/web` in this repository).

Your job is NOT to blindly refactor the codebase or apply generic best practices.

Your job is to:

1. Understand the existing system deeply.
2. Audit its architecture, component organization, state management, data flow, routing, API integration, styling system, performance, accessibility, security, testing, and build tooling.
3. Identify architectural weaknesses, unnecessary complexity, technical debt, and opportunities for simplification.
4. Propose a significantly cleaner and more maintainable frontend architecture.
5. Recommend changes to the technology stack only where there is a concrete engineering justification.
6. Produce a practical migration strategy that can be executed incrementally without unnecessarily destabilizing the application.
7. Only after the audit and recommendations are clear, identify which changes should actually be implemented.

Think like someone who will have to **own this frontend for the next 5 years**, not someone trying to make the repository look cleaner for a code review.

---

# FIRST PRINCIPLE

**DO NOT MODIFY CODE IMMEDIATELY.**

Start with a comprehensive read-only audit.

Do not assume the current architecture is correct.

Do not assume the current architecture is wrong either.

Base conclusions on what you actually discover in the repository.

When something is unclear, investigate it.

When something is potentially problematic, trace its usage before recommending removal.

When recommending a technology change, explain what concrete problem it solves and what trade-offs it introduces.

---

# APPLICATION CONTEXT

The application is the **web client of a music streaming + music library management platform**. The backend is a Go (v2) server exposing a native REST API and an OpenSubsonic-compatible API; the web client is the primary first-party consumer of the native API.

The client may contain functionality such as:

* Authentication screens and session handling
* Home/dashboard (recently played, suggestions)
* Library browsing: artists, albums, songs, genres, years
* Search
* Playlist management (static and smart playlists)
* Favorites, ratings, bookmarks
* Audio player (playback controls, queue, now playing, scrobbling)
* Streaming playback with transcoding preferences
* Uploads (chunked)
* Admin screens (users, libraries, settings, ingest review, conflicts, scan status)
* User preferences and profile
* Statistics and listening history
* Server-sent events handling
* Error handling, loading states, toasts

Do NOT assume all of these exist.

Determine what actually exists in the repository.

---

# PHASE 1 — REPOSITORY RECONNAISSANCE

Before making recommendations, inspect `packages/web` thoroughly.

Build an architectural map of the client.

Inspect:

* Directory structure (`src/features/`, `src/components/`, `src/hooks/`, `src/stores/`, `src/contexts/`, `src/lib/`)
* Entry points and bootstrap (`main.tsx`, `App.tsx`)
* Routing setup and route inventory
* State management (every store, context, and server-state cache)
* Data fetching layer (API client, fetch wrappers, typed endpoints, `@sonarly/shared` usage)
* Component inventory (pages, domain components, shared UI primitives)
* Forms and validation
* Styling approach (Tailwind config, design tokens, component variants)
* Player implementation (audio element management, queue, scrobble triggers)
* SSE / realtime handling
* Error boundaries, error handling, loading states
* Authentication flow and route guards
* Environment/config handling
* Dependency manifest and lockfile
* Build configuration (Vite config, aliases, test config)
* Tests and fixtures
* Dead/unused code, deprecated code, feature flags
* Duplication between `src/features/` and `src/components/`

Also inspect the dependency graph.

Identify:

* Direct dependencies
* Important transitive dependencies
* Duplicated functionality (e.g. multiple data-fetching or state libraries)
* Dependencies that appear unnecessary
* Dependencies that are outdated or architecturally questionable
* Libraries creating excessive coupling
* Libraries that should potentially be replaced
* Libraries that should absolutely be retained

Do not recommend replacing dependencies merely because a newer alternative exists.

---

# PHASE 2 — BUILD A SYSTEM MODEL

Before judging the architecture, construct a mental model of how the client works.

Document:

## Runtime architecture

```text
Browser
  ↓
App shell / router
  ↓
Pages (features)
  ↓
Components + hooks
  ↓
Stores / contexts / server-state cache
  ↓
API client
  ↓
HTTP (native REST API, SSE)
```

Identify the real layers rather than forcing the code into this model.

## Data flow

Trace important operations end-to-end:

### Authentication

```text
Login form
→ API call
→ session cookie
→ user context/store
→ route guards
→ authenticated app
```

### Library browsing

```text
Route
→ page component
→ data fetch (when? cache? invalidation?)
→ list/grid rendering
→ pagination or virtualization
→ item → detail route
```

### Playback

```text
User action
→ player store
→ audio element / stream URL
→ playback events (progress, ended)
→ scrobble
→ now-playing state
```

### Upload

```text
File selection
→ chunked upload protocol
→ progress state
→ completion → ingest job → library refresh
```

### Realtime (SSE)

```text
Event stream
→ client handler
→ cache invalidation / store update
→ UI refresh
```

Document failure and retry behavior for each.

---

# PHASE 3 — ARCHITECTURAL ASSESSMENT

Assess the architecture across the following dimensions.

Give each dimension a qualitative assessment:

* Strong
* Acceptable
* Needs improvement
* High risk

Do NOT use arbitrary numerical scores.

For every assessment provide concrete evidence from the repository.

---

## 3.1 Codebase organization

Analyze:

* Folder structure (features vs components vs hooks vs stores)
* Naming conventions
* Feature boundaries and leakage between features
* Shared UI primitives (`src/components/ui/`) vs domain components
* God components and god hooks
* Excessively large files
* Cross-feature imports and shared-module discipline
* Circular dependencies
* Whether the organization is by technical layer, domain, feature, or hybrid

Explain whether the current organization scales as the application grows.

---

## 3.2 Component architecture

Audit:

* Component size and responsibility distribution
* Prop drilling vs composition
* Render-prop / hook extraction patterns
* Reusability of domain components
* Duplication across similar screens (e.g. artist/album/playlist pages)
* Conditional rendering complexity
* List rendering and keys
* Error boundaries and suspense-style loading patterns

Identify components that should be split, merged, or made generic.

---

## 3.3 State management

This is a critical area.

Inventory EVERY state container:

* What does it hold?
* Who writes to it?
* Who reads from it?
* Lifetime and reset semantics?
* Server state vs client state — is the distinction clean?
* Cache invalidation strategy for server data
* Duplication between stores, contexts, and fetched data
* Stale data risks
* Optimistic updates (present? correct?)

Determine whether the current state architecture (whatever it actually is — zustand stores, contexts, React Query, or hand-rolled fetching) is used effectively and consistently.

---

## 3.4 Routing and navigation

Audit:

* Route inventory and nesting
* Route guards (auth, admin)
* Deep-linking behavior
* URL as state (filters, pagination, tabs)
* Navigation patterns and their consistency

---

## 3.5 Data fetching and API integration

Audit:

* API client design (typed endpoints, error normalization)
* `@sonarly/shared` contract usage — single source of truth or drift?
* Fetch lifecycle (loading/error/empty states) and its consistency
* Mutation patterns (invalidation, optimistic updates)
* SSE handling and reconnect behavior
* Polling vs events
* Request cancellation and race conditions (e.g. search-as-you-type)

---

## 3.6 Forms and validation

Audit:

* Form implementation patterns
* Validation approach and error display
* Duplicate form logic
* Accessibility of forms (labels, focus, error announcement)

---

## 3.7 Styling and design system

Audit:

* Tailwind usage consistency
* Design token usage vs hardcoded values
* `src/components/ui/` primitive inventory and their API quality
* Responsive design patterns
* Dark mode / theming (if present)
* Consistency with the documented design language (`docs/design-language.md`, `agents/design-language.md`, `agents/ui-components.md`)

---

## 3.8 Performance

Audit:

* Bundle composition and code splitting
* Lazy loading of routes
* Re-render behavior (memoization, context value stability, selector discipline)
* List virtualization for large libraries
* Image loading strategy (artwork)
* Audio memory/URL management (object URL leaks)
* Expensive computations (sorting, filtering large arrays)
* Network waterfall patterns

Distinguish confirmed vs suspected bottlenecks.

---

## 3.9 Accessibility

Audit:

* Keyboard navigation
* Focus management (modals, menus, player)
* ARIA usage
* Color contrast
* Screen-reader semantics for interactive controls
* Motion and reduced-motion support
* Touch target sizes

---

## 3.10 Testing

Analyze:

* Unit tests (hooks, stores, utilities)
* Component tests
* Page/feature tests
* Player testing
* Mocking strategy (API layer)
* Test isolation and speed
* Coverage of critical flows (auth, upload, playback, playlists)

Recommend a pragmatic testing pyramid.

---

## 3.11 Security

Audit:

* XSS risks (`dangerouslySetInnerHTML`, unsanitized lyrics/metadata rendering)
* Token/session handling
* CSRF exposure (relevant even with sameSite cookies — verify)
* External links and `target="_blank"` hygiene
* Dependency vulnerabilities
* Sensitive data in client state/logs

Classify findings: Critical / High / Medium / Low / Informational. Only classify with reasonable evidence.

---

## 3.12 Observability and error handling

Audit:

* Global error boundaries
* Unhandled promise rejections
* Error reporting (if any)
* User-facing error consistency (toasts vs inline vs silent)
* Logging hygiene

---

## 3.13 API contract alignment (v2 context)

Audit:

* How the client consumes the backend contract
* Assumptions that break against the v2 Go API (endpoint shapes, error shape `{error}`, pagination conventions, SSE event types)
* Places where the client duplicates backend business rules that the backend should own (e.g. smart playlist rule validation, hide-explicit filtering)

---

# PHASE 4 — TECHNOLOGY STACK AUDIT

For every major technology, classify it as: Keep / Keep but isolate / Replace eventually / Replace soon / Remove, and explain why.

Evaluate at minimum:

* React (version? features used effectively — concurrent, transitions?)
* Vite
* TypeScript
* Tailwind CSS
* State/data libraries actually present (zustand, React Query, or hand-rolled)
* Router library
* Form libraries
* Icon/component libraries
* Audio handling (native `<audio>` vs library)
* Test stack (vitest, testing-library, jsdom)
* Build/deployment (static serving from the Go server? CDN?)

Do NOT introduce infrastructure for the sake of architectural sophistication. Prefer the simplest stack that satisfies the actual requirements.

---

# PHASE 5 — ARCHITECTURAL ALTERNATIVES

Design 2–3 realistic architectural options for the client, for example:

### Option A — Minimal Evolution
Keep stack and structure; fix state-management inconsistencies, performance, accessibility, testing.

### Option B — Feature-Modular Client
Strong feature modules with explicit public APIs, a single server-state layer, and a documented dependency rule set.

### Option C — Framework/Radical Change (e.g. different framework, SSR, islands)
Only propose this if genuinely justified.

For every option provide: architecture, benefits, drawbacks, operational complexity, migration difficulty, performance implications, team implications, failure modes, when it makes sense.

Do not recommend a framework rewrite merely because another framework is popular.

---

# PHASE 6 — TARGET ARCHITECTURE

Propose a target frontend architecture that is:

* modular
* understandable
* testable
* performant for large libraries
* accessible
* aligned with the v2 backend contract
* resistant to accidental coupling
* appropriately simple

Provide a concrete directory structure based on the actual repository (do not copy a template blindly). Explain the responsibility of each area.

---

# PHASE 7 — DEPENDENCY RULES

Define explicit dependency rules, for example:

```text
pages → features → components/ui
features → api client, stores, hooks
components/ui → nothing (leaf)
stores → api client
nothing → pages
```

Explain what may import what, what must never import what, how cross-feature communication works, and how shared code is controlled. Identify current violations.

---

# PHASE 8 — CODE SMELLS AND TECHNICAL DEBT

Find concrete examples of:

* God components and god hooks
* Duplicated logic and copy/paste
* Prop drilling
* Leaky abstractions
* Hidden global state
* Business logic in components that belongs to the backend
* Magic constants
* Inconsistent error/loading handling
* Dead code, unused dependencies, unreachable code
* Fragile tests

For each significant issue provide:

```text
Problem
Location
Why it matters
Risk
Recommended change
Priority
```

---

# PHASE 9 — PERFORMANCE AUDIT

Identify likely performance bottlenecks: renders, bundle, lists, images, audio, network.

Distinguish: confirmed bottleneck / likely bottleneck / architectural risk / premature optimization.

---

# PHASE 10 — SCALABILITY MODEL

Model client behavior with large libraries (10k–1M+ tracks): list rendering, search-as-you-type, memory usage of stores, artwork loading, long-session stability (audio element, SSE reconnects, memory leaks).

Do not optimize for hypothetical scale the product does not need.

---

# PHASE 11 — MIGRATION STRATEGY

Produce an incremental migration plan (Phase 0 safety → structural cleanup → module boundaries → state architecture → performance → accessibility → testing), with objectives, affected files, risks, benefits, rollback, and prerequisites for each phase.

If the v2 backend changes API contracts, define the client migration order against it.

---

# PHASE 12 — IMPLEMENTATION PLAN

Create a concrete implementation backlog (ID, Title, Priority, Area, Problem, Evidence, Proposed solution, Files/modules affected, Dependencies, Risk, Testing required, Expected outcome), separated into Must do / Should do / Could do / **Do not do**.

---

# PHASE 13 — ACTUAL CODE CHANGES

Only after the audit and plan are complete, determine which improvements can safely be implemented now. For each: explain what/why, identify affected modules, preserve existing behavior unless intentional, add or update tests, avoid unnecessary rewrites, keep commits logically separable, do not mix unrelated refactors with functional changes.

---

# IMPORTANT ENGINEERING PRINCIPLES

1. **Prefer boring architecture.** A well-designed React SPA is preferable to unnecessary SSR/islands/complexity.
2. **Optimize for maintainability first.** Do not trade substantial complexity for theoretical scalability.
3. **Server state and client state are different things.** Do not unify them into one undifferentiated store.
4. **Make module boundaries explicit.**
5. **Avoid `shared/` becoming a dumping ground.**
6. **Prefer composition over inheritance.**
7. **Prefer explicit dependencies over hidden global state.**
8. **The backend owns business rules.** The client validates for UX, not for correctness.
9. **Treat the API contract as an architectural component.**
10. **Don't cargo-cult Clean Architecture, DDD, or micro-frontends.**
11. **Avoid premature infrastructure.** No state library, meta-framework, or design-system adoption without demonstrated need.
12. **Make music-specific concerns first-class:** audio lifecycle, artwork, long lists, playback persistence.
13. **Preserve simplicity.** Every new abstraction should earn its existence.

---

# REQUIRED FINAL REPORT

Produce a structured report with these sections:

1. Executive Summary
2. Current Architecture (ASCII diagram)
3. Repository Structure Assessment
4. State Management Model (inventory + assessment)
5. Component Architecture (inventory + boundaries)
6. Dependency Graph (healthy edges + problematic coupling)
7. Critical Findings
8. Code Quality Findings (with locations)
9. API Integration Assessment
10. Player & Media Assessment
11. Performance Assessment
12. Accessibility Assessment
13. Security Assessment (prioritized)
14. Testing Assessment
15. Technology Stack Assessment (table: Technology / Current role / Assessment / Keep-Replace / Reason / Alternative / Migration difficulty)
16. Architecture Alternatives (2–3)
17. Recommended Target Architecture
18. Proposed Directory Structure (complete tree)
19. Dependency Rules
20. Migration Roadmap (phased)
21. Implementation Backlog (Must / Should / Could / Do-not-do)
22. "Do Not Overengineer" List
23. Top 10 Highest-Value Improvements (grouped by priority, not ranked)
24. Questions / Unknowns

---

# OUTPUT QUALITY REQUIREMENTS

Be extremely concrete. Use repository paths and symbol names. When citing a problem provide path, symbol, behavior, why it matters. Distinguish observed facts / inferred risks / architectural recommendations / optional improvements.

Do not invent functionality, performance requirements, or scaling requirements.

Do not assume a framework change, SSR, or micro-frontends are necessary.

Do not recommend rewriting working code solely for stylistic reasons.

---

# FINAL RULE

**Understand first. Recommend second. Modify third.**

The objective is to make the frontend: easier to understand, easier to extend, safer to change, easier to test, performant enough for its actual workload, accessible, and simpler wherever possible.

Start by inspecting the repository and producing the architectural audit. Do not make code changes until the audit and proposed architecture are understood.

---

## Appendix B — Execution notes for the frontend audit

- Run the prompt against `packages/web` in the main checkout (and the v2-aware contract layer once it exists).
- Produce the report as `docs/audits/<date>-frontend-architecture-audit.md`, linked from `docs/README.md`.
- Dispatch parallel read-only exploration agents per subsystem (routing/pages, state/stores, player, styling/ui primitives, tests/tooling) before synthesizing — the same method as the backend audit.
- The frontend audit updates `AGENTS.md` / `agents/ui-components.md` / `agents/design-language.md` where they drift from reality.
