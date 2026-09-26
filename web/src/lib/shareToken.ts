export function getShareToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('shareToken') ?? undefined;
}

/**
 * Append the current URL's shareToken (if any) so shared-link views stay
 * authorized. `param` names the query key the target endpoint reads:
 * playlist endpoints (`/api/playlists/{id}`, cover grid) read `shareToken`,
 * while the playback media endpoints (`/api/stream`, `/api/cover-art`)
 * read `share` — the param the stream route established.
 */
export function withShareToken(path: string, param = 'shareToken'): string {
  const token = getShareToken();
  if (!token) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${param}=${encodeURIComponent(token)}`;
}
