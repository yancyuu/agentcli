import { validateMemberName, validateTaskId, validateTeamName } from '@main/ipc/guards';
import { getLeadChannelListenerService } from '@main/services/team/LeadChannelListenerService';
import { getTeamTemplateSourceService } from '@main/services/team/TeamTemplateSourceService';
import {
  formatEffortLevelListForProvider,
  isTeamEffortLevelForProvider,
} from '@shared/utils/effortLevels';
import { getErrorMessage } from '@shared/utils/errorHandling';
import { createLogger } from '@shared/utils/logger';
import { migrateProviderBackendId } from '@shared/utils/providerBackend';
import { isTeamProviderId } from '@shared/utils/teamProvider';
import { isAbsolute } from 'path';

import type { HttpServices } from './index';
import type {
  CreateTaskRequest,
  EffortLevel,
  SaveLeadChannelConfigRequest,
  TeamCreateConfigRequest,
  TeamCreateRequest,
  TeamFastMode,
  TeamLaunchRequest,
  TeamProvisioningModelVerificationMode,
  UpdateKanbanPatch,
} from '@shared/types/team';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:teams');

type LaunchBody = Omit<TeamLaunchRequest, 'teamName'>;

class HttpBadRequestError extends Error {}
class HttpFeatureUnavailableError extends Error {}

function getTeamProvisioningService(services: HttpServices) {
  if (!services.teamProvisioningService) {
    throw new HttpFeatureUnavailableError('Team runtime control is not available in this mode');
  }
  return services.teamProvisioningService;
}

function getTeamDataService(services: HttpServices) {
  if (!services.teamDataService) {
    throw new HttpFeatureUnavailableError('Team data service is not available in this mode');
  }
  return services.teamDataService;
}

function getTeamMemberLogsFinder(services: HttpServices) {
  if (!services.teamMemberLogsFinder) {
    throw new HttpFeatureUnavailableError('Team member logs finder is not available in this mode');
  }
  return services.teamMemberLogsFinder;
}

function getBoardTaskActivityService(services: HttpServices) {
  if (!services.boardTaskActivityService) {
    throw new HttpFeatureUnavailableError(
      'Board task activity service is not available in this mode'
    );
  }
  return services.boardTaskActivityService;
}

function getBoardTaskActivityDetailService(services: HttpServices) {
  if (!services.boardTaskActivityDetailService) {
    throw new HttpFeatureUnavailableError(
      'Board task activity detail service is not available in this mode'
    );
  }
  return services.boardTaskActivityDetailService;
}

function getBoardTaskLogStreamService(services: HttpServices) {
  if (!services.boardTaskLogStreamService) {
    throw new HttpFeatureUnavailableError(
      'Board task log stream service is not available in this mode'
    );
  }
  return services.boardTaskLogStreamService;
}

function getBoardTaskExactLogsService(services: HttpServices) {
  if (!services.boardTaskExactLogsService) {
    throw new HttpFeatureUnavailableError(
      'Board task exact logs service is not available in this mode'
    );
  }
  return services.boardTaskExactLogsService;
}

function getBoardTaskExactLogDetailService(services: HttpServices) {
  if (!services.boardTaskExactLogDetailService) {
    throw new HttpFeatureUnavailableError(
      'Board task exact log detail service is not available in this mode'
    );
  }
  return services.boardTaskExactLogDetailService;
}

function getStatusCode(error: unknown, fallback: number = 500): number {
  if (error instanceof HttpBadRequestError) {
    return 400;
  }
  if (error instanceof HttpFeatureUnavailableError) {
    return 501;
  }
  if (error instanceof Error && error.name === 'RuntimeStaleEvidenceError') {
    return 409;
  }
  return fallback;
}

function shouldLogError(error: unknown): boolean {
  return !(error instanceof HttpBadRequestError) && !(error instanceof HttpFeatureUnavailableError);
}

function assertAbsoluteCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    throw new HttpBadRequestError('cwd must be a non-empty string');
  }

  const normalized = cwd.trim();
  if (!isAbsolute(normalized)) {
    throw new HttpBadRequestError('cwd must be an absolute path');
  }

  return normalized;
}

function assertOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new HttpBadRequestError(`${fieldName} must be a string`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function assertOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new HttpBadRequestError(`${fieldName} must be a boolean`);
  }

  return value;
}

function assertOptionalEffort(
  value: unknown,
  providerId: TeamLaunchRequest['providerId']
): EffortLevel | undefined {
  if (value == null) {
    return undefined;
  }

  if (!isTeamEffortLevelForProvider(value, providerId)) {
    throw new HttpBadRequestError(
      `effort must be one of: ${formatEffortLevelListForProvider(providerId)}`
    );
  }

  return value;
}

