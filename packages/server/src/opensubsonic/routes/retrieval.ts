import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import { lookup } from 'mime-types';
import { parseFile } from 'music-metadata';
import Database from 'better-sqlite3';
import { getSongById } from '../../db/repositories/song-repository.js';

export function registerRetrievalRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/stream.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.query as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');

    const mime = lookup(song.filePath) || 'application/octet-stream';
    const { size } = statSync(song.filePath);
    const rangeHeader = request.headers.range;

    if (!rangeHeader) {
      return reply.header('Accept-Ranges', 'bytes').type(mime).send(createReadStream(song.filePath));
    }

    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) return reply.status(416).send('Invalid range');

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : size - 1;
    if (start >= size || start > end) {
      return reply.status(416).send('Invalid range');
    }

    const clampedEnd = Math.min(end, size - 1);
    const chunkSize = clampedEnd - start + 1;

    return reply
      .status(206)
      .header('Content-Range', `bytes ${start}-${clampedEnd}/${size}`)
      .header('Content-Length', chunkSize)
      .header('Accept-Ranges', 'bytes')
      .type(mime)
      .send(createReadStream(song.filePath, { start, end: clampedEnd }));
  });

  app.get('/rest/download.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.query as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');

    const mime = lookup(song.filePath) || 'application/octet-stream';
    const { size } = statSync(song.filePath);
    return reply
      .header('Content-Length', size)
      .header('Content-Disposition', `attachment; filename="${song.id}"`)
      .type(mime)
      .send(createReadStream(song.filePath));
  });

  app.get('/rest/getCoverArt.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.query as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');

    try {
      const metadata = await parseFile(song.filePath, { duration: false });
      const picture = metadata.common.picture?.[0];
      if (!picture) {
        return reply.status(404).send('No cover art');
      }
      return reply.type(picture.format).send(Buffer.from(picture.data));
    } catch {
      return reply.status(404).send('No cover art');
    }
  });
}
