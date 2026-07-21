import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from './Button.js';
import { Input } from './Input.js';

interface SongDetail {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
}

interface TagForm {
  title: string;
  artist: string;
  album: string;
  trackNumber: string;
  year: string;
  genre: string;
}

export function TagEditor({
  songId,
  onClose,
  onSaved,
}: {
  songId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [tags, setTags] = useState<TagForm>({
    title: '',
    artist: '',
    album: '',
    trackNumber: '',
    year: '',
    genre: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<{ song: SongDetail }>(`/songs/${songId}`)
      .then((r) => {
        const s = r.song;
        setTags({
          title: s.title ?? '',
          artist: s.artistName ?? '',
          album: s.albumName ?? '',
          trackNumber: s.trackNumber?.toString() ?? '',
          year: s.year?.toString() ?? '',
          genre: s.genre ?? '',
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load song'))
      .finally(() => setLoading(false));
  }, [songId]);

  const save = async () => {
    setSaving(true);
    setError(null);

    const parseIntField = (value: string): number | undefined => {
      if (!value.trim()) return undefined;
      if (!/^-?\d+$/.test(value.trim())) return Number.NaN;
      return parseInt(value.trim(), 10);
    };
    const trackNumber = parseIntField(tags.trackNumber);
    const year = parseIntField(tags.year);
    if (Number.isNaN(trackNumber) || Number.isNaN(year)) {
      setError('Track number and year must be valid integers');
      setSaving(false);
      return;
    }

    try {
      await api(`/songs/${songId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          title: tags.title,
          artist: tags.artist || undefined,
          album: tags.album || undefined,
          trackNumber,
          year,
          genre: tags.genre || undefined,
        }),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const fields: { key: keyof TagForm; label: string; type?: string }[] = [
    { key: 'title', label: 'Title' },
    { key: 'artist', label: 'Artist' },
    { key: 'album', label: 'Album' },
    { key: 'trackNumber', label: 'Track number', type: 'number' },
    { key: 'year', label: 'Year', type: 'number' },
    { key: 'genre', label: 'Genre' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md border border-gray-200 bg-white p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Edit Tags</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : (
          <>
            {error && <p className="mb-3 text-sm text-danger">{error}</p>}
            <div className="space-y-3">
              {fields.map(({ key, label, type }) => (
                <Input
                  key={key}
                  type={type ?? 'text'}
                  placeholder={label}
                  value={tags[key]}
                  onChange={(e) => setTags({ ...tags, [key]: e.target.value })}
                />
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                Save
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
