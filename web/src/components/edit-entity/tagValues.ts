// Pure helpers for the entity tag-edit modal (multi/single value parsing and
// common-value extraction). Extracted verbatim from EditEntityModal.tsx
// (audit F22, plan P10b).
import type { TagField } from './fields.js';

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const MULTI_VALUE_DELIMITERS = /\s*[,;\/]\s*|\s+&\s+|\s+feat\.\s+|\s+featuring\s+|\s+ft\.\s+/i;

function parseMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  }
  if (typeof value === 'string') {
    return value.split(MULTI_VALUE_DELIMITERS).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function getMultiValue(entity: Record<string, unknown>, key: string, fallbackKey?: string): string[] {
  const direct = entity[key];
  if (Array.isArray(direct) && direct.length > 0) return parseMultiValue(direct);
  if (fallbackKey) {
    const fallback = entity[fallbackKey];
    if (fallback !== undefined && fallback !== null) return parseMultiValue(fallback);
  }
  if (direct !== undefined && direct !== null) return parseMultiValue(direct);
  const pluralKey = `${key}s`;
  const plural = entity[pluralKey];
  if (Array.isArray(plural) && plural.length > 0) return parseMultiValue(plural);
  return [];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function initialTagValues(entity: Record<string, unknown>, fields: TagField[]): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const { key, multi } of fields) {
    if (multi) {
      next[key] = getMultiValue(entity, key);
    } else {
      const value = entity[key];
      next[key] = value === undefined || value === null ? '' : String(value);
    }
  }
  next.lyrics = entity.lyrics === undefined || entity.lyrics === null ? '' : String(entity.lyrics);
  return next;
}

function getCommonValue(entities: Record<string, unknown>[], key: string): unknown {
  if (entities.length === 0) return undefined;
  const first = entities[0][key];
  for (let i = 1; i < entities.length; i++) {
    if (entities[i][key] !== first) return undefined;
  }
  return first;
}

function getCommonArray(entities: Record<string, unknown>[], key: string, fallbackKey?: string): string[] | undefined {
  if (entities.length === 0) return undefined;
  const first = getMultiValue(entities[0], key, fallbackKey);
  for (let i = 1; i < entities.length; i++) {
    const current = getMultiValue(entities[i], key, fallbackKey);
    if (!arraysEqual(first, current)) return undefined;
  }
  return first;
}

function getCommonBoolean(entities: Record<string, unknown>[], key: string): boolean | null {
  if (entities.length === 0) return null;
  const first = entities[0][key];
  if (typeof first !== 'boolean') return null;
  for (let i = 1; i < entities.length; i++) {
    if (entities[i][key] !== first) return null;
  }
  return first;
}

function initialTagValuesForEntities(
  entities: Record<string, unknown>[],
  fields: TagField[],
  isMulti: boolean,
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const { key, multi } of fields) {
    if (multi) {
      next[key] = isMulti ? (getCommonArray(entities, key) ?? []) : getMultiValue(entities[0] ?? {}, key);
    } else {
      const value = isMulti ? getCommonValue(entities, key) : entities[0]?.[key];
      next[key] = value === undefined || value === null ? '' : String(value);
    }
  }
  const lyricsValue = isMulti ? getCommonValue(entities, 'lyrics') : entities[0]?.lyrics;
  next.lyrics = lyricsValue === undefined || lyricsValue === null ? '' : String(lyricsValue);
  return next;
}

export { parseNumber, getCommonValue, getCommonBoolean, initialTagValuesForEntities };
