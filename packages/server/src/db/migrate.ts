import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface JsMigration {
  up?: (db: Database.Database) => void;
  default?: (db: Database.Database) => void;
}

function getJsMigrationRun(mod: JsMigration): (db: Database.Database) => void {
  if (typeof mod.up === 'function') return mod.up;
  if (typeof mod.default === 'function') return mod.default;
  throw new Error('JS migration must export an "up" function or a default function');
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT filename FROM migrations').pluck().all() as string[]
  );

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.js') || f.endsWith('.cjs'))
    .sort();

  const runMigration = db.transaction((file: string, run: () => void) => {
    run();
    db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(file);
  });

  const require = createRequire(import.meta.url);

  for (const file of files) {
    if (applied.has(file)) continue;
    const filePath = join(migrationsDir, file);
    let run: () => void;
    if (file.endsWith('.sql')) {
      const sql = readFileSync(filePath, 'utf-8');
      run = () => db.exec(sql);
    } else {
      const mod = require(filePath) as JsMigration;
      const up = getJsMigrationRun(mod);
      run = () => up(db);
    }
    runMigration(file, run);
  }
}
