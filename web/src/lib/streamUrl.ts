import { getShareToken } from './shareToken.js';

// /rest/stream.view needs a session; anonymous share-link viewers use
// the token-scoped /api/stream endpoint instead, which reads the token
// under the `share` param. The gapless preloader uses this too so both
// audio elements always request identical URLs.
export function streamUrl(songId: string): string {
  const shareToken = getShareToken();
  return shareToken
    ? `/api/stream/${songId}?share=${encodeURIComponent(shareToken)}`
    : `/rest/stream.view?id=${songId}`;
}
