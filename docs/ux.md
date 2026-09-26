# The Sonarly Interface

How the web app is put together: the layout, the design language in practice, keyboard access, states, and performance behaviors. For what the features do, see [usage.md](usage.md); for the tokens and visual principles themselves, see [design-language.md](design-language.md).

## Layout model

The app is a full-height shell with four regions:

- **Sidebar (left).** Navigation (Home, Albums, Tracks, Album Artists, Artists, Genres, Years, Composers, Labels), the library selector at the top when multiple libraries exist, and your playlists (right-click or long-press a playlist for play/shuffle/edit/share/delete). On narrow screens the sidebar becomes a drawer opened from the top bar.
- **Top bar.** Logo/wordmark, the search box, and the user menu (statistics, upload, settings, logout). It stays minimal; navigation lives in the sidebar.
- **Main area.** The scrollable content region. Every page renders here; a "skip to content" link is the first focus stop.
- **Player bar (bottom, persistent).** Full-width progress scrubber, album thumbnail, centered transport (previous, play/pause, next, shuffle, repeat), and volume plus track actions on the right. Expanding it opens the Now Playing overlay — a large hero with the cover, favorite/rating controls, and Queue / Lyrics tabs.

## Design language in practice

- **Modes.** Light, dark, and OLED themes (Settings → Appearance). OLED uses pure black for the background. The default accent is mode-aware (blue in light, cyan in dark/OLED) and user-overridable.
- **Ambient color.** The player chrome tints itself from a muted dominant color sampled from the current album art — a gradient line above the player bar and a soft background wash. It is subtle by design; it never competes with the artwork.
- **Typography.** Space Grotesk for display type (page titles, the player track title), Inter for UI text, JetBrains Mono for durations, counters, and timestamps.
- **Surfaces.** Rounded cards with soft shadows for artwork; muted text for navigation; a thin accent indicator on the active sidebar item. Components use the design tokens (`--bg-primary`, `--surface`, `--accent`, …), not raw colors.

## Keyboard access

- **Media keys.** The player integrates with the browser Media Session API: play, pause, previous/next track, seek, and ±10 s skip work from OS media keys, headphones, and lock-screen controls.
- **Menus and dialogs.** Context menus and dropdowns are fully keyboard-operable: arrow keys move, Enter selects, Escape closes, and focus returns to the invoking element when the menu closes. Modals trap focus (Tab cycles inside the dialog) and close on Escape.
- **Ratings and tabs.** Star ratings respond to arrow keys; tab strips move with Left/Right.
- **Focus visibility.** Interactive controls show a visible accent focus ring; the global stylesheet enforces `color-scheme` per theme so native controls match.
- **Reduced motion.** A global `prefers-reduced-motion` dampener zeroes transitions and animations; JS-driven animations check the media query themselves.

## States

- **Loading.** Pages render skeletons shaped like the content (grid, list, or detail skeletons) instead of spinners, so layout does not jump when data arrives.
- **Empty.** Empty states say what is missing and offer the next action — e.g. a "Clear filters" button on a filtered-to-nothing list, or an upload pointer on an empty library. Copy is sentence case and plain.
- **Errors.** Errors say what happened and what to do: page-level errors render through the same state component with a retry action, and a full "Could not reach the server" screen offers Try again. If the session expires, the app bounces you to login.
- **Job feedback.** Background work (scans, ingest, organize) reports through the events feed, so long-running admin operations show progress without blocking navigation.

## Performance behaviors

- **Virtualized lists.** Long track lists and grids render through windowed virtual lists/grids — only the visible rows are in the DOM, so a 10,000-track library scrolls at the same cost as a 100-track one.
- **Code-split routes.** Every route is lazy-loaded: first paint downloads only the app shell and the current page, and per-route chunks cache independently.
- **Image discipline.** Cover art is requested at display size, and heavy panels (waveforms, lyrics editing) load on demand.
