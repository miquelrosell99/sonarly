import { useState } from 'react';
import type { SmartPlaylistRules } from '@sonarly/shared';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { SmartPlaylistEditor } from '../features/playlists/index.js';

type EntityType = 'song' | 'album' | 'playlist';

interface EditEntityModalProps {
  open: boolean;
  entityType: EntityType;
  entity: Record<string, unknown>;
  onClose: () => void;
  onSave: (patchedEntity: Record<string, unknown>) => void;
  onDelete: () => void;
  saving?: boolean;
  deleting?: boolean;
}

const TAG_FIELDS: { key: string; label: string; type?: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'albumArtist', label: 'Album artist' },
  { key: 'trackNumber', label: 'Track number', type: 'number' },
  { key: 'discNumber', label: 'Disc number', type: 'number' },
  { key: 'genre', label: 'Genre' },
  { key: 'year', label: 'Year', type: 'number' },
];

const VISIBILITY_OPTIONS = ['private', 'shared', 'public', 'link'] as const;

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function initialTagValues(entity: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const { key } of TAG_FIELDS) {
    const value = entity[key];
    next[key] = value === undefined || value === null ? '' : String(value);
  }
  return next;
}

export function EditEntityModal({
  open,
  entityType,
  entity,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
}: EditEntityModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    entityType === 'playlist'
      ? {
          name: String(entity.name ?? ''),
          visibility: String(entity.visibility ?? 'private'),
        }
      : initialTagValues(entity),
  );
  const [explicit, setExplicit] = useState(() => Boolean(entity.explicit));
  const [rules, setRules] = useState<SmartPlaylistRules | undefined>(() =>
    entityType === 'playlist' ? (entity.rules as SmartPlaylistRules | undefined) ?? undefined : undefined,
  );

  if (!open) return null;

  const handleSave = () => {
    const patched: Record<string, unknown> = { ...entity };

    if (entityType === 'playlist') {
      patched.name = values.name;
      patched.visibility = values.visibility;
      if (entity.isSmart) {
        patched.rules = rules;
      }
    } else {
      for (const { key, type } of TAG_FIELDS) {
        const raw = values[key];
        if (type === 'number') {
          patched[key] = parseNumber(raw);
        } else {
          patched[key] = raw === '' ? undefined : raw;
        }
      }
      patched.explicit = explicit;
    }

    onSave(patched);
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this?')) {
      onDelete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-entity-title">
      <div className="w-full max-w-lg border border-rule bg-surface p-6 shadow-lg">
        <h3 id="edit-entity-title" className="mb-4 text-lg font-semibold">Edit {entityType}</h3>

        <div className="space-y-3">
          {entityType === 'playlist' ? (
            <>
              <Input
                id="edit-name"
                value={values.name ?? ''}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
                placeholder="Name"
                aria-label="Name"
              />
              <select
                id="edit-visibility"
                value={values.visibility ?? 'private'}
                onChange={(e) => setValues({ ...values, visibility: e.target.value })}
                className="input w-full"
                aria-label="Visibility"
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {entity.isSmart && (
                <SmartPlaylistEditor initialRules={rules} onChange={setRules} />
              )}
            </>
          ) : (
            <>
              {TAG_FIELDS.map(({ key, label, type }) => (
                <Input
                  key={key}
                  id={`edit-${key}`}
                  type={type ?? 'text'}
                  value={values[key] ?? ''}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  placeholder={label}
                  aria-label={label}
                />
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={explicit}
                  onChange={(e) => setExplicit(e.target.checked)}
                />
                Explicit content
              </label>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={deleting || saving}
            className="text-danger"
          >
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || deleting}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
