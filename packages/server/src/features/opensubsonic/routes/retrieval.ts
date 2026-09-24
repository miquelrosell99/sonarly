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
import { decideTranscode, parseMaxBitRate, spawnFfmpegTranscode, transcodeContentType } from '../../transcode/service.js';
import { getLibraryScope, isAlbumInScope, isCoverArtInScope, isSongInScope, libraryScopeCondition } from '../../libraries/policy.js';
import type { LibraryScope } from '../../libraries/policy.js';

// Cover art is immutable by id; safe to cache privately for a day.
const COVER_ART_CACHE_CONTROL = 'private, max-age=86400';

function requestStreamScope(db: Database.Database, request: FastifyRequest): LibraryScope {
  const subsonicUserId = (request as any).subsonicUser as string | undefined;
  if (subsonicUserId) {
    return getLibraryScope(db, {
      userId: subsonicUserId,
      isAdmin: (request as any).subsonicUserIsAdmin === true,
    });
  }
  const session = (request as any).session as { userId?: string; isAdmin?: boolean } | undefined;
  return getLibraryScope(db, session);
}

export function registerRetrievalRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/stream.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    const query = request.query as { id: string; maxBitRate?: string };
    const { id } = query;
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');
    if (!isSongInScope(db, requestStreamScope(db, request), id)) return reply.status(404).send('Not found');

    const userId = ((request as any).subsonicUser as string | undefined) ?? ((request as any).session?.userId as string | undefined);
    const user = userId ? getUserById(db, userId) : undefined;
    const requestedMaxBitRate = parseMaxBitRate(query.maxBitRate);
    const decision = decideTranscode(song, user, requestedMaxBitRate);

    if (decision.shouldTranscode && decision.format) {
      if (request.method === 'HEAD') {
        return reply.header('Accept-Ranges', 'none').type(transcodeContentType(decision.format)).send();
      }

      recordStream(db, request, song);

      // spawn() reports a missing ffmpeg binary asynchronously ('error'
      // event), so wait until the process is up before replying; on spawn
      // failure degrade to direct file serving — no response bytes have been
      // sent at this point.
      let spawned: ReturnType<typeof spawnFfmpegTranscode> | undefined;
      try {
        const proc = spawnFfmpegTranscode({
          filePath: song.filePath,
          format: decision.format,
          maxBitrateKbps: decision.maxBitrateKbps,
        });
        spawned = proc;
        await new Promise<void>((resolve, reject) => {
          proc.once('spawn', resolve);
          proc.once('error', reject);
        });
      } catch (err) {
        console.error('Failed to spawn ffmpeg, falling back to direct streaming:', err);
        spawned = undefined;
      }

      if (spawned) {
        const proc = spawned;
        proc.on('error', (err) => {
          console.error('ffmpeg transcode error:', err);
        });

        proc.stderr?.on('data', (data) => {
          console.error(`ffmpeg stderr: ${data}`);
        });

        request.raw.on('close', () => {
          proc.kill('SIGKILL');
        });

        return reply.header('Accept-Ranges', 'none').type(transcodeContentType(decision.format)).send(proc.stdout);
      }
    }

    const mime = lookup(song.filePath) || 'application/octet-stream';
    let size: number;
    try {
      size = statSync(song.filePath).size;
    } catch {
      // File vanished from disk after being indexed.
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }
    const rangeHeader = request.headers.range;

    if (request.method === 'HEAD') {
      return reply.header('Accept-Ranges', 'bytes').header('Content-Length', size).type(mime).send();
    }

    recordStream(db, request, song);

    if (!rangeHeader) {
      return reply.header('Accept-Ranges', 'bytes').header('Content-Length', size).type(mime).send(createReadStream(song.filePath));
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
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    const { id } = request.query as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');
    if (!isSongInScope(db, requestStreamScope(db, request), id)) return reply.status(404).send('Not found');

    const mime = lookup(song.filePath) || 'application/octet-stream';
    let size: number;
    try {
      size = statSync(song.filePath).size;
    } catch {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Data not found' },
      }, 'failed');
    }
    const filename = path.basename(song.filePath);
    const safeFilename = filename.replace(/["\\\r\n]/g, '_');
    return reply
      .header('Content-Length', size)
      .header('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .type(mime)
      .send(createReadStream(song.filePath));
  });

  app.get('/rest/getCoverArt.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    const { id } = request.query as { id: string };
    const scope = requestStreamScope(db, request);

    const cached = getCoverArtById(db, id);
    if (cached) {
      if (!isCoverArtInScope(db, scope, id)) {
        return sendSubsonicReply(reply, format, {
          error: { code: 70, message: 'Cover art not found' },
        }, 'failed');
      }
      return reply.header('Cache-Control', COVER_ART_CACHE_CONTROL).type(cached.format).send(cached.data);
    }

    // Try song cover art first
    const song = getSongById(db, id);
    if (song && !isSongInScope(db, scope, id)) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Cover art not found' },
      }, 'failed');
    }
    const songCoverArtId = getSongCoverArtId(db, id);
    if (songCoverArtId) {
      const songCached = getCoverArtById(db, songCoverArtId);
      if (songCached) {
        return reply.header('Cache-Control', COVER_ART_CACHE_CONTROL).type(songCached.format).send(songCached.data);
      }
    }

    if (song) {
      try {
        const metadata = await parseFile(song.filePath, { duration: false });
        const picture = metadata.common.picture?.[0];
        if (picture) {
          return reply.header('Cache-Control', COVER_ART_CACHE_CONTROL).type(picture.format).send(Buffer.from(picture.data));
        }
      } catch {
        // fall through
      }
    }

    // Try album cover art
    const album = getAlbumById(db, id);
    if (album?.id && !isAlbumInScope(db, scope, album.id)) {
      return sendSubsonicReply(reply, format, {
        error: { code: 70, message: 'Cover art not found' },
      }, 'failed');
    }
    const albumCoverArtId = getAlbumCoverArtId(db, id);
    if (albumCoverArtId) {
      const albumCached = getCoverArtById(db, albumCoverArtId);
      if (albumCached) {
        return reply.header('Cache-Control', COVER_ART_CACHE_CONTROL).type(albumCached.format).send(albumCached.data);
      }
    }

    if (album?.id) {
      const albumSong = db.prepare('SELECT id FROM songs WHERE album_id = ? AND active = 1 ORDER BY disc_number, track_number LIMIT 1').get(album.id) as { id: string } | undefined;
      if (albumSong) {
        const firstSong = getSongById(db, albumSong.id);
        if (firstSong) {
          try {
            const metadata = await parseFile(firstSong.filePath, { duration: false });
            const picture = metadata.common.picture?.[0];
            if (picture) {
              return reply.header('Cache-Control', COVER_ART_CACHE_CONTROL).type(picture.format).send(Buffer.from(picture.data));
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
          return reply.header('Cache-Control', COVER_ART_CACHE_CONTROL).type(contentType).send(createReadStream(artistLocalPath));
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
    const scope = requestStreamScope(db, request);
    let lyrics = '';

    if (id) {
      const song = getSongById(db, id);
      lyrics = song && isSongInScope(db, scope, id) ? (song.lyrics ?? '') : '';
    } else if (artist && title) {
      const scopeCondition = libraryScopeCondition(scope, 's.library_id');
      const row = db.prepare(`
        SELECT s.lyrics FROM songs s
        JOIN artists a ON a.id = s.artist_id
        WHERE a.name = ? COLLATE NOCASE AND s.title = ? COLLATE NOCASE AND s.active = 1
        ${scopeCondition.sql}
        LIMIT 1
      `).get(artist, title, ...scopeCondition.params) as { lyrics: string | null } | undefined;
      lyrics = row?.lyrics ?? '';
    }

    // The Subsonic schema wraps lyrics in an object with a `value` field; a
    // bare string breaks clients like py-opensonic (Music Assistant).
    sendSubsonicReply(reply, format, {
      lyrics: {
        value: lyrics,
        artist: artist ?? undefined,
        title: title ?? undefined,
      },
    });
  });

  // Sonarly has no podcast or radio sources; return valid empty collections so
  // clients that sync these libraries (e.g. Music Assistant) succeed with zero items.
  app.get('/rest/getInternetRadioStations.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    sendSubsonicReply(reply, format, { internetRadioStations: { internetRadioStation: [] } });
  });

  app.get('/rest/getPodcasts.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    sendSubsonicReply(reply, format, { podcasts: { channel: [] } });
  });

  app.get('/rest/getNewestPodcasts.view', (request: FastifyRequest, reply: FastifyReply) => {
    const format = (request as any).subsonicFormat as 'json' | 'xml';
    sendSubsonicReply(reply, format, { newestPodcasts: { episode: [] } });
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
  // Multi-range requests are not supported.
  if (spec.includes(',')) return undefined;
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
