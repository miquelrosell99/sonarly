import Database from 'better-sqlite3';
import { compileSmartPlaylist } from '../src/features/smart-playlists/compiler.js';

const db = new Database('/root/projects/sonarly/config/sonarly/data/sonarly.db');
const userId = 'a2ab2854-2ac1-4d14-b073-326165565cbf';

const rows = db
  .prepare("SELECT id, name, rules_json FROM playlists WHERE is_smart = 1")
  .all() as Array<{ id: string; name: string; rules_json: string }>;

let failed = 0;
for (const row of rows) {
  try {
    const rules = JSON.parse(row.rules_json);
    const compiled = compileSmartPlaylist(db, rules, userId);
    // Try to prepare the count SQL to catch missing table errors.
    db.prepare(compiled.songCountSql).get(...compiled.songCountParams);
    console.log(`OK  ${row.name}`);
  } catch (err) {
    failed++;
    console.log(`ERR ${row.name}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`\n${rows.length - failed}/${rows.length} smart playlists compile successfully.`);
