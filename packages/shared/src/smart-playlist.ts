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

export type SmartPlaylistSortDirection = 'asc' | 'desc';

export type SmartPlaylistSort =
  | { field: string; direction: SmartPlaylistSortDirection }
  | { random: true };

export interface SmartPlaylistRule {
  field: string;
  operator: SmartPlaylistOperator;
  value?: string | number | boolean | string[] | number[];
}

export interface SmartPlaylistRuleGroup {
  all?: SmartPlaylistRule[];
  any?: SmartPlaylistRule[];
}

export interface SmartPlaylistRules {
  rules?: SmartPlaylistRuleGroup;
  sort?: SmartPlaylistSort[];
  limit?: number;
  limitPercent?: number;
}

export type SmartPlaylistFieldType = 'string' | 'number' | 'date' | 'boolean';

export const SMART_PLAYLIST_FIELDS: { field: string; type: SmartPlaylistFieldType; label: string }[] = [
  { field: 'title', type: 'string', label: 'Title' },
  { field: 'album', type: 'string', label: 'Album' },
  { field: 'artist', type: 'string', label: 'Artist' },
  { field: 'albumArtist', type: 'string', label: 'Album Artist' },
  { field: 'genre', type: 'string', label: 'Genre' },
  { field: 'year', type: 'number', label: 'Year' },
  { field: 'duration', type: 'number', label: 'Duration (seconds)' },
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
