#!/usr/bin/env node
/**
 * Migrates user data from a Navidrome SQLite database to Sonarly.
 *
 * What is migrated:
 *   - Users (usernames, admin flag; passwords are reset to random values)
 *   - Song ratings, play counts, last-played dates, and favorites (annotations on media_file)
 *   - Album and artist favorites and ratings (annotations on album/artist)
 *   - Listening history / scrobbles
 *   - Playlists and their tracks (smart playlists are migrated as static snapshots)
 *
 * What is NOT migrated:
 *   - Passwords (Navidrome hashes are not bcrypt-compatible)
 *   - Bookmarks / playback positions
 *   - Radio stations, shares, transcoding settings
 *   - Smart playlist rules (only the evaluated track list is kept)
 *
 * The script matches Navidrome media files to Sonarly songs by relative file path.
 * Sonarly must already have scanned the same music library before running this script.
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

interface Options {
  navidromeDbPath: string;
  sonarlyDbPath: string;
  dryRun: boolean;
}

interface MigrationSummary {
  users: { created: number; updated: number; skipped: number };
  songs: { matched: number; unmatched: number };
  albums: { matched: number; unmatched: number };
  artists: { matched: number; unmatched: number };
  userSongs: { inserted: number; updated: number };
  userAlbums: { inserted: number; updated: number };
  userArtists: { inserted: number; updated: number };
  scrobbles: { inserted: number; skippedNoSong: number; skippedNoUser: number };
  playlists: { created: number; tracksInserted: number; tracksSkipped: number };
}

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
      console.log(`Usage: tsx scripts/migrate-navidrome.ts [options]

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

function isoFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function randomPasswordHash(): string {
  // Generate a bcrypt hash of a random UUID. The user must reset the password.
  return bcrypt.hashSync(randomUUID(), 12);
}

function openDb(path: string, readonly = false): Database.Database {
  const db = new Database(path, { readonly });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrateUsers(
  navidrome: Database.Database,
  sonarly: Database.Database,
  dryRun: boolean,
): { summary: MigrationSummary['users']; userIdMap: Map<string, string> } {
  const summary = { created: 0, updated: 0, skipped: 0 };
  const userIdMap = new Map<string, string>();

  const existingUsers = sonarly.prepare('SELECT id, username FROM users').all() as Array<{ id: string; username: string }>;
  const existingByUsername = new Map(existingUsers.map((u) => [u.username.toLowerCase(), u.id]));

  const navidromeUsers = navidrome.prepare('SELECT id, user_name, is_admin FROM user').all() as Array<{
    id: string;
    user_name: string;
    is_admin: number;
  }>;

  const insertUser = sonarly.prepare(
    'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
  );

  for (const ndUser of navidromeUsers) {
    const username = ndUser.user_name;
    const existingId = existingByUsername.get(username.toLowerCase());

    if (existingId) {
      userIdMap.set(ndUser.id, existingId);
      summary.updated++;
      if (!dryRun) {
        sonarly
          .prepare('UPDATE users SET is_admin = ? WHERE id = ?')
          .run(ndUser.is_admin ? 1 : 0, existingId);
      }
      console.log(`  User "${username}" already exists in Sonarly; keeping password, updating admin flag.`);
      continue;
    }

    const newId = randomUUID();
    userIdMap.set(ndUser.id, newId);
    summary.created++;
    if (!dryRun) {
      insertUser.run(newId, username, randomPasswordHash(), ndUser.is_admin ? 1 : 0);
    }
    console.log(`  Created user "${username}" (password reset required).`);
  }

  return { summary, userIdMap };
}

function buildSongMapping(
  navidrome: Database.Database,
  sonarly: Database.Database,
): { map: Map<string, string>; matched: number; unmatched: number } {
  const activeSongs = sonarly
    .prepare('SELECT id, file_path FROM songs WHERE active = 1')
    .all() as Array<{ id: string; file_path: string }>;

  const songMap = new Map<string, string>(); // relative path -> sonarly song id
  for (const s of activeSongs) {
    // Normalize Sonarly path to a relative path by stripping any leading prefix.
    // We keep the path as-is; matching is done by suffix later.
    const normalized = s.file_path.replace(/\\/g, '/');
    songMap.set(normalized, s.id);
  }

  const navidromeFiles = navidrome
    .prepare('SELECT id, path FROM media_file')
    .all() as Array<{ id: string; path: string }>;

  const map = new Map<string, string>(); // navidrome media_file_id -> sonarly song id
  let matched = 0;
  let unmatched = 0;

  for (const mf of navidromeFiles) {
    const relativePath = mf.path.replace(/\\/g, '/').replace(/^\//, '');
    let sonarlyId: string | undefined;

    // Try exact relative path match first.
    sonarlyId = songMap.get(relativePath);

    // Then try suffix match (Navidrome paths are relative, Sonarly paths are absolute).
    if (!sonarlyId) {
      for (const [sonarlyPath, id] of songMap) {
        if (sonarlyPath === relativePath || sonarlyPath.endsWith('/' + relativePath)) {
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
      if (unmatched <= 5) {
        console.log(`    Warning: no Sonarly song for Navidrome path "${mf.path}"`);
      }
    }
  }

  if (unmatched > 5) {
    console.log(`    ... and ${unmatched - 5} more unmatched songs.`);
  }

  return { map, matched, unmatched };
}

function buildAlbumMapping(
  navidrome: Database.Database,
  sonarly: Database.Database,
): { map: Map<string, string>; matched: number; unmatched: number } {
  const activeAlbums = sonarly
    .prepare('SELECT id, name, artist_name FROM albums WHERE active = 1')
    .all() as Array<{ id: string; name: string; artist_name: string | null }>;

  const albumMap = new Map<string, string>(); // "name|artist" -> id
  for (const a of activeAlbums) {
    const key = `${a.name.toLowerCase()}|${(a.artist_name ?? '').toLowerCase()}`;
    albumMap.set(key, a.id);
  }

  const navidromeAlbums = navidrome
    .prepare('SELECT id, name, album_artist FROM album')
    .all() as Array<{ id: string; name: string; album_artist: string }>;

  const map = new Map<string, string>(); // navidrome album_id -> sonarly album id
  let matched = 0;
  let unmatched = 0;

  for (const ndAlbum of navidromeAlbums) {
    const key = `${ndAlbum.name.toLowerCase()}|${ndAlbum.album_artist.toLowerCase()}`;
    const sonarlyId = albumMap.get(key);
    if (sonarlyId) {
      map.set(ndAlbum.id, sonarlyId);
      matched++;
    } else {
      unmatched++;
    }
  }

  return { map, matched, unmatched };
}

function buildArtistMapping(
  navidrome: Database.Database,
  sonarly: Database.Database,
): { map: Map<string, string>; matched: number; unmatched: number } {
  const activeArtists = sonarly
    .prepare('SELECT id, name FROM artists WHERE active = 1')
    .all() as Array<{ id: string; name: string }>;

  const artistMap = new Map<string, string>();
  for (const a of activeArtists) {
    artistMap.set(a.name.toLowerCase(), a.id);
  }

  const navidromeArtists = navidrome.prepare('SELECT id, name FROM artist').all() as Array<{
    id: string;
    name: string;
  }>;

  const map = new Map<string, string>();
  let matched = 0;
  let unmatched = 0;

  for (const ndArtist of navidromeArtists) {
    const sonarlyId = artistMap.get(ndArtist.name.toLowerCase());
    if (sonarlyId) {
      map.set(ndArtist.id, sonarlyId);
      matched++;
    } else {
      unmatched++;
    }
  }

  return { map, matched, unmatched };
}

function migrateAnnotations(
  navidrome: Database.Database,
  sonarly: Database.Database,
  userIdMap: Map<string, string>,
  songMap: Map<string, string>,
  albumMap: Map<string, string>,
  artistMap: Map<string, string>,
  dryRun: boolean,
): Pick<MigrationSummary, 'userSongs' | 'userAlbums' | 'userArtists'> {
  const annotations = navidrome
    .prepare('SELECT user_id, item_id, item_type, play_count, play_date, rating, starred, starred_at FROM annotation')
    .all() as Array<{
    user_id: string;
    item_id: string;
    item_type: string;
    play_count: number | null;
    play_date: string | null;
    rating: number | null;
    starred: number;
    starred_at: string | null;
  }>;

  const summary = {
    userSongs: { inserted: 0, updated: 0 },
    userAlbums: { inserted: 0, updated: 0 },
    userArtists: { inserted: 0, updated: 0 },
  };

  const insertSong = sonarly.prepare(
    `INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, song_id) DO UPDATE SET
       starred = excluded.starred,
       rating = excluded.rating,
       play_count = excluded.play_count,
       last_played = excluded.last_played`,
  );

  const insertAlbum = sonarly.prepare(
    `INSERT INTO user_albums (user_id, album_id, starred, rating)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, album_id) DO UPDATE SET
       starred = excluded.starred,
       rating = excluded.rating`,
  );

  const insertArtist = sonarly.prepare(
    `INSERT INTO user_artists (user_id, artist_id, starred, rating)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, artist_id) DO UPDATE SET
       starred = excluded.starred,
       rating = excluded.rating`,
  );

  for (const a of annotations) {
    const sonarlyUserId = userIdMap.get(a.user_id);
    if (!sonarlyUserId) continue;

    const starred = a.starred ? 1 : 0;
    const rating = a.rating && a.rating > 0 ? a.rating : null;
    const lastPlayed = a.play_date ?? a.starred_at ?? null;

    if (a.item_type === 'media_file') {
      const songId = songMap.get(a.item_id);
      if (!songId) continue;
      if (!dryRun) {
        insertSong.run(sonarlyUserId, songId, starred, rating, a.play_count ?? 0, lastPlayed);
      }
      summary.userSongs.inserted++;
    } else if (a.item_type === 'album') {
      const albumId = albumMap.get(a.item_id);
      if (!albumId) continue;
      if (!dryRun) {
        insertAlbum.run(sonarlyUserId, albumId, starred, rating);
      }
      summary.userAlbums.inserted++;
    } else if (a.item_type === 'artist') {
      const artistId = artistMap.get(a.item_id);
      if (!artistId) continue;
      if (!dryRun) {
        insertArtist.run(sonarlyUserId, artistId, starred, rating);
      }
      summary.userArtists.inserted++;
    }
  }

  return summary;
}

function migrateScrobbles(
  navidrome: Database.Database,
  sonarly: Database.Database,
  userIdMap: Map<string, string>,
  songMap: Map<string, string>,
  dryRun: boolean,
): MigrationSummary['scrobbles'] {
  const scrobbles = navidrome
    .prepare('SELECT media_file_id, user_id, submission_time FROM scrobbles')
    .all() as Array<{
    media_file_id: string;
    user_id: string;
    submission_time: number;
  }>;

  const summary = { inserted: 0, skippedNoSong: 0, skippedNoUser: 0 };

  const insert = sonarly.prepare(
    `INSERT INTO listening_history (id, user_id, song_id, played_at, duration_listened, completion, client, source)
     VALUES (?, ?, ?, ?, NULL, NULL, 'navidrome-migration', 'navidrome')`,
  );

  for (const s of scrobbles) {
    const sonarlyUserId = userIdMap.get(s.user_id);
    if (!sonarlyUserId) {
      summary.skippedNoUser++;
      continue;
    }
    const songId = songMap.get(s.media_file_id);
    if (!songId) {
      summary.skippedNoSong++;
      continue;
    }
    if (!dryRun) {
      insert.run(randomUUID(), sonarlyUserId, songId, isoFromUnixSeconds(s.submission_time));
    }
    summary.inserted++;
  }

  return summary;
}

function migratePlaylists(
  navidrome: Database.Database,
  sonarly: Database.Database,
  userIdMap: Map<string, string>,
  songMap: Map<string, string>,
  dryRun: boolean,
): MigrationSummary['playlists'] {
  const summary = { created: 0, tracksInserted: 0, tracksSkipped: 0 };

  const playlists = navidrome
    .prepare('SELECT id, name, comment, public, created_at, updated_at, owner_id FROM playlist')
    .all() as Array<{
    id: string;
    name: string;
    comment: string;
    public: number;
    created_at: string;
    updated_at: string;
    owner_id: string;
  }>;

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
    `INSERT INTO playlists (id, name, owner_id, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const insertTrack = sonarly.prepare(
    'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)',
  );

  for (const pl of playlists) {
    const ownerId = userIdMap.get(pl.owner_id);
    if (!ownerId) {
      console.log(`  Skipping playlist "${pl.name}" (owner not mapped).`);
      continue;
    }

    const visibility = pl.public ? 'public' : 'private';
    const newId = randomUUID();
    summary.created++;

    if (!dryRun) {
      insertPlaylist.run(newId, pl.name, ownerId, visibility, pl.created_at, pl.updated_at);
    }

    const trackIds = tracksByPlaylist.get(pl.id) ?? [];
    for (let i = 0; i < trackIds.length; i++) {
      const songId = songMap.get(trackIds[i]);
      if (!songId) {
        summary.tracksSkipped++;
        continue;
      }
      if (!dryRun) {
        insertTrack.run(newId, songId, i);
      }
      summary.tracksInserted++;
    }

    console.log(`  Migrated playlist "${pl.name}" (${trackIds.length} tracks).`);
  }

  return summary;
}

function printSummary(summary: MigrationSummary) {
  console.log('\n=== Migration Summary ===');
  console.log(`Users:        ${summary.users.created} created, ${summary.users.updated} updated, ${summary.users.skipped} skipped`);
  console.log(`Songs:        ${summary.songs.matched} matched, ${summary.songs.unmatched} unmatched`);
  console.log(`Albums:       ${summary.albums.matched} matched, ${summary.albums.unmatched} unmatched`);
  console.log(`Artists:      ${summary.artists.matched} matched, ${summary.artists.unmatched} unmatched`);
  console.log(`User songs:   ${summary.userSongs.inserted} inserted/updated`);
  console.log(`User albums:  ${summary.userAlbums.inserted} inserted/updated`);
  console.log(`User artists: ${summary.userArtists.inserted} inserted/updated`);
  console.log(`Scrobbles:    ${summary.scrobbles.inserted} inserted, ${summary.scrobbles.skippedNoSong} skipped (no song), ${summary.scrobbles.skippedNoUser} skipped (no user)`);
  console.log(`Playlists:    ${summary.playlists.created} created, ${summary.playlists.tracksInserted} tracks inserted, ${summary.playlists.tracksSkipped} tracks skipped`);
}

async function main() {
  const options = parseArgs();
  console.log(`Navidrome DB: ${options.navidromeDbPath}`);
  console.log(`Sonarly DB:   ${options.sonarlyDbPath}`);
  console.log(`Mode:         ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  const navidrome = openDb(options.navidromeDbPath, true);
  const sonarly = openDb(options.sonarlyDbPath, options.dryRun);

  const summary: MigrationSummary = {
    users: { created: 0, updated: 0, skipped: 0 },
    songs: { matched: 0, unmatched: 0 },
    albums: { matched: 0, unmatched: 0 },
    artists: { matched: 0, unmatched: 0 },
    userSongs: { inserted: 0, updated: 0 },
    userAlbums: { inserted: 0, updated: 0 },
    userArtists: { inserted: 0, updated: 0 },
    scrobbles: { inserted: 0, skippedNoSong: 0, skippedNoUser: 0 },
    playlists: { created: 0, tracksInserted: 0, tracksSkipped: 0 },
  };

  try {
    console.log('\n1. Migrating users...');
    const { summary: userSummary, userIdMap } = migrateUsers(navidrome, sonarly, options.dryRun);
    summary.users = userSummary;

    console.log('\n2. Building song path mapping...');
    const { map: songMap, matched: songsMatched, unmatched: songsUnmatched } = buildSongMapping(navidrome, sonarly);
    summary.songs = { matched: songsMatched, unmatched: songsUnmatched };
    console.log(`   Matched ${songsMatched} songs, ${songsUnmatched} unmatched.`);

    console.log('\n3. Building album mapping...');
    const { map: albumMap, matched: albumsMatched, unmatched: albumsUnmatched } = buildAlbumMapping(navidrome, sonarly);
    summary.albums = { matched: albumsMatched, unmatched: albumsUnmatched };
    console.log(`   Matched ${albumsMatched} albums, ${albumsUnmatched} unmatched.`);

    console.log('\n4. Building artist mapping...');
    const { map: artistMap, matched: artistsMatched, unmatched: artistsUnmatched } = buildArtistMapping(
      navidrome,
      sonarly,
    );
    summary.artists = { matched: artistsMatched, unmatched: artistsUnmatched };
    console.log(`   Matched ${artistsMatched} artists, ${artistsUnmatched} unmatched.`);

    console.log('\n5. Migrating annotations (ratings, favorites, play counts)...');
    const annotationSummary = migrateAnnotations(
      navidrome,
      sonarly,
      userIdMap,
      songMap,
      albumMap,
      artistMap,
      options.dryRun,
    );
    summary.userSongs = annotationSummary.userSongs;
    summary.userAlbums = annotationSummary.userAlbums;
    summary.userArtists = annotationSummary.userArtists;

    console.log('\n6. Migrating scrobbles (listening history)...');
    summary.scrobbles = migrateScrobbles(navidrome, sonarly, userIdMap, songMap, options.dryRun);

    console.log('\n7. Migrating playlists...');
    summary.playlists = migratePlaylists(navidrome, sonarly, userIdMap, songMap, options.dryRun);

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
