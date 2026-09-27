import type { Song } from '../types';

export type SongWithNames = Song & {
  artistName?: string;
  albumName?: string;
  albumArtistName?: string;
};

/**
 * How the now-playing route mounts an entity page underneath the overlay
 * (P5 follow-up). Wouter only exposes the matched route's params, so under
 * `/now-playing/:context/:contextId/:songId` the detail pages never receive
 * their own `:id` and rendered "not found" forever — guests saw exactly
 * that. The route threads the contextId explicitly instead.
 *
 * `id` is the raw URL segment (still percent-encoded), exactly what
 * `useParams` would return on the page's own route — the pages keep owning
 * any decoding. `fetchEnabled` mirrors the route's disabled-while-covered
 * logic so the zero-request refresh contract survives the real mount: while
 * the player store already covers the URL, the covered page must not
 * re-download its context; guests (no overlay) always fetch.
 */
export interface UnderlayParams {
  id: string;
  fetchEnabled: boolean;
}