function assertOptionalFastMode(value: unknown): TeamFastMode | undefined {
  if (value == null) {
    return undefined;
  }

  if (value !== 'inherit' && value !== 'on' && value !== 'off') {
    throw new HttpBadRequestError('fastMode must be one of: inherit, on, off');
  }

  return value;
}

function parseLaunchRequest(teamName: string, body: unknown): TeamLaunchRequest {
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const providerId =
    payload.providerId == null
      ? 'anthropic'
      : isTeamProviderId(payload.providerId)
        ? payload.providerId
        : (() => {
            throw new HttpBadRequestError(
              'providerId must be anthropic, codex, gemini, or opencode'
            );
          })();
  const prompt = assertOptionalString(payload.prompt, 'prompt');
  const rawProviderBackendId = assertOptionalString(payload.providerBackendId, 'providerBackendId');
  const providerBackendId = migrateProviderBackendId(providerId, rawProviderBackendId);
  if (rawProviderBackendId && !providerBackendId) {
    throw new HttpBadRequestError(
      'providerBackendId must be one of auto, adapter, api, cli-sdk, or codex-native'
    );
  }
  const model = assertOptionalString(payload.model, 'model');
  const effort = assertOptionalEffort(payload.effort, providerId);
  const fastMode = assertOptionalFastMode(payload.fastMode);
  const clearContext = assertOptionalBoolean(payload.clearContext, 'clearContext');
  const skipPermissions = assertOptionalBoolean(payload.skipPermissions, 'skipPermissions');
  const worktree = assertOptionalString(payload.worktree, 'worktree');
  const extraCliArgs = assertOptionalString(payload.extraCliArgs, 'extraCliArgs');

  return {
    teamName,
    cwd: assertAbsoluteCwd(payload.cwd),
    providerId,
    ...(providerBackendId && {
      providerBackendId,
    }),
    ...(prompt && {
      prompt,
    }),
    ...(model && {
      model,
    }),
    ...(effort && {
      effort,
    }),
    ...(fastMode && {
      fastMode,
    }),
    ...(clearContext !== undefined && {
      clearContext,
    }),
    ...(skipPermissions !== undefined && {
      skipPermissions,
    }),
    ...(worktree && {
      worktree,
    }),
    ...(extraCliArgs && {
      extraCliArgs,
    }),
  };
}

function withRuntimeTeamName(teamName: string, body: unknown): Record<string, unknown> {
  const payload =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const bodyTeamName = typeof payload.teamName === 'string' ? payload.teamName.trim() : '';
  if (bodyTeamName && bodyTeamName !== teamName) {
    throw new HttpBadRequestError('runtime body teamName must match route teamName');
  }
  return { ...payload, teamName };
}

