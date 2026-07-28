module.exports = {
  up(db) {
    const columns = db.prepare('PRAGMA table_info(ingest_jobs)').all();
    const hasDuplicateCount = columns.some((c) => c.name === 'duplicate_count');
    const hasDuplicate = columns.some((c) => c.name === 'duplicate');

    if (hasDuplicateCount && !hasDuplicate) {
      db.exec('ALTER TABLE ingest_jobs RENAME COLUMN duplicate_count TO duplicate');
    }
  },
};
