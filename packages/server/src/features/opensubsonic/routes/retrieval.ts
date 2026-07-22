import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { lookup } from 'mime-types';
import { parseFile } from 'music-metadata';
import Database from 'better-sqlite3';
import { getSongById } from '../../songs/index.js';
import { recordStream } from '../../players/tracker.js';

export function registerRetrievalRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/rest/stream.view', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.query as { id: string };
    const song = getSongById(db, id);
    if (!song) return reply.status(404).send('Not found');

    recordStream(db, request, song);

    const mime = lookup(song.filePath) || 'application/octet-stream';
    const { size } = statSync(song.filePath);
    const rangeHeader = request.headers.range;

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
    } catch (error) {
      return reply.status(500).send('Failed to read cover art');
    }
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
