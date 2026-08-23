const API_BASE = '/api';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...headers,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Not a JSON body; surface the raw text.
    }
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sonarly:unauthorized'));
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
