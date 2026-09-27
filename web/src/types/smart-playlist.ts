// Smart-playlist rule shapes re-derived from the generated OpenAPI schema
// (audit F17, plan 10d): the server schema honestly types `operator` as
// string and the sort as one optional-field object ("field/operator
// whitelists are enforced by the rules compiler, not by this schema"), so
// the hand unions were deleted. The operator whitelist and field catalogue
// below are client-side constants the editor needs — they stay hand-written.
import type { components } from '../contract/schema.js';

export type SmartPlaylistRule = components['schemas']['SmartPlaylistRule'];
export type SmartPlaylistRules = components['schemas']['SmartPlaylistRules'];
export type SmartPlaylistRuleGroup = NonNullable<components['schemas']['SmartPlaylistRules']['rules']>;
export type SmartPlaylistSort = components['schemas']['SmartPlaylistSort'];

/** Client-side operator whitelist, mirrored by the server's rules compiler. */
export type SmartPlaylistOperator =
  | 'is'
  | 'isNot'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'inTheRange'
  | 'before'
  | 'after'
  | 'inTheLast'
  | 'notInTheLast'
  | 'inPlaylist'
  | 'notInPlaylist'
  | 'isMissing'
  | 'isPresent';

export type SmartPlaylistFieldType = 'string' | 'number' | 'date' | 'boolean';

export const SMART_PLAYLIST_FIELDS: { field: string; type: SmartPlaylistFieldType; label: string }[] = [
  { field: 'title', type: 'string', label: 'Title' },
  { field: 'album', type: 'string', label: 'Album' },
  { field: 'artist', type: 'string', label: 'Artist' },
  { field: 'albumArtist', type: 'string', label: 'Album Artist' },
  { field: 'genre', type: 'string', label: 'Genre' },
  { field: 'releaseType', type: 'string', label: 'Release type' },
  { field: 'year', type: 'number', label: 'Year' },
  { field: 'duration', type: 'number', label: 'Duration (seconds)' },
  { field: 'bitDepth', type: 'number', label: 'Bit depth' },
  { field: 'loved', type: 'boolean', label: 'Loved' },
  { field: 'rating', type: 'number', label: 'Rating' },
  { field: 'playcount', type: 'number', label: 'Play count' },
  { field: 'lastplayed', type: 'date', label: 'Last played' },
];

export function isSmartPlaylistRuleGroup(value: unknown): value is SmartPlaylistRuleGroup {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.all !== undefined && !Array.isArray(v.all)) return false;
  if (v.any !== undefined && !Array.isArray(v.any)) return false;
  return true;
}
