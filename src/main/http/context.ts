/**
 * Context HTTP Routes — mirrors IPC handlers in src/main/ipc/context.ts.
 *
 * In standalone mode there is only a single 'local' context; the routes
 * return sensible defaults when no ServiceContextRegistry is wired.
 */

import { createLogger } from '@shared/utils/logger';

import type { HttpServices } from './index';

import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:context');

interface ContextInfo {
  id: string;
  type: 'local' | 'ssh';
}

function localOnly(): ContextInfo[] {
  return [{ id: 'local', type: 'local' }];
}

export function registerContextRoutes(app: FastifyInstance, services: HttpServices): void {
  // GET /api/contexts
  app.get('/api/contexts', async (_request, reply) => {
    try {
      if (services.contextRegistry) {
        return reply.send(services.contextRegistry.list());
      }
      return reply.send(localOnly());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list contexts:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/contexts/active
  app.get('/api/contexts/active', async (_request, reply) => {
    try {
      if (services.contextRegistry) {
        return reply.send(services.contextRegistry.getActiveContextId());
      }
      return reply.send('local');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get active context:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/contexts/switch
  app.post<{ Body: { contextId?: string } }>('/api/contexts/switch', async (request, reply) => {
    try {
      const { contextId } = request.body ?? {};
      if (typeof contextId !== 'string' || !contextId.trim()) {
        return reply.status(400).send({ error: 'contextId is required' });
      }

      if (services.contextRegistry) {
        const { current } = services.contextRegistry.switch(contextId);
        return reply.send({ contextId: current.id });
      }

      if (contextId !== 'local') {
        return reply.status(400).send({ error: `Unknown context: ${contextId}` });
      }
      return reply.send({ contextId: 'local' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Context switch failed:', message);
      return reply.status(500).send({ error: message });
    }
  });

  logger.info('Context routes registered');
}
