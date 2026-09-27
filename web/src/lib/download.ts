// Download helpers (2.2): the ZIP pack endpoint and the single-track
// download URL, with the share-token threading the stream routes use.
// Errors surface through the notification convention — downloadSongs toasts
// and resolves (fire-and-forget from menu clicks), while downloadTrackUrl
// is a plain URL for anchor-based saves.
import { getShareToken } from './shareToken.js';
import { notify } from '../contexts/NotificationContext.js';

const API_BASE = '/api';

/**
 * The single-track download target: /api/stream/{id}?download=1 answers the
 * original file with a Content-Disposition attachment. The share token (when
 * present) rides the `share` param, exactly like streamUrl.
 */
export function downloadTrackUrl(id: string, shareToken?: string): string {
  const token = shareToken ?? getShareToken();
  const base = `${API_BASE}/stream/${encodeURIComponent(id)}?download=1`;
  return token ? `${base}&share=${encodeURIComponent(token)}` : base;
}

/** Extract filename="..." from a Content-Disposition header. */
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="([^"]*)"/.exec(header);
  const name = match?.[1]?.trim();
  return name || fallback;
}

/** Trigger a browser save for a URL (single-track downloads). */
export function saveUrl(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Pack `ids` into a ZIP via POST /api/download and save the response through
 * an anchor, honoring the server-provided Content-Disposition filename.
 * Optional shareToken authorizes anonymous share-link viewers (the linked
 * playlist must have downloads enabled); when omitted, the URL's token (if
 * any) applies. Failures toast through notify and resolve — menu callers
 * fire-and-forget.
 */
export async function downloadSongs(ids: string[], shareToken?: string): Promise<void> {
  if (ids.length === 0) return;
  const token = shareToken ?? getShareToken();
  const path = token
    ? `${API_BASE}/download?shareToken=${encodeURIComponent(token)}`
    : `${API_BASE}/download`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songIds: ids }),
    });
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Download failed', 'error');
    return;
  }
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Not a JSON body; keep the status message.
    }
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sonarly:unauthorized'));
    }
    notify(message, 'error');
    return;
  }

  try {
    const blob = await res.blob();
    const filename = filenameFromDisposition(
      res.headers.get('Content-Disposition'),
      'sonarly.zip',
    );
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Download failed', 'error');
  }
}
