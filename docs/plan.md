# Plan: UX/UI audit overhaul + hardening + features (2026-08-23)

Working session goal: full UX/UI + code audit of Sonarly, fix everything, then commit, push, build the Docker image, and redeploy.

## Phase 1 — Audit (done)
- 4 parallel UI/UX audit agents (tokens/theming, app shell/shared components, library pages, settings/admin pages) against the ui-ux-audit checklists + design language.
- 5 parallel code audit agents (auth/security, DB/schema, media pipeline, API/OpenSubsonic, frontend logic).

## Phase 2 — Fixes (done)
- 8 parallel coder agents fixed criticals/warnings: token-based danger/success/warning/info colors, color-scheme, hover-reveal utility, focus traps in Modal, keyboard support (StarRating, context menus, tabs), responsive sidebar/player bar, mobile search, skip link, PageState everywhere, font-display headings, font-mono data, reduced-motion dampener.
- Backend: upload path-traversal fixes, session expiry/fixation/invalidation, login throttling, generic 500 handler, busy_timeout + worker pragmas, worker restart, scanner root-failure guard, library path prefix boundary, duplicate-replace data-loss fix, resync coalescing, scan-job pruning, migration 044 indexes, mutagen OGG/APIC/MP4Cover/timeout fixes.
- API: home/search param binding bugs, smart-playlist sort joins, OpenSubsonic XML attributes serializer, scrobble submission semantics, getAlbumList ordering/caps, transcode bps→kbps, auto-dj binding order, statistics contract fixes.
- Frontend logic: api.ts error surfacing + 401 event, AudioController AbortError/scrobble threshold/stalled handling + Media Session API, auto-DJ race, useFetch stale guard, playerStore empty-queue/previous behavior.

## Phase 3 — Features (done/in flight)
- Album type: migration 045, scanner reads `releasetype`, Album.albumType, edit-modal field with suggestion dropdown via /api/suggestions?field=albumType (seed list + existing values), album detail chip.
- Legacy removal: legacy Subsonic plaintext/enc: auth, dead api-keys/scan-repository functions, /songs duplicate page, dead cover_art columns (migration 046), readTags alias, {ext} token.
- Playlist share modal (in flight): visibility cards (private/shared/public/link), link copy, per-user shares with view/edit roles, user lookup endpoint.

## Phase 4 — Structure & docs
- Code structure verified against codebase-organizer skill: feature-first with barrels already; only api.ts → lib/ move + missing server barrels if needed.
- Update docs/design-language.md, docs/db-schema.md, agents/*.md, CHANGELOG.md.

## Phase 5 — Ship
- Full build + tests, git commit + push, `docker compose build && up -d` in /etc/periphery/stacks/sonarly (image ghcr.io/miquelrosell99/sonarly:latest, port 4534).
