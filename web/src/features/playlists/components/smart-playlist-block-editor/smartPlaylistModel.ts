import type {
  SmartPlaylistFieldType,
  SmartPlaylistRule,
  SmartPlaylistRuleGroup,
  SmartPlaylistSort,
} from '../../../../types';
import { SMART_PLAYLIST_FIELDS } from '../../../../types';

export const STRING_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

export const NUMBER_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal to' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal to' },
  { value: 'inTheRange', label: 'between' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

export const DATE_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'gt', label: 'after' },
  { value: 'lt', label: 'before' },
  { value: 'inTheRange', label: 'between' },
  { value: 'inTheLast', label: 'in the last (days)' },
  { value: 'notInTheLast', label: 'not in the last (days)' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

export const BOOLEAN_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

export function operatorsForType(type: SmartPlaylistFieldType): { value: SmartPlaylistRule['operator']; label: string }[] {
  switch (type) {
    case 'boolean':
      return BOOLEAN_OPERATORS;
    case 'number':
      return NUMBER_OPERATORS;
    case 'date':
      return DATE_OPERATORS;
    case 'string':
    default:
      return STRING_OPERATORS;
  }
}

export function defaultValueForType(type: SmartPlaylistFieldType): string | number | boolean {
  switch (type) {
    case 'boolean':
      return true;
    case 'number':
      return 0;
    case 'date':
      return '';
    case 'string':
    default:
      return '';
  }
}

export function defaultOperatorForType(type: SmartPlaylistFieldType): SmartPlaylistRule['operator'] {
  switch (type) {
    case 'boolean':
      return 'is';
    case 'number':
      return 'gt';
    case 'date':
      return 'inTheLast';
    case 'string':
    default:
      return 'contains';
  }
}

export function getFieldType(field: string): SmartPlaylistFieldType {
  return SMART_PLAYLIST_FIELDS.find((f) => f.field === field)?.type ?? 'string';
}

export function isAutocompleteField(field: string): field is 'artist' | 'album' | 'albumArtist' | 'genre' | 'releaseType' {
  return field === 'artist' || field === 'album' || field === 'albumArtist' || field === 'genre' || field === 'releaseType';
}

export function defaultRule(): SmartPlaylistRule {
  return { field: 'title', operator: 'contains', value: '' };
}

export function defaultSort(): SmartPlaylistSort {
  return { field: 'title', direction: 'asc' };
}

export function emptyGroup(): SmartPlaylistRuleGroup {
  return { all: [defaultRule()] };
}

export function ensureDefaultSort(sort: SmartPlaylistSort[] | undefined): SmartPlaylistSort[] {
  return sort && sort.length > 0 ? sort : [defaultSort()];
}
