import type { FastifyReply } from 'fastify';
import { toXml } from './xml.js';

export interface SubsonicResponse {
  'subsonic-response': {
    status: 'ok' | 'failed';
    version: string;
    type: string;
    serverVersion: string;
    error?: { code: number; message: string };
  } & Record<string, unknown>;
}

export function sendSubsonicReply(
  reply: FastifyReply,
  format: 'json' | 'xml',
  data: Record<string, unknown>,
  status: 'ok' | 'failed' = 'ok',
): FastifyReply {
  const envelope = {
    'subsonic-response': {
      status,
      version: '1.16.1',
      type: 'sonarly',
      serverVersion: '0.1.0',
      ...data,
    },
  };

  if (format === 'xml') {
    return reply.type('application/xml').send(toXml(envelope));
  }
  return reply.send(envelope);
}