export function registerTeamRoutes(app: FastifyInstance, services: HttpServices): void {
  // ---------------------------------------------------------------------------
  // Fixed-path data routes MUST come before parameterized routes
  // (fastify matches first-registered; /api/teams would otherwise conflict)
  // ---------------------------------------------------------------------------

  // List all teams
  app.get('/api/teams', async (_request, reply) => {
    try {
      const teams = await getTeamDataService(services).listTeams();
      return reply.send(teams);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/teams:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get all tasks (global, across teams)
  app.get('/api/teams/tasks', async (_request, reply) => {
    try {
      const tasks = await getTeamDataService(services).getAllTasks();
      return reply.send(tasks);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/teams/tasks:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // List template sources
  app.get('/api/teams/templates', async (_request, reply) => {
    try {
      const result = await getTeamTemplateSourceService().getSnapshot();
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/teams/templates:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Parameterized team routes
  // ---------------------------------------------------------------------------

  app.post<{ Params: { teamName: string }; Body: LaunchBody }>(
    '/api/teams/:teamName/launch',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }

        const launchRequest = parseLaunchRequest(validatedTeamName.value!, request.body);
        const response = await getTeamProvisioningService(services).launchTeam(
          launchRequest,
          () => undefined
        );
        return reply.send(response);
      } catch (error) {
        const statusCode = getStatusCode(error);
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/launch:`,
            getErrorMessage(error)
          );
        }
        return reply.status(statusCode).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.post<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/stop',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }

        const teamProvisioningService = getTeamProvisioningService(services);
        await teamProvisioningService.stopTeam(validatedTeamName.value!);
        return reply.send(await teamProvisioningService.getRuntimeState(validatedTeamName.value!));
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/stop:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/runtime',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }

        return reply.send(
          await getTeamProvisioningService(services).getRuntimeState(validatedTeamName.value!)
        );
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/runtime:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.get<{ Params: { runId: string } }>(
    '/api/teams/provisioning/:runId',
    async (request, reply) => {
      try {
        const runId = request.params.runId?.trim();
        if (!runId) {
          return reply.status(400).send({ error: 'runId is required' });
        }

        return reply.send(await getTeamProvisioningService(services).getProvisioningStatus(runId));
      } catch (error) {
        const message = getErrorMessage(error);
        const statusCode = message === 'Unknown runId' ? 404 : getStatusCode(error);
        if (shouldLogError(error) && statusCode !== 404) {
          logger.error(`Error in GET /api/teams/provisioning/${request.params.runId}:`, message);
        }
        return reply.status(statusCode).send({ error: message });
      }
    }
  );

  app.get('/api/teams/runtime/alive', async (_request, reply) => {
    try {
      const teamProvisioningService = getTeamProvisioningService(services);
      const runtimeStates = await Promise.all(
        teamProvisioningService
          .getAliveTeams()
          .map((teamName) => teamProvisioningService.getRuntimeState(teamName))
      );
      return reply.send(runtimeStates);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/teams/runtime/alive:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  app.post<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/opencode/runtime/bootstrap-checkin',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        return reply.send(
          await getTeamProvisioningService(services).recordOpenCodeRuntimeBootstrapCheckin(
            withRuntimeTeamName(validatedTeamName.value!, request.body)
          )
        );
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/opencode/runtime/bootstrap-checkin:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.post<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/opencode/runtime/deliver-message',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        return reply.send(
          await getTeamProvisioningService(services).deliverOpenCodeRuntimeMessage(
            withRuntimeTeamName(validatedTeamName.value!, request.body)
          )
        );
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/opencode/runtime/deliver-message:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.post<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/opencode/runtime/task-event',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        return reply.send(
          await getTeamProvisioningService(services).recordOpenCodeRuntimeTaskEvent(
            withRuntimeTeamName(validatedTeamName.value!, request.body)
          )
        );
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/opencode/runtime/task-event:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  app.post<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/opencode/runtime/heartbeat',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        return reply.send(
          await getTeamProvisioningService(services).recordOpenCodeRuntimeHeartbeat(
            withRuntimeTeamName(validatedTeamName.value!, request.body)
          )
        );
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/opencode/runtime/heartbeat:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Team data routes (read-only, powered by TeamDataService)
  // ---------------------------------------------------------------------------

  // Get team data (full snapshot)
  app.get<{ Params: { teamName: string } }>('/api/teams/:teamName/data', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const data = await getTeamDataService(services).getTeamData(validatedTeamName.value!);
      return reply.send(data);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/data:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get saved launch request (runtime settings from last launch)
  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/saved-request',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const tn = validatedTeamName.value!;
        const { TeamMetaStore } = await import('../services/team/TeamMetaStore');
        const { TeamMembersMetaStore } = await import('../services/team/TeamMembersMetaStore');
        const teamMetaStore = new TeamMetaStore();
        const meta = await teamMetaStore.getMeta(tn);
        if (!meta) {
          return reply.send(null);
        }
        const membersStore = new TeamMembersMetaStore();
        const membersMeta = await membersStore.getMeta(tn);
        const members = membersMeta?.members ?? [];
        const resolvedProviderId = meta.providerId ?? 'anthropic';
        return reply.send({
          teamName: tn,
          displayName: meta.displayName,
          description: meta.description,
          color: meta.color,
          cwd: meta.cwd,
          prompt: meta.prompt,
          providerId: resolvedProviderId,
          providerBackendId: migrateProviderBackendId(
            resolvedProviderId,
            meta.providerBackendId ?? membersMeta?.providerBackendId
          ),
          model: meta.model,
          effort: meta.effort,
          fastMode: meta.fastMode,
          skipPermissions: meta.skipPermissions,
          worktree: meta.worktree,
          extraCliArgs: meta.extraCliArgs,
          limitContext: meta.limitContext,
          members: members.map((m) => ({
            name: m.name,
            role: m.role,
            workflow: m.workflow,
            providerId: m.providerId,
            model: m.model,
            effort: m.effort,
          })),
        });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/saved-request:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get messages page
  app.get<{ Params: { teamName: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/teams/:teamName/messages',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const cursor = request.query.cursor ?? null;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        const page = await getTeamDataService(services).getMessagesPage(validatedTeamName.value!, {
          cursor,
          limit,
        });
        return reply.send(page);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/messages:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get member activity meta
  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/member-activity',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const meta = await getTeamDataService(services).getMemberActivityMeta(
          validatedTeamName.value!
        );
        return reply.send(meta);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/member-activity:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Send message to team
  app.post<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/send-message',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const body = request.body ?? {};
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) {
          return reply.status(400).send({ error: 'text is required' });
        }
        const result = await getTeamDataService(services).sendMessage(validatedTeamName.value!, {
          member: typeof body.member === 'string' ? body.member : 'lead',
          text,
          from: typeof body.from === 'string' ? body.from : 'user',
          to: typeof body.to === 'string' ? body.to : undefined,
          taskRefs: Array.isArray(body.taskRefs) ? body.taskRefs : undefined,
        });
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/send-message:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Task management routes
  // ---------------------------------------------------------------------------

  // Create task
  app.post<{ Params: { teamName: string }; Body: CreateTaskRequest }>(
    '/api/teams/:teamName/tasks',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const task = await getTeamDataService(services).createTask(
          validatedTeamName.value!,
          request.body
        );
        return reply.send(task);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/tasks:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Update task status
  app.patch<{ Params: { teamName: string; taskId: string }; Body: { status: string } }>(
    '/api/teams/:teamName/tasks/:taskId/status',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const status = request.body?.status;
        if (typeof status !== 'string' || !status.trim()) {
          return reply.status(400).send({ error: 'status is required' });
        }
        await getTeamDataService(services).updateTaskStatus(
          validatedTeamName.value!,
          validatedTaskId.value!,
          status as 'pending' | 'in_progress' | 'completed' | 'deleted'
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in PATCH /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/status:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Update task owner
  app.patch<{ Params: { teamName: string; taskId: string }; Body: { owner: string | null } }>(
    '/api/teams/:teamName/tasks/:taskId/owner',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const owner = request.body?.owner ?? null;
        await getTeamDataService(services).updateTaskOwner(
          validatedTeamName.value!,
          validatedTaskId.value!,
          typeof owner === 'string' ? owner : null
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in PATCH /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/owner:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Update task fields (subject, description)
  app.patch<{
    Params: { teamName: string; taskId: string };
    Body: { subject?: string; description?: string };
  }>('/api/teams/:teamName/tasks/:taskId/fields', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      await getTeamDataService(services).updateTaskFields(
        validatedTeamName.value!,
        validatedTaskId.value!,
        request.body ?? {}
      );
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in PATCH /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/fields:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Soft-delete task
  app.delete<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/tasks/:taskId',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        await getTeamDataService(services).softDeleteTask(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in DELETE /api/teams/${request.params.teamName}/tasks/${request.params.taskId}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Restore task
  app.post<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/tasks/:taskId/restore',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        await getTeamDataService(services).restoreTask(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/restore:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Add task comment
  app.post<{
    Params: { teamName: string; taskId: string };
    Body: { text: string; attachments?: unknown[]; taskRefs?: unknown[] };
  }>('/api/teams/:teamName/tasks/:taskId/comments', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      const body = request.body ?? {};
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text.trim()) {
        return reply.status(400).send({ error: 'text is required' });
      }
      const comment = await getTeamDataService(services).addTaskComment(
        validatedTeamName.value!,
        validatedTaskId.value!,
        text,
        Array.isArray(body.attachments) ? (body.attachments as any[]) : undefined,
        Array.isArray(body.taskRefs) ? (body.taskRefs as any[]) : undefined
      );
      return reply.send(comment);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in POST /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/comments:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Start task
  app.post<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/tasks/:taskId/start',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const result = await getTeamDataService(services).startTask(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/start:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Start task by user
  app.post<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/tasks/:taskId/start-by-user',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const result = await getTeamDataService(services).startTaskByUser(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/start-by-user:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Add task relationship
  app.post<{
    Params: { teamName: string; taskId: string };
    Body: { targetId: string; type: 'blockedBy' | 'blocks' | 'related' };
  }>('/api/teams/:teamName/tasks/:taskId/relationships', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      const body = request.body ?? {};
      const targetId = typeof body.targetId === 'string' ? body.targetId : '';
      if (!targetId.trim()) {
        return reply.status(400).send({ error: 'targetId is required' });
      }
      const type = body.type;
      if (type !== 'blockedBy' && type !== 'blocks' && type !== 'related') {
        return reply.status(400).send({ error: 'type must be one of: blockedBy, blocks, related' });
      }
      await getTeamDataService(services).addTaskRelationship(
        validatedTeamName.value!,
        validatedTaskId.value!,
        targetId,
        type
      );
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in POST /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/relationships:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Remove task relationship
  app.delete<{
    Params: { teamName: string; taskId: string };
    Body: { targetId: string; type: 'blockedBy' | 'blocks' | 'related' };
  }>('/api/teams/:teamName/tasks/:taskId/relationships', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      const body = request.body ?? {};
      const targetId = typeof body.targetId === 'string' ? body.targetId : '';
      if (!targetId.trim()) {
        return reply.status(400).send({ error: 'targetId is required' });
      }
      const type = body.type;
      if (type !== 'blockedBy' && type !== 'blocks' && type !== 'related') {
        return reply.status(400).send({ error: 'type must be one of: blockedBy, blocks, related' });
      }
      await getTeamDataService(services).removeTaskRelationship(
        validatedTeamName.value!,
        validatedTaskId.value!,
        targetId,
        type
      );
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in DELETE /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/relationships:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Update kanban (review/approve/request-changes)
  app.patch<{ Params: { teamName: string; taskId: string }; Body: UpdateKanbanPatch }>(
    '/api/teams/:teamName/kanban/:taskId',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        await getTeamDataService(services).updateKanban(
          validatedTeamName.value!,
          validatedTaskId.value!,
          request.body
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in PATCH /api/teams/${request.params.teamName}/kanban/${request.params.taskId}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Update kanban column order
  app.put<{
    Params: { teamName: string };
    Body: { columnId: string; orderedTaskIds: string[] };
  }>('/api/teams/:teamName/kanban/column-order', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const body = request.body ?? {};
      const columnId = typeof body.columnId === 'string' ? body.columnId : '';
      if (!columnId.trim()) {
        return reply.status(400).send({ error: 'columnId is required' });
      }
      if (!Array.isArray(body.orderedTaskIds)) {
        return reply.status(400).send({ error: 'orderedTaskIds must be an array' });
      }
      await getTeamDataService(services).updateKanbanColumnOrder(
        validatedTeamName.value!,
        columnId as any,
        body.orderedTaskIds
      );
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in PUT /api/teams/${request.params.teamName}/kanban/column-order:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Request review
  app.post<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/tasks/:taskId/review',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        await getTeamDataService(services).requestReview(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/tasks/${request.params.taskId}/review:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Team management routes
  // ---------------------------------------------------------------------------

  // Permanently delete team (MUST be registered before DELETE /api/teams/:teamName)
  app.delete<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/permanent',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        await getTeamDataService(services).permanentlyDeleteTeam(validatedTeamName.value!);
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in DELETE /api/teams/${request.params.teamName}/permanent:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Delete team (soft)
  app.delete<{ Params: { teamName: string } }>('/api/teams/:teamName', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      await getTeamDataService(services).deleteTeam(validatedTeamName.value!);
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in DELETE /api/teams/${request.params.teamName}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Restore team
  app.post<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/restore',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        await getTeamDataService(services).restoreTeam(validatedTeamName.value!);
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/restore:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Update team config
  app.put<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/config',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const result = await getTeamDataService(services).updateConfig(
          validatedTeamName.value!,
          request.body ?? {}
        );
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in PUT /api/teams/${request.params.teamName}/config:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Member management routes
  // ---------------------------------------------------------------------------

  // Add member
  app.post<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/members',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const body = request.body as Record<string, unknown>;
        if (body.action === 'replace') {
          await getTeamDataService(services).replaceMembers(validatedTeamName.value!, {
            members: body.members as any,
          });
        } else {
          await getTeamDataService(services).addMember(validatedTeamName.value!, body as any);
        }
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/members:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Remove member
  app.delete<{ Params: { teamName: string; memberName: string } }>(
    '/api/teams/:teamName/members/:memberName',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedMemberName = validateMemberName(request.params.memberName);
        if (!validatedMemberName.valid) {
          return reply.status(400).send({ error: validatedMemberName.error });
        }
        await getTeamDataService(services).removeMember(
          validatedTeamName.value!,
          validatedMemberName.value!
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in DELETE /api/teams/${request.params.teamName}/members/${request.params.memberName}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Replace members
  app.put<{ Params: { teamName: string }; Body: Record<string, unknown> }>(
    '/api/teams/:teamName/members',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        await getTeamDataService(services).replaceMembers(
          validatedTeamName.value!,
          request.body as any
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in PUT /api/teams/${request.params.teamName}/members:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Update member role
  app.patch<{
    Params: { teamName: string; memberName: string };
    Body: { role?: string };
  }>('/api/teams/:teamName/members/:memberName/role', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedMemberName = validateMemberName(request.params.memberName);
      if (!validatedMemberName.valid) {
        return reply.status(400).send({ error: validatedMemberName.error });
      }
      const result = await getTeamDataService(services).updateMemberRole(
        validatedTeamName.value!,
        validatedMemberName.value!,
        request.body?.role
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in PATCH /api/teams/${request.params.teamName}/members/${request.params.memberName}/role:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Activity / logs routes
  // ---------------------------------------------------------------------------

  // Get deleted tasks
  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/deleted-tasks',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const tasks = await getTeamDataService(services).getDeletedTasks(validatedTeamName.value!);
        return reply.send(tasks);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/deleted-tasks:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Set task needs clarification
  app.post<{
    Params: { teamName: string; taskId: string };
    Body: { value: 'lead' | 'user' | null };
  }>('/api/teams/:teamName/task-clarification/:taskId', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      const value = request.body?.value ?? null;
      await getTeamDataService(services).setTaskNeedsClarification(
        validatedTeamName.value!,
        validatedTaskId.value!,
        value
      );
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in POST /api/teams/${request.params.teamName}/task-clarification/${request.params.taskId}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Activity / logs routes (powered by standalone services)
  // ---------------------------------------------------------------------------

  // Get member logs
  app.get<{ Params: { teamName: string; memberName: string } }>(
    '/api/teams/:teamName/member-logs/:memberName',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedMemberName = validateMemberName(request.params.memberName);
        if (!validatedMemberName.valid) {
          return reply.status(400).send({ error: validatedMemberName.error });
        }
        const logs = await getTeamMemberLogsFinder(services).findMemberLogs(
          validatedTeamName.value!,
          validatedMemberName.value!
        );
        return reply.send(logs);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/member-logs/${request.params.memberName}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get logs for task
  app.get<{
    Params: { teamName: string; taskId: string };
    Querystring: { owner?: string; status?: string; since?: string };
  }>('/api/teams/:teamName/task-logs/:taskId', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      const query = request.query;
      const opts =
        query.owner || query.status || query.since
          ? {
              owner: query.owner || undefined,
              status: query.status || undefined,
              since: query.since || undefined,
            }
          : undefined;
      const logs = await getTeamMemberLogsFinder(services).findLogsForTask(
        validatedTeamName.value!,
        validatedTaskId.value!,
        opts
      );
      return reply.send(logs);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/task-logs/${request.params.taskId}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get task activity
  app.get<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/task-activity/:taskId',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const activity = await getBoardTaskActivityService(services).getTaskActivity(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send(activity);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/task-activity/${request.params.taskId}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get task activity detail
  app.get<{
    Params: { teamName: string };
    Querystring: { taskId?: string; activityId?: string };
  }>('/api/teams/:teamName/task-activity-detail', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const taskId = request.query.taskId;
      if (!taskId || !taskId.trim()) {
        return reply.status(400).send({ error: 'taskId query parameter is required' });
      }
      const activityId = request.query.activityId;
      if (!activityId || !activityId.trim()) {
        return reply.status(400).send({ error: 'activityId query parameter is required' });
      }
      const detail = await getBoardTaskActivityDetailService(services).getTaskActivityDetail(
        validatedTeamName.value!,
        taskId.trim(),
        activityId.trim()
      );
      return reply.send(detail);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/task-activity-detail:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get task log stream
  app.get<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/task-log-stream/:taskId',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const stream = await getBoardTaskLogStreamService(services).getTaskLogStream(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send(stream);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/task-log-stream/${request.params.taskId}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get task log stream summary
  app.get<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/task-log-stream-summary/:taskId',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const summary = await getBoardTaskLogStreamService(services).getTaskLogStreamSummary(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send(summary);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/task-log-stream-summary/${request.params.taskId}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get task exact log summaries
  app.get<{ Params: { teamName: string; taskId: string } }>(
    '/api/teams/:teamName/exact-log-summaries/:taskId',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedTaskId = validateTaskId(request.params.taskId);
        if (!validatedTaskId.valid) {
          return reply.status(400).send({ error: validatedTaskId.error });
        }
        const summaries = await getBoardTaskExactLogsService(services).getTaskExactLogSummaries(
          validatedTeamName.value!,
          validatedTaskId.value!
        );
        return reply.send(summaries);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/exact-log-summaries/${request.params.taskId}:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get task exact log detail
  app.get<{
    Params: { teamName: string; taskId: string };
    Querystring: { exactLogId?: string; expectedSourceGeneration?: string };
  }>('/api/teams/:teamName/exact-log-detail/:taskId', async (request, reply) => {
    try {
      const validatedTeamName = validateTeamName(request.params.teamName);
      if (!validatedTeamName.valid) {
        return reply.status(400).send({ error: validatedTeamName.error });
      }
      const validatedTaskId = validateTaskId(request.params.taskId);
      if (!validatedTaskId.valid) {
        return reply.status(400).send({ error: validatedTaskId.error });
      }
      const exactLogId = request.query.exactLogId;
      if (!exactLogId || !exactLogId.trim()) {
        return reply.status(400).send({ error: 'exactLogId query parameter is required' });
      }
      const expectedSourceGeneration = request.query.expectedSourceGeneration;
      if (!expectedSourceGeneration || !expectedSourceGeneration.trim()) {
        return reply
          .status(400)
          .send({ error: 'expectedSourceGeneration query parameter is required' });
      }
      const detail = await getBoardTaskExactLogDetailService(services).getTaskExactLogDetail(
        validatedTeamName.value!,
        validatedTaskId.value!,
        exactLogId.trim(),
        expectedSourceGeneration.trim()
      );
      return reply.send(detail);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/exact-log-detail/${request.params.taskId}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Process management routes
  // ---------------------------------------------------------------------------

  // Kill process
  app.post<{ Params: { teamName: string }; Body: { pid: number } }>(
    '/api/teams/:teamName/kill-process',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const pid = request.body?.pid;
        if (typeof pid !== 'number' || !Number.isInteger(pid)) {
          return reply.status(400).send({ error: 'pid must be an integer' });
        }
        await getTeamDataService(services).killProcess(validatedTeamName.value!, pid);
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/kill-process:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Provisioning routes
  // ---------------------------------------------------------------------------

  // Prepare provisioning
  app.post<{
    Body: {
      cwd?: string;
      providerId?: string;
      providerIds?: string[];
      selectedModels?: string[];
      limitContext?: boolean;
      modelVerificationMode?: TeamProvisioningModelVerificationMode;
    };
  }>('/api/teams/provisioning/prepare', async (request, reply) => {
    try {
      const body = request.body ?? {};
      let validatedCwd: string | undefined;
      if (body.cwd) {
        if (typeof body.cwd !== 'string' || !body.cwd.trim()) {
          return reply.status(400).send({ error: 'cwd must be a non-empty string' });
        }
        validatedCwd = body.cwd.trim();
        if (!isAbsolute(validatedCwd)) {
          return reply.status(400).send({ error: 'cwd must be an absolute path' });
        }
      }
      const validatedProviderId = isTeamProviderId(body.providerId) ? body.providerId : undefined;
      const validatedProviderIds = Array.isArray(body.providerIds)
        ? body.providerIds.filter(isTeamProviderId)
        : undefined;
      const validatedSelectedModels = Array.isArray(body.selectedModels)
        ? body.selectedModels.filter((m: unknown) => typeof m === 'string')
        : undefined;

      const result = await getTeamProvisioningService(services).prepareForProvisioning(
        validatedCwd,
        {
          providerId: validatedProviderId,
          providerIds: validatedProviderIds,
          modelIds: validatedSelectedModels,
          limitContext: body.limitContext,
          modelVerificationMode: body.modelVerificationMode,
        }
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/teams/provisioning/prepare:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Cancel provisioning
  app.post<{ Params: { runId: string } }>(
    '/api/teams/provisioning/:runId/cancel',
    async (request, reply) => {
      try {
        const runId = request.params.runId?.trim();
        if (!runId) {
          return reply.status(400).send({ error: 'runId is required' });
        }
        await getTeamProvisioningService(services).cancelProvisioning(runId);
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/provisioning/${request.params.runId}/cancel:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Create team (draft)
  app.post<{ Body: Record<string, unknown> }>('/api/teams/create', async (request, reply) => {
    try {
      const result = await getTeamProvisioningService(services).createTeam(
        request.body as unknown as TeamCreateRequest,
        () => undefined
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/teams/create:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Template source routes
  // ---------------------------------------------------------------------------

  // Save template sources
  app.post<{ Body: Record<string, unknown>[] }>(
    '/api/teams/templates/save',
    async (request, reply) => {
      try {
        const result = await getTeamTemplateSourceService().saveSources(request.body);
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error('Error in POST /api/teams/templates/save:', getErrorMessage(error));
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Refresh template sources
  app.post('/api/teams/templates/refresh', async (_request, reply) => {
    try {
      const result = await getTeamTemplateSourceService().refreshSources();
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/teams/templates/refresh:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Draft / config routes
  // ---------------------------------------------------------------------------

  // Delete draft team
  app.delete<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/draft',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        await getTeamDataService(services).permanentlyDeleteTeam(validatedTeamName.value!);
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in DELETE /api/teams/${request.params.teamName}/draft:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Create config
  app.post<{ Body: TeamCreateConfigRequest }>('/api/teams/config', async (request, reply) => {
    try {
      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      await getTeamDataService(services).createTeamConfig(body);
      return reply.send({ ok: true });
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/teams/config:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // ---------------------------------------------------------------------------
  // Process communication & member management routes
  // ---------------------------------------------------------------------------

  // Process send (stdin message to team)
  app.post<{ Params: { teamName: string }; Body: { message: string } }>(
    '/api/teams/:teamName/process-send',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const message = request.body?.message;
        if (typeof message !== 'string' || !message.trim()) {
          return reply.status(400).send({ error: 'message must be a non-empty string' });
        }
        await getTeamProvisioningService(services).sendMessageToTeam(
          validatedTeamName.value!,
          message
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/process-send:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Restart member
  app.post<{ Params: { teamName: string; memberName: string } }>(
    '/api/teams/:teamName/members/:memberName/restart',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedMemberName = validateMemberName(request.params.memberName);
        if (!validatedMemberName.valid) {
          return reply.status(400).send({ error: validatedMemberName.error });
        }
        await getTeamProvisioningService(services).restartMember(
          validatedTeamName.value!,
          validatedMemberName.value!
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/members/${request.params.memberName}/restart:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Skip member for launch
  app.post<{ Params: { teamName: string; memberName: string } }>(
    '/api/teams/:teamName/members/:memberName/skip',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const validatedMemberName = validateMemberName(request.params.memberName);
        if (!validatedMemberName.valid) {
          return reply.status(400).send({ error: validatedMemberName.error });
        }
        await getTeamProvisioningService(services).skipMemberForLaunch(
          validatedTeamName.value!,
          validatedMemberName.value!
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/members/${request.params.memberName}/skip:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Lead channel / Feishu routes
  // ---------------------------------------------------------------------------

  // Get lead activity
  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/lead-activity',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const result = await getTeamProvisioningService(services).getLeadActivityState(
          validatedTeamName.value!
        );
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/lead-activity:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get lead context
  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/lead-context',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const result = await getTeamProvisioningService(services).getLeadContextUsage(
          validatedTeamName.value!
        );
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/lead-context:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get lead channel (team-specific)
  app.get<{ Params: { teamName: string } }>(
    '/api/teams/:teamName/lead-channel',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const result = await getLeadChannelListenerService().getSnapshot(validatedTeamName.value!);
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in GET /api/teams/${request.params.teamName}/lead-channel:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Save lead channel (team-specific)
  app.post<{ Params: { teamName: string }; Body: SaveLeadChannelConfigRequest }>(
    '/api/teams/:teamName/lead-channel/save',
    async (request, reply) => {
      try {
        const validatedTeamName = validateTeamName(request.params.teamName);
        if (!validatedTeamName.valid) {
          return reply.status(400).send({ error: validatedTeamName.error });
        }
        const body = request.body;
        if (!body || typeof body !== 'object') {
          return reply.status(400).send({ error: 'Invalid lead channel payload' });
        }
        const feishu = body.feishu;
        if (!feishu || typeof feishu !== 'object') {
          return reply.status(400).send({ error: 'feishu config is required' });
        }
        const result = await getLeadChannelListenerService().saveConfig(validatedTeamName.value!, {
          channels: Array.isArray(body.channels) ? body.channels : undefined,
          feishu: {
            enabled: feishu.enabled === true,
            appId: String(feishu.appId),
            appSecret: String(feishu.appSecret),
          },
        });
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            `Error in POST /api/teams/${request.params.teamName}/lead-channel/save:`,
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Get global lead channel
  app.get('/api/teams/lead-channel/global', async (_request, reply) => {
    try {
      const result = await getLeadChannelListenerService().getGlobalSnapshot();
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/teams/lead-channel/global:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Save global lead channel
  app.post<{ Body: SaveLeadChannelConfigRequest }>(
    '/api/teams/lead-channel/global/save',
    async (request, reply) => {
      try {
        const body = request.body;
        if (!body || typeof body !== 'object') {
          return reply.status(400).send({ error: 'Invalid lead channel payload' });
        }
        const feishu = body.feishu;
        if (!feishu || typeof feishu !== 'object') {
          return reply.status(400).send({ error: 'feishu config is required' });
        }
        const result = await getLeadChannelListenerService().saveGlobalConfig({
          channels: Array.isArray(body.channels) ? body.channels : undefined,
          feishu: {
            enabled: feishu.enabled === true,
            appId: String(feishu.appId),
            appSecret: String(feishu.appSecret),
          },
        });
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            'Error in POST /api/teams/lead-channel/global/save:',
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Start Feishu lead channel
  app.post<{ Body: { channelId?: string } }>(
    '/api/teams/lead-channel/feishu/start',
    async (request, reply) => {
      try {
        const channelId = request.body?.channelId?.trim() || 'feishu-default';
        const result = await getLeadChannelListenerService().startFeishu(channelId);
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            'Error in POST /api/teams/lead-channel/feishu/start:',
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Stop Feishu lead channel
  app.post<{ Body: { channelId?: string } }>(
    '/api/teams/lead-channel/feishu/stop',
    async (request, reply) => {
      try {
        const channelId = request.body?.channelId?.trim() || undefined;
        const result = await getLeadChannelListenerService().stopFeishu(channelId);
        return reply.send(result);
      } catch (error) {
        if (shouldLogError(error)) {
          logger.error(
            'Error in POST /api/teams/lead-channel/feishu/stop:',
            getErrorMessage(error)
          );
        }
        return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
      }
    }
  );
}
