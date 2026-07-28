#!/usr/bin/env node
/**
 * Delete all Sonarly playlists and migrate playlists from a Navidrome database.
 *
 * Smart playlists are converted to Sonarly smart playlist rules when possible;
 * otherwise they fall back to a static snapshot of their evaluated tracks.
 *
 * Usage:
 *   tsx scripts/migrate-navidrome-playlists.ts [options]
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

interface Options {
  navidromeDbPath: string;
  sonarlyDbPath: string;
  dryRun: boolean;
}

interface NavidromePlaylist {
  id: string;
  name: string;
  comment: string;
  public: number;
  created_at: string;
  updated_at: string;
  owner_id: string;
  rules: Buffer | string | null;
}

interface SmartPlaylistRule {
  field: string;
  operator: string;
  value?: string | number | boolean | (string | number)[];
}

interface SmartPlaylistRuleGroup {
  all?: SmartPlaylistRule[];
  any?: SmartPlaylistRule[];
}

interface SmartPlaylistSortRandom {
  random: true;
}

interface SmartPlaylistSortField {
  field: string;
  direction: 'asc' | 'desc';
}

type SmartPlaylistSort = SmartPlaylistSortRandom | SmartPlaylistSortField;

interface SmartPlaylistRules {
  rules?: SmartPlaylistRuleGroup;
  sort?: SmartPlaylistSort[];
  limit?: number;
}

const FIELD_MAP: Record<string, string> = {
  title: 'title',
  album: 'album',
  artist: 'artist',
  albumartist: 'albumArtist',
  genre: 'genre',
  year: 'year',
  duration: 'duration',
  loved: 'loved',
  rating: 'rating',
  playcount: 'playcount',
  lastplayed: 'lastplayed',
};

const OP_MAP: Record<string, string> = {
  contains: 'contains',
  notcontains: 'notContains',
  notContains: 'notContains',
  gt: 'gt',
  lt: 'lt',
  is: 'is',
  intherange: 'inTheRange',
  inTheRange: 'inTheRange',
  notinthelast: 'notInTheLast',
  notInTheLast: 'notInTheLast',
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let navidromeDbPath = '/etc/periphery/stacks/navidrome/config/navidrome.db';
  let sonarlyDbPath = '/root/projects/sonarly/config/sonarly/data/sonarly.db';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--navidrome-db') {
      navidromeDbPath = args[++i];
    } else if (arg === '--sonarly-db') {
      sonarlyDbPath = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: tsx scripts/migrate-navidrome-playlists.ts [options]

Options:
  --navidrome-db <path>  Path to navidrome.db (default: ${navidromeDbPath})
  --sonarly-db   <path>  Path to sonarly.db   (default: ${sonarlyDbPath})
  --dry-run              Preview changes without writing to Sonarly
  -h, --help             Show this help
`);
      process.exit(0);
    }
  }

  return { navidromeDbPath, sonarlyDbPath, dryRun };
}

function openDb(path: string, readonly = false): Database.Database {
  const db = new Database(path, { readonly });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function buildUserMap(navidrome: Database.Database, sonarly: Database.Database): Map<string, string> {
  const sonarlyUsers = sonarly.prepare('SELECT id, username FROM users').all() as Array<{
    id: string;
    username: string;
  }>;
  const byUsername = new Map(sonarlyUsers.map((u) => [u.username.toLowerCase(), u.id]));

  const navidromeUsers = navidrome
    .prepare('SELECT id, user_name FROM user')
    .all() as Array<{ id: string; user_name: string }>;

  const map = new Map<string, string>();
  for (const u of navidromeUsers) {
    const sonarlyId = byUsername.get(u.user_name.toLowerCase());
    if (sonarlyId) {
      map.set(u.id, sonarlyId);
    } else {
      console.log(`  Warning: Navidrome user "${u.user_name}" not found in Sonarly; their playlists will be skipped.`);
    }
  }
  return map;
}

function buildSongMap(navidrome: Database.Database, sonarly: Database.Database): Map<string, string> {
  const activeSongs = sonarly
    .prepare('SELECT id, file_path FROM songs WHERE active = 1')
    .all() as Array<{ id: string; file_path: string }>;

  const songMap = new Map<string, string>();
  for (const s of activeSongs) {
    songMap.set(s.file_path.replace(/\\/g, '/'), s.id);
  }

  const navidromeFiles = navidrome
    .prepare('SELECT id, path FROM media_file')
    .all() as Array<{ id: string; path: string }>;

  const map = new Map<string, string>();
  let matched = 0;
  let unmatched = 0;

  for (const mf of navidromeFiles) {
    const relativePath = mf.path.replace(/\\/g, '/').replace(/^\//, '');
    let sonarlyId: string | undefined;

    sonarlyId = songMap.get(relativePath);
    if (!sonarlyId) {
      for (const [sonarlyPath, id] of songMap) {
        if (sonarlyPath.endsWith('/' + relativePath)) {
          sonarlyId = id;
          break;
        }
      }
    }

    if (sonarlyId) {
      map.set(mf.id, sonarlyId);
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(`  Matched ${matched} songs, ${unmatched} unmatched.`);
  return map;
}

function deleteAllPlaylists(sonarly: Database.Database, dryRun: boolean): void {
  if (dryRun) {
    const count = (sonarly.prepare('SELECT COUNT(*) as c FROM playlists').get() as { c: number }).c;
    console.log(`  Dry run: would delete ${count} existing playlist(s).`);
    return;
  }
  const result = sonarly.prepare('DELETE FROM playlists').run();
  console.log(`  Deleted ${result.changes} existing playlist(s).`);
}

function normalizeOperator(op: string): string | undefined {
  return OP_MAP[op] ?? OP_MAP[op.toLowerCase()];
}

function normalizeField(field: string): string | undefined {
  return FIELD_MAP[field] ?? FIELD_MAP[field.toLowerCase()];
}

function convertValue(
  operator: string,
  field: string,
  value: unknown,
): string | number | boolean | (string | number)[] {
  if (operator === 'inTheRange') {
    if (Array.isArray(value) && value.length >= 2) {
      return [Number(value[0]), Number(value[1])];
    }
    if (typeof value === 'string') {
      const parts = value.split(',').map((p) => Number(p.trim()));
      return parts;
    }
    return [0, 0];
  }

  if (operator === 'notInTheLast') {
    if (typeof value === 'number') return String(value);
    return String(value ?? '0');
  }

  if (field === 'loved') {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  if (typeof value === 'number') return value;
  return String(value ?? '');
}

interface ParsedGroup {
  all: SmartPlaylistRule[];
  any: SmartPlaylistRule[];
  convertible: boolean;
  reason?: string;
}

function parseRuleArray(items: unknown[], context: 'all' | 'any'): ParsedGroup {
  const all: SmartPlaylistRule[] = [];
  const any: SmartPlaylistRule[] = [];

  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { all: [], any: [], convertible: false, reason: 'rule is not an object' };
    }

    const obj = item as Record<string, unknown>;
    const nestedAll = obj.all;
    const nestedAny = obj.any;

    // Nested group
    if (nestedAll !== undefined || nestedAny !== undefined) {
      const nestedKey: 'all' | 'any' = nestedAll !== undefined ? 'all' : 'any';
      const nestedItems = (nestedAll ?? nestedAny) as unknown[];

      // any:[ all:[...] ] is not expressible as a flat all AND any group.
      if (context === 'any' && nestedKey === 'all') {
        return { all: [], any: [], convertible: false, reason: 'nested ALL inside ANY is not supported' };
      }

      const nested = parseRuleArray(nestedItems, nestedKey);
      if (!nested.convertible) {
        return { all: [], any: [], convertible: false, reason: nested.reason };
      }
      all.push(...nested.all);
      any.push(...nested.any);
      continue;
    }

    // Operator object: exactly one key.
    const entries = Object.entries(obj);
    if (entries.length !== 1) {
      return { all: [], any: [], convertible: false, reason: 'rule object must have exactly one operator key' };
    }

    const [op, fieldObj] = entries[0];
    const mappedOp = normalizeOperator(op);
    if (!mappedOp) {
      return { all: [], any: [], convertible: false, reason: `unsupported operator "${op}"` };
    }

    if (typeof fieldObj !== 'object' || fieldObj === null || Array.isArray(fieldObj)) {
      return { all: [], any: [], convertible: false, reason: `operator "${op}" value is not a field object` };
    }

    const fieldEntries = Object.entries(fieldObj as Record<string, unknown>);
    if (fieldEntries.length !== 1) {
      return { all: [], any: [], convertible: false, reason: `operator "${op}" must target exactly one field` };
    }

    const [field, value] = fieldEntries[0];
    const mappedField = normalizeField(field);
    if (!mappedField) {
      return { all: [], any: [], convertible: false, reason: `unsupported field "${field}"` };
    }

    const rule: SmartPlaylistRule = {
      field: mappedField,
      operator: mappedOp,
      value: convertValue(mappedOp, mappedField, value),
    };

    if (context === 'all') {
      all.push(rule);
    } else {
      any.push(rule);
    }
  }

  return { all, any, convertible: true };
}

function parseSort(sort: string): SmartPlaylistSort[] {
  const out: SmartPlaylistSort[] = [];
  for (const part of sort.split(',')) {
    const s = part.trim();
    if (!s) continue;
    if (s.toLowerCase() === 'random') {
      out.push({ random: true });
      continue;
    }
    const direction = s[0] === '-' ? 'desc' : 'asc';
    const rawField = s[0] === '+' || s[0] === '-' ? s.slice(1) : s;
    const field = normalizeField(rawField) ?? rawField;
    out.push({ field, direction });
  }
  return out;
}

function convertRules(rawRules: Buffer | string | null): {
  rules: SmartPlaylistRules;
  convertible: boolean;
  reason?: string;
} {
  if (!rawRules) {
    return { rules: {}, convertible: true };
  }

  const json = Buffer.isBuffer(rawRules) ? rawRules.toString('utf-8') : String(rawRules);
  if (!json.trim()) {
    return { rules: {}, convertible: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { rules: {}, convertible: false, reason: 'invalid JSON in rules' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { rules: {}, convertible: false, reason: 'rules root is not an object' };
  }

  const top = parsed as Record<string, unknown>;
  const result: SmartPlaylistRules = {};
  const group: SmartPlaylistRuleGroup = {};

  if (top.all !== undefined) {
    if (!Array.isArray(top.all)) {
      return { rules: {}, convertible: false, reason: '"all" must be an array' };
    }
    const parsedAll = parseRuleArray(top.all, 'all');
    if (!parsedAll.convertible) {
      return { rules: {}, convertible: false, reason: parsedAll.reason };
    }
    if (parsedAll.all.length > 0) group.all = parsedAll.all;
    if (parsedAll.any.length > 0) group.any = parsedAll.any;
  }

  if (top.any !== undefined) {
    if (!Array.isArray(top.any)) {
      return { rules: {}, convertible: false, reason: '"any" must be an array' };
    }
    const parsedAny = parseRuleArray(top.any, 'any');
    if (!parsedAny.convertible) {
      return { rules: {}, convertible: false, reason: parsedAny.reason };
    }
    // Merge with whatever we already collected from nested groups inside "all".
    if (parsedAny.all.length > 0) {
      return { rules: {}, convertible: false, reason: 'nested ALL inside ANY is not supported' };
    }
    group.any = [...(group.any ?? []), ...parsedAny.any];
  }

  if (group.all || group.any) {
    result.rules = group;
  }

  if (typeof top.sort === 'string') {
    result.sort = parseSort(top.sort);
  }

  return { rules: result, convertible: true };
}

interface MigrationSummary {
  static: { created: number; tracksInserted: number; tracksSkipped: number };
  smart: { created: number; fallback: number };
  skipped: number;
}

function migratePlaylists(
  navidrome: Database.Database,
  sonarly: Database.Database,
  userMap: Map<string, string>,
  songMap: Map<string, string>,
  dryRun: boolean,
): MigrationSummary {
  const summary: MigrationSummary = {
    static: { created: 0, tracksInserted: 0, tracksSkipped: 0 },
    smart: { created: 0, fallback: 0 },
    skipped: 0,
  };

  const playlists = navidrome
    .prepare('SELECT id, name, comment, public, created_at, updated_at, owner_id, rules FROM playlist ORDER BY name')
    .all() as NavidromePlaylist[];

  const tracks = navidrome
    .prepare('SELECT playlist_id, media_file_id FROM playlist_tracks ORDER BY id')
    .all() as Array<{ playlist_id: string; media_file_id: string }>;

  const tracksByPlaylist = new Map<string, string[]>();
  for (const t of tracks) {
    const list = tracksByPlaylist.get(t.playlist_id) ?? [];
    list.push(t.media_file_id);
    tracksByPlaylist.set(t.playlist_id, list);
  }

  const insertPlaylist = sonarly.prepare(
    `INSERT INTO playlists (id, name, description, owner_id, visibility, share_token, is_smart, rules_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertTrack = sonarly.prepare(
    'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)',
  );

  for (const pl of playlists) {
    const ownerId = userMap.get(pl.owner_id);
    if (!ownerId) {
      console.log(`  Skipping "${pl.name}" (owner not mapped).`);
      summary.skipped++;
      continue;
    }

    const visibility = pl.public ? 'public' : 'private';
    const description = pl.comment ?? '';
    const newId = randomUUID();
    const trackIds = tracksByPlaylist.get(pl.id) ?? [];

    const converted = convertRules(pl.rules);

    if (converted.convertible && converted.rules.rules) {
      if (!dryRun) {
        insertPlaylist.run(
          newId,
          pl.name,
          description,
          ownerId,
          visibility,
          null,
          1,
          JSON.stringify(converted.rules),
          pl.created_at,
          pl.updated_at,
        );
      }
      summary.smart.created++;
      console.log(`  Migrated smart playlist "${pl.name}" (${trackIds.length} evaluated tracks).`);
      continue;
    }

    // Fallback: static snapshot.
    if (!dryRun) {
      insertPlaylist.run(
        newId,
        pl.name,
        description,
        ownerId,
        visibility,
        null,
        0,
        null,
        pl.created_at,
        pl.updated_at,
      );
    }
    summary.smart.fallback++;
    summary.static.created++;

    let localInserted = 0;
    let localSkipped = 0;
    for (let i = 0; i < trackIds.length; i++) {
      const songId = songMap.get(trackIds[i]);
      if (!songId) {
        localSkipped++;
        summary.static.tracksSkipped++;
        continue;
      }
      if (!dryRun) {
        insertTrack.run(newId, songId, i);
      }
      localInserted++;
      summary.static.tracksInserted++;
    }

    const reason = converted.reason ? ` (${converted.reason})` : '';
    console.log(
      `  Migrated static playlist "${pl.name}" (${localInserted} tracks, ${localSkipped} skipped)${reason}`,
    );
  }

  return summary;
}

function printSummary(summary: MigrationSummary) {
  console.log('\n=== Playlist Migration Summary ===');
  console.log(`Smart playlists:  ${summary.smart.created} created, ${summary.smart.fallback} fallback to static`);
  console.log(`Static playlists: ${summary.static.created} created`);
  console.log(`Static tracks:    ${summary.static.tracksInserted} inserted, ${summary.static.tracksSkipped} skipped`);
  console.log(`Skipped:          ${summary.skipped}`);
}

async function main() {
  const options = parseArgs();
  console.log(`Navidrome DB: ${options.navidromeDbPath}`);
  console.log(`Sonarly DB:   ${options.sonarlyDbPath}`);
  console.log(`Mode:         ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  const navidrome = openDb(options.navidromeDbPath, true);
  const sonarly = openDb(options.sonarlyDbPath, options.dryRun);

  try {
    console.log('\n1. Mapping Navidrome users to Sonarly users...');
    const userMap = buildUserMap(navidrome, sonarly);
    console.log(`   Mapped ${userMap.size} user(s).`);

    console.log('\n2. Building song path mapping...');
    const songMap = buildSongMap(navidrome, sonarly);

    console.log('\n3. Deleting existing Sonarly playlists...');
    deleteAllPlaylists(sonarly, options.dryRun);

    console.log('\n4. Migrating playlists...');
    const summary = migratePlaylists(navidrome, sonarly, userMap, songMap, options.dryRun);
    printSummary(summary);

    if (options.dryRun) {
      console.log('\nDry run complete. No changes were written to Sonarly.');
    } else {
      console.log('\nMigration complete.');
    }
  } finally {
    navidrome.close();
    sonarly.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
