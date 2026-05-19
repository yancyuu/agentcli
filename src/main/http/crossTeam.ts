/**
 * Cross-Team HTTP Routes — mirrors IPC handlers in src/main/ipc/crossTeam.ts.
 *
 * Supports cross-team messaging, target discovery, and outbox queries.
 */

import { validateTaskId, validateTeamName } from '@main/ipc/guards';
import { isAgentActionMode } from '@main/services/team/actionModeInstructions';
import { createLogger } from '@shared/utils/logger';

import type { HttpServices } from './index';

import type { TaskRef } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:crossTeam');

function getCrossTeamService(services: HttpServices) {
  if (!services.crossTeamService) {
    throw new Error('CrossTeamService not available');
  }
  return services.crossTeamService;
}

function validateTaskRefs(
  value: unknown
): { valid: true; value: TaskRef[] | undefined } | { valid: false; error: string } {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return { valid: false, error: 'taskRefs must be an array' };
  }

  const taskRefs: TaskRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return { valid: false, error: 'taskRefs entries must be objects' };
    }
    const row = entry as Partial<TaskRef>;
    const taskId = typeof row.taskId === 'string' ? row.taskId.trim() : '';
    const displayId = typeof row.displayId === 'string' ? row.displayId.trim() : '';
    const teamName = typeof row.teamName === 'string' ? row.teamName.trim() : '';
    if (!taskId || !displayId || !teamName) {
      return { valid: false, error: 'Each taskRef must include taskId, displayId, and teamName' };
    }
    const vTaskId = validateTaskId(taskId);
    if (!vTaskId.valid) {
      return { valid: false, error: vTaskId.error ?? 'Invalid taskRef taskId' };
    }
    const vTeamName = validateTeamName(teamName);
    if (!vTeamName.valid) {
      return { valid: false, error: vTeamName.error ?? 'Invalid taskRef teamName' };
    }
    taskRefs.push({ taskId: vTaskId.value!, displayId, teamName: vTeamName.value! });
  }

  return { valid: true, value: taskRefs };
}

export function registerCrossTeamRoutes(app: FastifyInstance, services: HttpServices): void {
  // POST /api/cross-team/send
  app.post<{ Body: Record<string, unknown> }>('/api/cross-team/send', async (request, reply) => {
    try {
      const req = request.body;
      if (!req || typeof req !== 'object') {
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      if (req.actionMode !== undefined && !isAgentActionMode(req.actionMode)) {
        return reply.status(400).send({ error: 'actionMode must be one of: do, ask, delegate' });
      }
      const taskRefs = validateTaskRefs(req.taskRefs);
      if (!taskRefs.valid) {
        return reply.status(400).send({ error: taskRefs.error });
      }

      const data = await getCrossTeamService(services).send({
        fromTeam: String(req.fromTeam ?? ''),
        fromMember: String(req.fromMember ?? ''),
        toTeam: String(req.toTeam ?? ''),
        conversationId: typeof req.conversationId === 'string' ? req.conversationId : undefined,
        replyToConversationId:
          typeof req.replyToConversationId === 'string' ? req.replyToConversationId : undefined,
        text: String(req.text ?? ''),
        taskRefs: taskRefs.value,
        actionMode: isAgentActionMode(req.actionMode) ? req.actionMode : undefined,
        summary: typeof req.summary === 'string' ? req.summary : undefined,
        chainDepth: typeof req.chainDepth === 'number' ? req.chainDepth : undefined,
      });
      return reply.send(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('crossTeam.send failed:', message);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/cross-team/targets
  app.get<{ Querystring: { excludeTeam?: string } }>(
    '/api/cross-team/targets',
    async (request, reply) => {
      try {
        const { excludeTeam } = request.query;
        const data = await getCrossTeamService(services).listAvailableTargets(excludeTeam);
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('crossTeam.listTargets failed:', message);
        return reply.status(500).send({ error: message });
      }
    }
  );

  // GET /api/cross-team/outbox/:teamName
  app.get<{ Params: { teamName: string } }>(
    '/api/cross-team/outbox/:teamName',
    async (request, reply) => {
      try {
        const { teamName } = request.params;
        if (!teamName?.trim()) {
          return reply.status(400).send({ error: 'teamName is required' });
        }
        const data = await getCrossTeamService(services).getOutbox(teamName);
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('crossTeam.getOutbox failed:', message);
        return reply.status(500).send({ error: message });
      }
    }
  );

  logger.info('Cross-team routes registered');
}
