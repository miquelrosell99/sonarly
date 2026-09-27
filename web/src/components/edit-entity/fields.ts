import type { AutocompleteField } from '../ui/AutocompleteInput.js';

export interface TagField {
  key: string;
  label: string;
  type?: 'text' | 'number';
  autocomplete?: AutocompleteField;
  primary?: boolean;
  multi?: boolean;
}

export const SONG_FIELDS: TagField[] = [
  { key: 'title', label: 'Title', primary: true },
  { key: 'album', label: 'Album', autocomplete: 'album', primary: true },
  { key: 'trackNumber', label: 'Track number', type: 'number', primary: true },
  { key: 'discNumber', label: 'Disc number', type: 'number', primary: true },
  { key: 'artist', label: 'Artist', autocomplete: 'artist', multi: true },
  { key: 'genre', label: 'Genre', autocomplete: 'genre', multi: true },
  { key: 'year', label: 'Year', type: 'number' },
];

export const ALBUM_FIELDS: TagField[] = [
  { key: 'title', label: 'Title', primary: true },
  { key: 'albumArtist', label: 'Album artist', autocomplete: 'albumArtist', primary: true, multi: true },
  { key: 'year', label: 'Year', type: 'number', primary: true },
  { key: 'releaseType', label: 'Release type', autocomplete: 'releaseType' },
];
