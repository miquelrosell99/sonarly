import type Database from 'better-sqlite3';
import type {
  SmartPlaylistRules,
  SmartPlaylistRule,
  SmartPlaylistRuleGroup,
  SmartPlaylistSort,
} from '@sonarly/shared';

interface CompilerContext {
  params: unknown[];
  joins: Set<string>;
  userId: string;
}

export interface CompiledSmartPlaylist {
  sql: string;
  params: unknown[];
  songCountSql: string;
  songCountParams: unknown[];
}

const STRING_OPERATORS = new Set<SmartPlaylistRule['operator']>([
  'is',
  'isNot',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
]);

const NUMBER_OPERATORS = new Set<SmartPlaylistRule['operator']>([
  'is',
  'isNot',
  'gt',
  'gte',
  'lt',
  'lte',
  'inTheRange',
]);

const DATE_OPERATORS = new Set<SmartPlaylistRule['operator']>([
  'before',
  'after',
  'inTheLast',
  'notInTheLast',
]);

const BOOLEAN_FIELDS = new Set(['loved']);
const USER_FIELDS = new Set(['loved', 'rating', 'playcount', 'lastplayed']);

function fieldColumn(field: string): { expr: string; needsJoin: string | null; isUserField: boolean } {
  switch (field) {
    case 'title':
      return { expr: 's.title', needsJoin: null, isUserField: false };
    case 'album':
      return { expr: 'a.name', needsJoin: 'albums', isUserField: false };
    case 'artist':
      return { expr: 'ar.name', needsJoin: 'artist', isUserField: false };
    case 'albumArtist':
      return { expr: 'aar.name', needsJoin: 'albumArtist', isUserField: false };
    case 'genre':
      return { expr: 'g.name', needsJoin: 'genre', isUserField: false };
    case 'year':
      return { expr: 's.year', needsJoin: null, isUserField: false };
    case 'duration':
      return { expr: 's.duration', needsJoin: null, isUserField: false };
    case 'loved':
      return { expr: 'COALESCE(us.starred, 0)', needsJoin: 'userSongs', isUserField: true };
    case 'rating':
      return { expr: 'us.rating', needsJoin: 'userSongs', isUserField: true };
    case 'playcount':
      return { expr: 'COALESCE(us.play_count, 0)', needsJoin: 'userSongs', isUserField: true };
    case 'lastplayed':
      return { expr: 'us.last_played', needsJoin: 'userSongs', isUserField: true };
    default:
      return { expr: 's.title', needsJoin: null, isUserField: false };
  }
}

function ensureJoin(ctx: CompilerContext, join: string | null): void {
  if (!join) return;
  ctx.joins.add(join);
  if (join === 'albumArtist') {
    ctx.joins.add('albums');
  }
}

function pushParam(ctx: CompilerContext, value: unknown): string {
  ctx.params.push(value);
  return '?';
}

function formatLike(pattern: string, operator: SmartPlaylistRule['operator']): string {
  const escaped = pattern.replace(/[%_]/g, '\\$&');
  switch (operator) {
    case 'contains':
    case 'notContains':
      return `%${escaped}%`;
    case 'startsWith':
      return `${escaped}%`;
    case 'endsWith':
      return `%${escaped}`;
    default:
      return escaped;
  }
}

function compileRule(ctx: CompilerContext, rule: SmartPlaylistRule): string {
  const { expr, needsJoin, isUserField } = fieldColumn(rule.field);
  ensureJoin(ctx, needsJoin);

  if (rule.operator === 'isMissing') {
    if (isUserField) {
      return `(us.user_id IS NULL OR ${expr} IS NULL)`;
    }
    return `${expr} IS NULL`;
  }

  if (rule.operator === 'isPresent') {
    if (isUserField) {
      return `(us.user_id IS NOT NULL AND ${expr} IS NOT NULL)`;
    }
    return `${expr} IS NOT NULL`;
  }

  if (rule.operator === 'inPlaylist' || rule.operator === 'notInPlaylist') {
    const placeholder = pushParam(ctx, String(rule.value ?? ''));
    const subquery = `EXISTS (SELECT 1 FROM playlist_songs ps WHERE ps.playlist_id = ${placeholder} AND ps.song_id = s.id)`;
    return rule.operator === 'inPlaylist' ? subquery : `NOT ${subquery}`;
  }

  if (BOOLEAN_FIELDS.has(rule.field)) {
    const wanted = rule.value === true || rule.value === 'true' || rule.value === 1 || rule.value === '1' ? 1 : 0;
    const placeholder = pushParam(ctx, wanted);
    const op = rule.operator === 'isNot' ? '!=' : '=';
    return `${expr} ${op} ${placeholder}`;
  }

  if (STRING_OPERATORS.has(rule.operator)) {
    const raw = String(rule.value ?? '');
    const likeValue = formatLike(raw, rule.operator);
    const placeholder = pushParam(ctx, likeValue);
    const collate = 'COLLATE NOCASE';
    switch (rule.operator) {
      case 'is':
        return `${expr} = ${placeholder} ${collate}`;
      case 'isNot':
        return `${expr} != ${placeholder} ${collate}`;
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        return `${expr} LIKE ${placeholder} ESCAPE '\\' ${collate}`;
      case 'notContains':
        return `(${expr} IS NULL OR ${expr} NOT LIKE ${placeholder} ESCAPE '\\' ${collate})`;
      default:
        return '1=1';
    }
  }

  if (NUMBER_OPERATORS.has(rule.operator)) {
    if (rule.operator === 'inTheRange') {
      const [min, max] = Array.isArray(rule.value) && rule.value.length >= 2
        ? [Number(rule.value[0]), Number(rule.value[1])]
        : [0, 0];
      const minPlaceholder = pushParam(ctx, min);
      const maxPlaceholder = pushParam(ctx, max);
      return `${expr} BETWEEN ${minPlaceholder} AND ${maxPlaceholder}`;
    }
    const num = Number(rule.value ?? 0);
    const placeholder = pushParam(ctx, num);
    switch (rule.operator) {
      case 'is':
        return `${expr} = ${placeholder}`;
      case 'isNot':
        return `(${expr} IS NULL OR ${expr} != ${placeholder})`;
      case 'gt':
        return `${expr} > ${placeholder}`;
      case 'gte':
        return `${expr} >= ${placeholder}`;
      case 'lt':
        return `${expr} < ${placeholder}`;
      case 'lte':
        return `${expr} <= ${placeholder}`;
      default:
        return '1=1';
    }
  }

  if (DATE_OPERATORS.has(rule.operator)) {
    if (rule.operator === 'inTheLast' || rule.operator === 'notInTheLast') {
      const raw = typeof rule.value === 'string' ? rule.value : String(rule.value ?? '0');
      const days = Math.max(0, parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0);
      if (rule.operator === 'inTheLast') {
        return `datetime(${expr}) >= datetime('now', '-${days} days')`;
      }
      return `(${expr} IS NULL OR datetime(${expr}) < datetime('now', '-${days} days'))`;
    }
    const iso = typeof rule.value === 'string' ? rule.value : new Date().toISOString();
    const placeholder = pushParam(ctx, iso);
    const op = rule.operator === 'before' ? '<' : '>';
    return `datetime(${expr}) ${op} datetime(${placeholder})`;
  }

  return '1=1';
}

