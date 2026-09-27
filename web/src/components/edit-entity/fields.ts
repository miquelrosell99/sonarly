import type { AutocompleteField } from '../ui/AutocompleteInput.js';

export interface TagField {
  key: string;
  label: string;
  type?: 'text' | 'number';
  autocomplete?: AutocompleteField;
  multi?: boolean;
  /** Editor section the field renders in. */
  group?: 'core' | 'artists' | 'classification';
  /** Render across the full grid row. */
  wide?: boolean;
}

// `group` drives the editor's section hierarchy (core metadata / artists &
// credits / classification); `multi` fields accept ordered string arrays and
// are rendered as reorderable chips.
export const SONG_FIELDS: TagField[] = [
  { key: 'title', label: 'Title', group: 'core', wide: true },
  { key: 'album', label: 'Album', autocomplete: 'album', group: 'core', wide: true },
  { key: 'trackNumber', label: 'Track number', type: 'number', group: 'core' },
  { key: 'discNumber', label: 'Disc number', type: 'number', group: 'core' },
  { key: 'artist', label: 'Artist', autocomplete: 'artist', multi: true, group: 'artists' },
  { key: 'genre', label: 'Genre', autocomplete: 'genre', multi: true, group: 'classification' },
  { key: 'year', label: 'Year', type: 'number', group: 'classification' },
];

export const ALBUM_FIELDS: TagField[] = [
  { key: 'title', label: 'Title', group: 'core', wide: true },
  { key: 'albumArtist', label: 'Album artist', autocomplete: 'albumArtist', multi: true, group: 'artists' },
  { key: 'year', label: 'Year', type: 'number', group: 'core' },
  { key: 'releaseType', label: 'Release type', autocomplete: 'releaseType', group: 'classification' },
];
