// Payload builder for the song tag-edit modal (FF4).
//
// Wire shape (PUT /api/songs/{id}/tags and PUT /api/songs/tags), per the
// server contract (SongTags in server/api/openapi.yaml, mirrored by
// validateSongTags in server/internal/modules/tags):
//
//   - Allowlist: title, artist, album, albumArtist, trackNumber,
//     discNumber, genre, year, explicit, lyrics. `artist`, `albumArtist`
//     and `genre` accept string | string[]; `genre` is resolved server-side
//     by full path ("Rock > Indie") or name (NOCASE), creating the genre
//     when unknown.
//   - Unknown keys are rejected with 400 "Unknown tag field". `genreId`
//     exists on song/album DTOs as a read-model field (identity, separate
//     from names) and as a query filter — never as a writable tag key.
//
// The builder hard-guarantees id-shaped keys (genreId, filePath, id, …)
// can never leak into the request body from a shared DTO.
export interface SongPatchField {
  key: string;
  type?: 'text' | 'number';
  multi?: boolean;
}

export interface BuildSongPatchInput {
  values: Record<string, string | string[]>;
  fields: SongPatchField[];
  isMulti: boolean;
  touchedFields: ReadonlySet<string>;
  explicit: boolean | null;
}

/** Keys the server's tag validator rejects outright. */
const FORBIDDEN_BODY_KEYS = new Set(['id', 'filePath', 'checksum', 'genreId', 'genreIds', 'mtime', 'libraryId']);

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Build the PUT /api/songs/{id}/tags (or PUT /api/songs/tags `tags`) body.
 * `undefined` values are dropped by JSON.stringify, which is how "leave this
 * tag untouched" is expressed on the wire.
 */
export function buildSongTagsPatch(input: BuildSongPatchInput): Record<string, unknown> {
  const patched: Record<string, unknown> = {};

  for (const { key, type, multi } of input.fields) {
    if (input.isMulti && !input.touchedFields.has(key)) continue;
    const raw = input.values[key];
    if (type === 'number') {
      patched[key] = parseNumber(String(raw));
    } else if (multi) {
      // Genre (and artists) arrive as pill arrays; the server accepts
      // string | string[]. Empty means "leave untouched" (undefined is
      // dropped by JSON.stringify) — never send `genreId`, which the
      // validator rejects as an unknown tag field.
      const arr = Array.isArray(raw) ? raw : [];
      patched[key] = arr.length > 0 ? arr : undefined;
    } else if (key === 'releaseType') {
      // Send null (not undefined) so clearing the field persists as NULL.
      patched[key] = raw === '' ? null : raw;
    } else {
      patched[key] = raw === '' ? undefined : raw;
    }
  }

  if (!input.isMulti || input.touchedFields.has('lyrics')) {
    patched.lyrics = input.values.lyrics === '' || input.values.lyrics === undefined ? undefined : input.values.lyrics;
  }
  if (!input.isMulti || input.touchedFields.has('explicit')) {
    patched.explicit = input.explicit === null ? undefined : input.explicit;
  }

  for (const key of Object.keys(patched)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      delete patched[key];
    }
  }
  return patched;
}
