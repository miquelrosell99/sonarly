import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { lookup } from 'mime-types';
import { parseFile } from 'music-metadata';
import Database from 'better-sqlite3';
import { getSongById } from '../../songs/index.js';
import { getAlbumById } from '../../albums/index.js';
import { getUserById } from '../../users/index.js';
import { getArtistImageLocalPath } from '../../artists/index.js';
import { getCoverArtById } from '../../cover-art/index.js';
import { getSongCoverArtId, getAlbumCoverArtId } from '../../cover-art/index.js';
import { recordStream } from '../../players/tracker.js';
import { sendSubsonicReply } from '../responses.js';
import { decideTranscode, spawnFfmpegTranscode, transcodeContentType } from '../../transcode/service.js';

export function registerRetrievalRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/stream.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { id: string; maxBitRate?: string };
    const { id } = query;
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');

    const userId = ((request as any).subsonicUser as string | undefined) ?? ((request as any).session?.userId as string | undefined);
    const user = userId ? getUserById(db, userId) : undefined;
    const requestedMaxBitRate = query.maxBitRate ? Number.parseInt(query.maxBitRate, 10) : undefined;
    const decision = decideTranscode(song, user, requestedMaxBitRate);

    if (decision.shouldTranscode && decision.format) {
      if (request.method === 'HEAD') {
        return reply.header('Accept-Ranges', 'none').type(transcodeContentType(decision.format)).send();
      }

      recordStream(db, request, song);

      try {
        const proc = spawnFfmpegTranscode({
          filePath: song.filePath,
          format: decision.format,
          maxBitrateKbps: decision.maxBitrateKbps,
        });

        proc.on('error', (err) => {
          console.error('ffmpeg transcode error:', err);
          if (!reply.sent) {
            reply.status(500).send('Transcode failed');
          }
        });

        proc.stderr?.on('data', (data) => {
          console.error(`ffmpeg stderr: ${data}`);
        });

        request.raw.on('close', () => {
          proc.kill('SIGKILL');
        });

        return reply.header('Accept-Ranges', 'none').type(transcodeContentType(decision.format)).send(proc.stdout);
      } catch (err) {
        console.error('Failed to spawn ffmpeg:', err);
        // Fall through to direct file serving if ffmpeg is unavailable.
      }
    }

    const mime = lookup(song.filePath) || 'application/octet-stream';
    const { size } = statSync(song.filePath);
    const rangeHeader = request.headers.range;

    if (request.method === 'HEAD') {
      return reply.header('Accept-Ranges', 'bytes').type(mime).send();
    }

    recordStream(db, request, song);

    if (!rangeHeader) {
      return reply.header('Accept-Ranges', 'bytes').type(mime).send(createReadStream(song.filePath));
    }

    const range = parseRange(rangeHeader, size);
    if (!range) return reply.status(416).send('Invalid range');

    const { start, end } = range;
    const chunkSize = end - start + 1;

    return reply
      .status(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', chunkSize)
      .header('Accept-Ranges', 'bytes')
      .type(mime)
      .send(createReadStream(song.filePath, { start, end }));
  });

  app.get('/rest/download.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.query as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');

    const mime = lookup(song.filePath) || 'application/octet-stream';
    const { size } = statSync(song.filePath);
    const filename = path.basename(song.filePath);
    return reply
      .header('Content-Length', size)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .type(mime)
      .send(createReadStream(song.filePath));
  });

  app.get('/rest/getCoverArt.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    const { id } = request.query as { id: string };

    const cached = getCoverArtById(db, id);
    if (cached) {
      return reply.type(cached.format).send(cached.data);
    }

    // Try song cover art first
    const songCoverArtId = getSongCoverArtId(db, id);
    if (songCoverArtId) {
      const songCached = getCoverArtById(db, songCoverArtId);
      if (songCached) {
        return reply.type(songCached.format).send(songCached.data);
      }
    }

    const song = getSongById(db, id);
    if (song) {
      try {
        const metadata = await parseFile(song.filePath, { duration: false });
        const picture = metadata.common.picture?.[0];
        if (picture) {
          return reply.type(picture.format).send(Buffer.from(picture.data));
        }
      } catch {
        // fall through
      }
    }

    // Try album cover art
    const albumCoverArtId = getAlbumCoverArtId(db, id);
    if (albumCoverArtId) {
      const albumCached = getCoverArtById(db, albumCoverArtId);
      if (albumCached) {
        return reply.type(albumCached.format).send(albumCached.data);
      }
    }

    const album = getAlbumById(db, id);
    if (album?.id) {
      const albumSong = db.prepare('SELECT id FROM songs WHERE album_id = ? AND active = 1 ORDER BY disc_number, track_number LIMIT 1').get(album.id) as { id: string } | undefined;
      if (albumSong) {
        const firstSong = getSongById(db, albumSong.id);
        if (firstSong) {
          try {
            const metadata = await parseFile(firstSong.filePath, { duration: false });
            const picture = metadata.common.picture?.[0];
            if (picture) {
              return reply.type(picture.format).send(Buffer.from(picture.data));
            }
          } catch {
            // fall through
          }
        }
      }
    }

    // Try artist cover art
    const artistLocalPath = getArtistImageLocalPath(db, id);
    if (artistLocalPath) {
      try {
        const fileStat = statSync(artistLocalPath);
        if (fileStat.isFile()) {
          const contentType = lookup(artistLocalPath) || 'application/octet-stream';
          return reply.type(contentType).send(createReadStream(artistLocalPath));
        }
      } catch {
        // fall through
      }
    }

    const artistRow = db.prepare('SELECT artist_image_url FROM artists WHERE id = ? AND active = 1').get(id) as { artist_image_url: string | null } | undefined;
    if (artistRow?.artist_image_url) {
      return reply.redirect(artistRow.artist_image_url);
    }

    return sendSubsonicReply(reply, format, {
      error: { code: 70, message: 'Cover art not found' },
    }, 'failed');
  });

  app.get('/rest/getLyrics.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    const { id, artist, title } = request.query as { id?: string; artist?: string; title?: string };
    let lyrics = '';

    if (id) {
      const song = getSongById(db, id);
      lyrics = song?.lyrics ?? '';
    } else if (artist && title) {
      const row = db.prepare(`
        SELECT s.lyrics FROM songs s
        JOIN artists a ON a.id = s.artist_id
        WHERE a.name = ? COLLATE NOCASE AND s.title = ? COLLATE NOCASE AND s.active = 1
        LIMIT 1
      `).get(artist, title) as { lyrics: string | null } | undefined;
      lyrics = row?.lyrics ?? '';
    }

    sendSubsonicReply(reply, format, { lyrics });
  });
}

interface ByteRange {
  start: number;
  end: number;
}

function parseRange(rangeHeader: string, size: number): ByteRange | undefined {
  const match = rangeHeader.match(/^bytes=(.*)$/);
  if (!match) return undefined;

  const spec = match[1];
  if (spec.startsWith('-')) {
    // suffix range: bytes=-suffix
    const suffix = parseInt(spec.slice(1), 10);
    if (Number.isNaN(suffix) || suffix <= 0) return undefined;
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const parts = spec.split('-');
  if (parts.length !== 2) return undefined;

  const start = parseInt(parts[0], 10);
  if (Number.isNaN(start) || start < 0 || start >= size) return undefined;

  let end: number;
  if (parts[1] === '') {
    // open-ended range: bytes=start-
    end = size - 1;
  } else {
    end = parseInt(parts[1], 10);
    if (Number.isNaN(end) || end < start || start > end) return undefined;
  }

  end = Math.min(end, size - 1);
  return { start, end };
}
