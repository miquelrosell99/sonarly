## Reusable UI Components

Shared components live in `packages/web/src/components/`. Use them for consistent layout, interactions, and styling across features. Grid views of library content should use the `Card` component so hover actions (favorite, rating, play) and link behavior are uniform.

| Component | Path | Purpose |
|-----------|------|---------|
| `Layout` | `components/Layout.tsx` | App shell with sidebar and main content area. |
| `Card` | `components/Card.tsx` | Content card with link, optional cover art, favorite, rating, and play actions. Use for grid views. |
| `CoverArt` | `components/CoverArt.tsx` | Cover art image with placeholder fallback. |
| `ArtistImage` | `components/ArtistImage.tsx` | Artist image from local disk with placeholder fallback. |
| `LibraryView` | `components/LibraryView.tsx` | Toggleable list/grid view for library entities (artists, albums, etc.). |
| `ListRow` | `components/ListRow.tsx` | Clickable table row with play, favorite, and rating actions. |
| `ItemContextMenu` | `components/ItemContextMenu.tsx` | Right-click/long-press context menu wrapper. |
| `FilterPanel` | `components/FilterPanel.tsx` | Filter controls for library pages. |
| `SearchBox` | `components/SearchBox.tsx` | Global search input. |
| `TopBar` | `components/TopBar.tsx` | Header with search and user menu. |
| `Sidebar` | `components/Sidebar.tsx` | Navigation sidebar. |
| `PlayerBar` | `components/PlayerBar.tsx` | Persistent playback controls. |
| `AudioController` | `components/AudioController.tsx` | Audio element and playback state bridge. |
| `ActionButtons` | `components/ActionButtons.tsx` | `FavoriteButton` and `StarRating` primitives. |
| `FavoriteRatingGroup` | `components/FavoriteRatingGroup.tsx` | Inline favorite + rating combo used in headers and cards. |
| `EntityHeader` | `components/EntityHeader.tsx` | Reusable header with cover, title, metadata chips, and actions. |
| `MetadataBreadcrumb` | `components/MetadataBreadcrumb.tsx` | Horizontal metadata chips with optional links. |
| `ExplicitTitle` | `components/ExplicitTitle.tsx` | Title text with explicit-content badge and blur toggle. |
| `PageState` | `components/PageState.tsx` | Loading, empty, and error states for pages. |
| `Avatar` | `components/Avatar.tsx` | User avatar with placeholder fallback. |
| `Button` | `components/ui/Button.tsx` | Button primitive. |
| `Input` | `components/ui/Input.tsx` | Text input primitive. |
| `Icon` | `components/ui/Icon.tsx` | Icon renderer. |
| `Table` | `components/ui/Table.tsx` | Generic table component. |
| `AutocompleteInput` | `components/ui/AutocompleteInput.tsx` | Autocomplete input primitive. |
| `ProgressBar` | `components/ui/ProgressBar.tsx` | Progress indicator. |
| `SongTable` | `features/songs/components/SongTable.tsx` | Opinionated song table; accepts `SongListItem` rows. |
| `TrackList` | `features/songs/components/TrackList.tsx` | Simple vertical list of tracks. |
| `AlbumList` | `features/albums/components/AlbumList.tsx` | Simple vertical list of albums. |

When adding, removing, or significantly changing a shared component, update this table.

### PlayerBar artist links

`PlayerBar` renders the current track's artists as separate clickable links. When a song has `artistEntries` (populated from the `song_artists` junction table), each entry gets its own link to `/artists/<id>`. If only the legacy single `artistId`/`artistName` fields are present, it falls back to one link. This ensures multi-artist tracks are navigable from the playbar.
