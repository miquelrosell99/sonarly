'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Move composers out of songs.composers JSON into the artists table with a
 * song_composers junction table, and move labels out of albums.labels JSON
 * into a dedicated labels table with an album_labels junction table.
 */
function up(db) {
  // ----- labels table (same schema shape as artists) -----
  db.exec(`
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1,
      label_image_url TEXT,
      label_image_local_path TEXT,
      musicbrainz_label_ids TEXT,
      bio TEXT,
      external_urls TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_labels_name ON labels(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_name_unique ON labels(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_labels_active ON labels(active);

    CREATE TABLE IF NOT EXISTS song_composers (
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (song_id, artist_id)
    );

    CREATE INDEX IF NOT EXISTS idx_song_composers_song ON song_composers(song_id);
    CREATE INDEX IF NOT EXISTS idx_song_composers_artist ON song_composers(artist_id);

    CREATE TABLE IF NOT EXISTS album_labels (
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (album_id, label_id)
    );

    CREATE INDEX IF NOT EXISTS idx_album_labels_album ON album_labels(album_id);
    CREATE INDEX IF NOT EXISTS idx_album_labels_label ON album_labels(label_id);
  `);

  // ----- migrate existing composers -----
  const ensureArtist = db.prepare(`
    INSERT INTO artists (id, name, active, artist_image_url, musicbrainz_artist_ids, bio, external_urls)
    VALUES (?, ?, 1, NULL, NULL, NULL, NULL)
    ON CONFLICT(name) DO NOTHING
  `);

  const findArtistByName = db.prepare(`
    SELECT id FROM artists WHERE name = ? COLLATE NOCASE
  `);

  const insertSongComposer = db.prepare(`
    INSERT INTO song_composers (song_id, artist_id, position)
    VALUES (?, ?, ?)
    ON CONFLICT(song_id, artist_id) DO NOTHING
  `);

  const songsWithComposers = db.prepare(`
    SELECT id, composers FROM songs WHERE composers IS NOT NULL AND composers <> ''
  `).all();

  for (const song of songsWithComposers) {
    let composerNames;
    try {
      composerNames = JSON.parse(song.composers);
    } catch {
      continue;
    }
    if (!Array.isArray(composerNames)) continue;

    for (const [position, rawName] of composerNames.entries()) {
      const name = String(rawName).trim();
      if (!name) continue;

      let existing = findArtistByName.get(name);
      if (!existing) {
        const id = randomUUID();
        ensureArtist.run(id, name);
        existing = findArtistByName.get(name);
      }
      if (existing) {
        insertSongComposer.run(song.id, existing.id, position);
      }
    }
  }

  // ----- migrate existing labels -----
  const ensureLabel = db.prepare(`
    INSERT INTO labels (id, name, active, label_image_url, musicbrainz_label_ids, bio, external_urls)
    VALUES (?, ?, 1, NULL, NULL, NULL, NULL)
    ON CONFLICT(name) DO NOTHING
  `);

  const findLabelByName = db.prepare(`
    SELECT id FROM labels WHERE name = ? COLLATE NOCASE
  `);

  const insertAlbumLabel = db.prepare(`
    INSERT INTO album_labels (album_id, label_id, position)
    VALUES (?, ?, ?)
    ON CONFLICT(album_id, label_id) DO NOTHING
  `);

  const albumsWithLabels = db.prepare(`
    SELECT id, labels FROM albums WHERE labels IS NOT NULL AND labels <> ''
  `).all();

  for (const album of albumsWithLabels) {
    let labelNames;
    try {
      labelNames = JSON.parse(album.labels);
    } catch {
      continue;
    }
    if (!Array.isArray(labelNames)) continue;

    for (const [position, rawName] of labelNames.entries()) {
      const name = String(rawName).trim();
      if (!name) continue;

      let existing = findLabelByName.get(name);
      if (!existing) {
        const id = randomUUID();
        ensureLabel.run(id, name);
        existing = findLabelByName.get(name);
      }
      if (existing) {
        insertAlbumLabel.run(album.id, existing.id, position);
      }
    }
  }

  // ----- drop deprecated JSON columns -----
  db.exec(`
    ALTER TABLE songs DROP COLUMN composers;
    ALTER TABLE albums DROP COLUMN labels;
  `);
}

module.exports = { up };
