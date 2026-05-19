/**
 * SSE (Server-Sent Events) route for real-time event streaming.
 *
 * Routes:
 * - GET /api/events: SSE stream with keep-alive pings
 */

import { createLogger } from '@shared/utils/logger';

import type { FastifyInstance, FastifyReply } from 'fastify';

const logger = createLogger('HTTP:events');

const KEEPALIVE_INTERVAL_MS = 30_000;

/** All connected SSE clients */
const clients = new Set<FastifyReply>();

/**
 * Registers the SSE events endpoint.
 */
export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/api/events', async (request, reply) => {
    // Write CORS headers via raw response so the EventStream works
    // cross-origin when the frontend is served by a different dev server.
    const origin = request.headers.origin;
    const corsOrigin = process.env.CORS_ORIGIN;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };
    if (origin && corsOrigin) {
      const allowed =
        corsOrigin === '*' ||
        corsOrigin
          .split(',')
          .map((o) => o.trim())
          .includes(origin);
      if (allowed) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
      }
    }
    reply.raw.writeHead(200, headers);

    clients.add(reply);
    logger.info(`SSE client connected (total: ${clients.size})`);

    // Keep-alive ping
    const timer = setInterval(() => {
      reply.raw.write(':ping\n\n');
    }, KEEPALIVE_INTERVAL_MS);
    // Keepalive should not prevent shutdown (socket already keeps connection alive).
    timer.unref();

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(timer);
      clients.delete(reply);
      logger.info(`SSE client disconnected (total: ${clients.size})`);
    });

    // Prevent Fastify from ending the response
    await reply;
  });
}

/**
 * Broadcasts an event to all connected SSE clients.
 */
export function broadcastEvent(channel: string, data: unknown): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    try {
      client.raw.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
