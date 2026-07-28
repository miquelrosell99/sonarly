import Database from 'better-sqlite3';

const db = new Database('/etc/periphery/stacks/navidrome/config/navidrome.db', { readonly: true });

const playlists = db.prepare(
  "SELECT id, name, rules, song_count, public FROM playlist WHERE rules IS NOT NULL AND rules <> '' LIMIT 20"
).all();
console.log('Smart playlists sample:');
console.log(JSON.stringify(playlists, null, 2));

const allColumns = db.prepare("PRAGMA table_info(playlist_tracks)").all();
console.log('\nplaylist_tracks columns:');
console.log(JSON.stringify(allColumns, null, 2));

const playlistCount = db.prepare("SELECT COUNT(*) as c FROM playlist").get() as { c: number };
console.log('\nTotal playlists:', playlistCount.c);