function compileRuleGroup(ctx: CompilerContext, group: SmartPlaylistRuleGroup): string {
  const parts: string[] = [];
  if (group.all && group.all.length > 0) {
    const allParts = group.all.map((r) => compileRule(ctx, r));
    parts.push(`(${allParts.join(' AND ')})`);
  }
  if (group.any && group.any.length > 0) {
    const anyParts = group.any.map((r) => compileRule(ctx, r));
    parts.push(`(${anyParts.join(' OR ')})`);
  }
  if (parts.length === 0) return '1=1';
  return parts.join(' AND ');
}

function buildSortClause(ctx: CompilerContext, sort: SmartPlaylistSort[]): string {
  const clauses: string[] = [];
  for (const s of sort) {
    if ('random' in s) {
      clauses.push('RANDOM()');
      continue;
    }
    const { expr, needsJoin } = fieldColumn(s.field);
    ensureJoin(ctx, needsJoin);
    const direction = s.direction === 'desc' ? 'DESC' : 'ASC';
    clauses.push(`${expr} ${direction}`);
  }
  return clauses.length > 0 ? `ORDER BY ${clauses.join(', ')}` : '';
}

function buildJoins(joins: Set<string>): string {
  const clauses: string[] = [];
  if (joins.has('albums')) {
    clauses.push('LEFT JOIN albums a ON a.id = s.album_id');
  }
  if (joins.has('artist')) {
    clauses.push('LEFT JOIN artists ar ON ar.id = s.artist_id');
  }
  if (joins.has('albumArtist')) {
    clauses.push('LEFT JOIN artists aar ON aar.id = a.artist_id');
  }
  if (joins.has('userSongs')) {
    clauses.push('LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?');
  }
  if (joins.has('genre')) {
    clauses.push('LEFT JOIN genres g ON g.id = s.genre_id');
  }
  return clauses.join(' ');
}

function normalizeRules(rules: SmartPlaylistRules | undefined): SmartPlaylistRules {
  return rules ?? {};
}

function computeLimit(
  db: Database.Database,
  rules: SmartPlaylistRules,
  countSql: string,
  countParams: unknown[],
): number | undefined {
  if (rules.limitPercent !== undefined && rules.limitPercent > 0) {
    const row = db.prepare(countSql).get(...countParams) as { count: number } | undefined;
    const total = row?.count ?? 0;
    return Math.max(1, Math.ceil(total * (rules.limitPercent / 100)));
  }
  if (rules.limit !== undefined && rules.limit > 0) {
    return rules.limit;
  }
  return undefined;
}

export function compileSmartPlaylist(
  db: Database.Database,
  rules: SmartPlaylistRules | undefined,
  userId: string,
): CompiledSmartPlaylist {
  const normalized = normalizeRules(rules);
  const ctx: CompilerContext = { params: [], joins: new Set(), userId };
  let where = '1=1';
  if (normalized.rules && (normalized.rules.all || normalized.rules.any)) {
    where = compileRuleGroup(ctx, normalized.rules);
  }

  const orderBy = normalized.sort && normalized.sort.length > 0 ? buildSortClause(ctx, normalized.sort) : '';
  const joins = buildJoins(ctx.joins);

  const userIdParam = ctx.joins.has('userSongs') ? [userId] : [];
  const baseWhereParams = [...ctx.params];
  // Joins appear before WHERE, so user_id bind must precede WHERE parameters.
  const countParams = [...userIdParam, ...baseWhereParams];
  const activeWhere = `s.active = 1 AND ${where}`;
  const countSql = `SELECT COUNT(DISTINCT s.id) as count FROM songs s ${joins} WHERE ${activeWhere}`;

  const limit = computeLimit(db, normalized, countSql, countParams);

  const selectParams = [...userIdParam, ...baseWhereParams];
  const sql = [
    'SELECT DISTINCT s.id FROM songs s',
    joins,
    'WHERE',
    activeWhere,
    orderBy,
    limit !== undefined ? `LIMIT ${limit}` : '',
  ].filter(Boolean).join(' ');

  return { sql, params: selectParams, songCountSql: countSql, songCountParams: countParams };
}
