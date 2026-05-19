/**
 * Schedule HTTP Routes — mirrors IPC handlers in src/main/ipc/schedule.ts.
 *
 * Full CRUD + execution lifecycle for scheduled tasks.
 */

import { createLogger } from '@shared/utils/logger';

import type { HttpServices } from './index';

import type {
  CreateScheduleInput,
  Schedule,
  ScheduleRun,
  UpdateSchedulePatch,
} from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:schedule');

function getSchedulerService(services: HttpServices) {
  if (!services.schedulerService) {
    throw new Error('SchedulerService not available');
  }
  return services.schedulerService;
}

export function registerScheduleRoutes(app: FastifyInstance, services: HttpServices): void {
  // GET /api/schedules
  app.get('/api/schedules', async (_request, reply) => {
    try {
      const data = await getSchedulerService(services).listSchedules();
      return reply.send(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list schedules:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/schedules/:id
  app.get<{ Params: { id: string } }>('/api/schedules/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      if (!id?.trim()) {
        return reply.status(400).send({ error: 'id is required' });
      }
      const data = await getSchedulerService(services).getSchedule(id);
      return reply.send(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get schedule:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/schedules
  app.post<{ Body: CreateScheduleInput }>('/api/schedules', async (request, reply) => {
    try {
      const input = request.body;
      if (!input || typeof input !== 'object') {
        return reply.status(400).send({ error: 'input must be an object' });
      }
      if (!input.teamName || !input.cronExpression || !input.timezone || !input.launchConfig) {
        return reply.status(400).send({
          error: 'Missing required fields: teamName, cronExpression, timezone, launchConfig',
        });
      }
      if (!input.launchConfig.cwd || !input.launchConfig.prompt) {
        return reply.status(400).send({ error: 'launchConfig requires cwd and prompt' });
      }
      const data = await getSchedulerService(services).createSchedule(input);
      return reply.send(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create schedule:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // PATCH /api/schedules/:id
  app.patch<{ Params: { id: string }; Body: UpdateSchedulePatch }>(
    '/api/schedules/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        if (!id?.trim()) {
          return reply.status(400).send({ error: 'id is required' });
        }
        const patch = request.body;
        if (!patch || typeof patch !== 'object') {
          return reply.status(400).send({ error: 'patch must be an object' });
        }
        const data = await getSchedulerService(services).updateSchedule(id, patch);
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to update schedule:', message);
        return reply.status(500).send({ error: message });
      }
    }
  );

  // DELETE /api/schedules/:id
  app.delete<{ Params: { id: string } }>('/api/schedules/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      if (!id?.trim()) {
        return reply.status(400).send({ error: 'id is required' });
      }
      await getSchedulerService(services).deleteSchedule(id);
      return reply.send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to delete schedule:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/schedules/:id/pause
  app.post<{ Params: { id: string } }>('/api/schedules/:id/pause', async (request, reply) => {
    try {
      const { id } = request.params;
      if (!id?.trim()) {
        return reply.status(400).send({ error: 'id is required' });
      }
      await getSchedulerService(services).pauseSchedule(id);
      return reply.send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to pause schedule:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/schedules/:id/resume
  app.post<{ Params: { id: string } }>('/api/schedules/:id/resume', async (request, reply) => {
    try {
      const { id } = request.params;
      if (!id?.trim()) {
        return reply.status(400).send({ error: 'id is required' });
      }
      await getSchedulerService(services).resumeSchedule(id);
      return reply.send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to resume schedule:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/schedules/:id/trigger
  app.post<{ Params: { id: string } }>('/api/schedules/:id/trigger', async (request, reply) => {
    try {
      const { id } = request.params;
      if (!id?.trim()) {
        return reply.status(400).send({ error: 'id is required' });
      }
      const data = await getSchedulerService(services).triggerNow(id);
      return reply.send(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to trigger schedule:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/schedules/:id/runs
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/schedules/:id/runs',
    async (request, reply) => {
      try {
        const { id } = request.params;
        if (!id?.trim()) {
          return reply.status(400).send({ error: 'scheduleId is required' });
        }
        const opts =
          request.query.limit || request.query.offset
            ? {
                limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
                offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
              }
            : undefined;
        const data = await getSchedulerService(services).getRuns(id, opts);
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to get schedule runs:', message);
        return reply.status(500).send({ error: message });
      }
    }
  );

  // GET /api/schedules/:id/runs/:runId/logs
  app.get<{ Params: { id: string; runId: string } }>(
    '/api/schedules/:id/runs/:runId/logs',
    async (request, reply) => {
      try {
        const { id, runId } = request.params;
        if (!id?.trim()) {
          return reply.status(400).send({ error: 'scheduleId is required' });
        }
        if (!runId?.trim()) {
          return reply.status(400).send({ error: 'runId is required' });
        }
        const data = await getSchedulerService(services).getRunLogs(id, runId);
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to get run logs:', message);
        return reply.status(500).send({ error: message });
      }
    }
  );

  logger.info('Schedule routes registered');
}
