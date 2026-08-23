export function getShareToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('shareToken') ?? undefined;
}

/** Append the current URL's shareToken (if any) so shared-link views stay authorized. */
export function withShareToken(path: string): string {
  const token = getShareToken();
  if (!token) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}shareToken=${encodeURIComponent(token)}`;
}
