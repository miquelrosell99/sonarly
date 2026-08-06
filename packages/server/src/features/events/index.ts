import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

const HEARTBEAT_INTERVAL_MS = 30000;

export class EventBus extends EventEmitter {
  private clients = new Set<FastifyReply>();

  subscribe(reply: FastifyReply): void {
    this.clients.add(reply);
    this.send(reply, { type: 'connected' });
  }

  unsubscribe(reply: FastifyReply): void {
    this.clients.delete(reply);
  }

  broadcast(event: ServerEvent): void {
    for (const reply of this.clients) {
      this.send(reply, event);
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  private send(reply: FastifyReply, event: ServerEvent): void {
    try {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      this.unsubscribe(reply);
    }
  }
}

export function registerEventRoutes(app: FastifyInstance, eventBus: EventBus): void {
  app.get('/api/events', (request: FastifyRequest, reply: FastifyReply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Content-Encoding': 'identity',
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        eventBus.unsubscribe(reply);
      }
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      eventBus.unsubscribe(reply);
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    eventBus.subscribe(reply);
  });
}
