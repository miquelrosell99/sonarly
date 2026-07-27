const Database = require('better-sqlite3');
const db = new Database('/tmp/sonarly.db');

console.log('--- songs schema ---');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='songs'").get());

console.log('--- counts ---');
console.log('songs:', db.prepare('SELECT COUNT(*) as c FROM songs').get());
console.log('artists:', db.prepare('SELECT COUNT(*) as c FROM artists').get());
console.log('albums:', db.prepare('SELECT COUNT(*) as c FROM albums').get());

console.log('--- libraries ---');
console.log(db.prepare('SELECT id,name,path FROM libraries').all());

console.log('--- recent scan jobs ---');
console.log(db.prepare('SELECT id,type,status,total_files,processed_files,error,created_at,finished_at FROM scan_jobs ORDER BY created_at DESC LIMIT 5').all());

console.log('--- sample song ---');
console.log(db.prepare('SELECT id,title,artist_id,album_id,file_path,duration FROM songs LIMIT 1').get());

db.close();
