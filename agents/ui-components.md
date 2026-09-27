## Reusable UI Components

Shared components live in `web/src/components/`. Use them for consistent layout, interactions, and styling across features. Grid views of library content should use the `Card` component so hover actions (favorite, rating, play) and link behavior are uniform.

| Component | Path | Purpose |
|-----------|------|---------|
| `Layout` | `components/Layout.tsx` | App shell with sidebar and main content area. |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Class-component error boundary wrapping every route outlet (setup, guest, app trees) in `App.tsx`. A render crash shows a "Something went wrong / Reload" fallback instead of unmounting the whole root; the player chrome survives. |
| `Card` | `components/Card.tsx` | Content card with link, optional cover art, favorite, rating, and play actions. Use for grid views. |
| `CoverArt` | `components/CoverArt.tsx` | Cover art image with placeholder fallback. |
| `ArtistImage` | `components/ArtistImage.tsx` | Artist image from local disk with placeholder fallback. |
| `LibraryView` | `components/LibraryView.tsx` | Toggleable list/grid view for library entities (artists, albums, etc.). Pass a stable `viewModeKey` ('tracks', 'search-albums', …) to persist the user's choice per page in localStorage (`usePersistentViewMode`); omit it for ephemeral views (queue editor). Click-selection is an affordance of play-selection: rows only highlight/select when `onPlaySelection` is provided (mirrors `Table`'s `selectable = Boolean(onPlaySelection)`), so pages without it don't show a dead selection affordance. |
| `ListRow` | `components/ListRow.tsx` | Clickable table row with play, favorite, and rating actions. |
| `ItemContextMenu` | `components/ItemContextMenu.tsx` | Right-click/long-press/keyboard context menu wrapper. Keyboard path: the wrapped trigger opens the menu with Shift+F10 or the Menu key (menu anchors below the trigger); ArrowUp/Down cycle items, Home/End jump to the edges, Tab closes and returns focus to the trigger, Escape closes and returns focus to the trigger. Popover-style triggers (`anchorToTrigger`) automatically get `aria-haspopup="menu"` and a live `aria-expanded`. |
| `FilterPanel` | `components/FilterPanel.tsx` | Filter controls for library pages. |
| `SearchBox` | `components/SearchBox.tsx` | Global search input. |
| `TopBar` | `components/TopBar.tsx` | Header with search and user menu. The connected-devices indicator polls `/api/players` only while other players are present (and never in background tabs) — see `playersPollInterval`. |
| `Sidebar` | `components/Sidebar.tsx` | Navigation sidebar. |
| `PlayerBar` | `components/PlayerBar.tsx` | Persistent playback controls. |
| `NowPlayingAnnouncer` | `components/NowPlayingAnnouncer.tsx` | Visually-hidden polite live region (`aria-live="polite"`, `role="status"`) rendered in `Layout` next to the skip link; announces "Now playing: {title} by {artist}" whenever the current track changes. |
| `AudioController` | `components/AudioController.tsx` | Audio element and playback state bridge. |
| `ActionButtons` | `components/ActionButtons.tsx` | `FavoriteButton` and `StarRating` primitives. |
| `FavoriteRatingGroup` | `components/FavoriteRatingGroup.tsx` | Inline favorite + rating combo used in headers and cards. |
| `EntityHeader` | `components/EntityHeader.tsx` | Reusable header with cover, title, metadata chips, and actions. |
| `MetadataBreadcrumb` | `components/MetadataBreadcrumb.tsx` | Horizontal metadata chips with optional links. |
| `ExplicitTitle` | `components/ExplicitTitle.tsx` | Title text with explicit-content badge and blur toggle. |
| `PageState` | `components/PageState.tsx` | Loading, empty, and error states for pages. Loading renders `role="status"` with a spinner; error renders `role="alert"` with an icon and an optional `onRetry` button; empty accepts an optional `emptyIcon`, `emptyDescription`, and `emptyAction`. All pages must use it instead of hand-rolled state blocks. |
| `Avatar` | `components/Avatar.tsx` | User avatar with placeholder fallback. |
| `Skeletons` | `components/Skeletons.tsx` | Route-shaped Suspense fallbacks (`ListPageSkeleton`, `GridPageSkeleton`, `EntityDetailSkeleton`, `PageSkeleton`) that mirror real page markup with `animate-pulse` placeholders (static under reduced motion). Used by every lazy route in `App.tsx`. |
| `SidebarPlaylistItem` | `components/SidebarPlaylistItem.tsx` | Sidebar playlist link with right-click/long-press menu (play, shuffle, edit, share, delete). |
| `SleepTimerButton` | `components/SleepTimerButton.tsx` | Player-bar sleep timer with countdown and option popover. |
| `TrackActionsMenu` | `components/TrackActionsMenu.tsx` | "More actions" popover for the current track (go to album/artist, save queue as playlist). |
| `EditEntityModal` | `components/EditEntityModal.tsx` | Tag-edit modal for songs/albums (single and multi-select), artists and smart playlists. Song payloads go through `buildSongTagsPatch` (`lib/songEditPatch.ts`) — genre as string\|string[] of names; id-shaped keys are hard-stripped from the payload. Synced-lyrics counts go through `normalizeSyncedLyrics` (the raw LRC string form still counts). The per-type bodies live in `components/edit-entity/` (P10b split): `SongEditor`, `AlbumEditor`, `ArtistEditor`, `PlaylistEditor` behind the field configs in `fields.ts`, with the shared multi-edit reducer in `useTagEditState.ts`, pure value helpers in `tagValues.ts`, cover-art editing in `CoverArtSection`/`EditableCoverArt`/`CoverArtLightbox`, and the LRCLIB/MusicBrainz fetch modals hosted by `FetchModalsHost`. |
| `Button` | `components/ui/Button.tsx` | Button primitive. Optional `loading` prop shows a spinner and disables the button. |
| `Modal` | `components/ui/Modal.tsx` | Dialog primitive (portal, focus trap, focus restore, Escape). The title id is scoped per instance with `useId()` so simultaneously open modals never share an `aria-labelledby` target. The focus-trap selector uses `a[href]` (bare `[href]` also matches SVG `<use>` refs, which are not focusable). |
| `Input` | `components/ui/Input.tsx` | Text input primitive. |
| `Icon` | `components/ui/Icon.tsx` | Icon renderer. |
| `Table` | `components/ui/Table.tsx` | Generic table component. Rows are selectable (click/ctrl/shift-range, double-click or Enter plays via `onPlaySelection`) only when `onPlaySelection` is provided (`selectable`); without it rows render non-interactive. |
| `AutocompleteInput` | `components/ui/AutocompleteInput.tsx` | Autocomplete input primitive backed by `/api/suggestions` (fields: artist, album, albumArtist, genre, releaseType via the `AutocompleteField` union). Supports ref forwarding and an `onValueSelect` callback for use inside `PillInput`. |
| `PillInput` | `components/ui/PillInput.tsx` | Multi-value pill list with inline autocomplete. Used for artists and genres in edit and metadata-fetch modals. |
| `ProgressBar` | `components/ui/ProgressBar.tsx` | Progress indicator. |
| `Skeleton` | `components/ui/Skeleton.tsx` | Single `animate-pulse` placeholder block (disabled under reduced motion). Compose into page-shaped fallbacks; see `components/Skeletons.tsx`. |
| `EmptyState` | `components/ui/EmptyState.tsx` | Icon + one-line explanation + optional primary action for empty views that need more than `PageState`'s plain message. |
| `VirtualList` | `components/ui/VirtualList.tsx` | Windowed table body over @tanstack/react-virtual (overscan 5, spacer rows keep total scroll height exact). Renders all rows when disabled or when no scroll container resolves. |
| `VirtualGrid` | `components/ui/VirtualGrid.tsx` | Windowed card grid (masonry lanes, responsive column count matching the app grid breakpoints, DOM-measured card heights). Renders all cards when no scroll container resolves. |
| `usePopoverMenu` | `components/ui/usePopoverMenu.ts` | Shared popover-menu controller (P10a): open state, outside-click close, Escape with trigger focus-restore, measured viewport clamping, focus-first-item, arrow roving, and `aria-haspopup`/`aria-expanded` trigger props. Portal positioning (`position: fixed` + clamp) is the default; `portal: false` keeps the menu in-tree for CSS-anchored dropdowns (TopBar user/players menus). Consumers: `TrackActionsMenu`, `SleepTimerButton`, `TopBar` (`UserMenu`, `PlayersDropdown`). `ItemContextMenu` stays the context-menu specialist (right-click/long-press, `anchorToTrigger`). |
| `PlayerControls` | `components/PlayerControls.tsx` | Player transport primitives: `PlayPauseButton` (the play/pause toggle — distinct from `components/PlayButton.tsx`, the play-trigger with hold-to-shuffle), `ControlButton` (round icon transport button), and `Slider` (range input with `--slider-fill` styling; no `variant` prop — appearance is CSS-only). |
| `SongTable` | `features/songs/components/SongTable.tsx` | Opinionated song table; accepts `SongListItem` rows. |
| `SharePlaylistModal` | `features/playlists/components/SharePlaylistModal.tsx` | Playlist sharing: visibility cards (private/shared/public/link), share-link copy, and per-user shares with view/edit roles. Owner-only, opened from the playlist detail header. |
| `TrackList` | `features/songs/components/TrackList.tsx` | Simple vertical list of tracks. |
| `AlbumList` | `features/albums/components/AlbumList.tsx` | Simple vertical list of albums. |

When adding, removing, or significantly changing a shared component, update this table.

### Reusable widgets

Small UI patterns that should be reused instead of reimplemented:

| Widget | Path | Use for |
|--------|------|---------|
| `Checkbox` | `components/ui/Checkbox.tsx` | All boolean settings. Replace native `<input type="checkbox">` with this styled control. |
| `ItemContextMenu` | `components/ItemContextMenu.tsx` | Right-click or long-press menus. It portals the menu to `document.body` so it is not clipped by ancestor `overflow` rules. |
| Card selector | `features/settings/pages/SettingsPlayback.tsx` | Mutually exclusive choices with an icon, title, and short description. Use as a horizontal row of cards that stack vertically on small screens. |

### PlayerBar artist links

`PlayerBar` renders the current track's artists as separate clickable links. When a song has `artistEntries` (populated from the `song_artists` junction table), each entry gets its own link to `/artists/<id>`. If only the legacy single `artistId`/`artistName` fields are present, it falls back to one link. This ensures multi-artist tracks are navigable from the playbar.
