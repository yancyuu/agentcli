/**
 * HTTP route handlers for Skills catalog.
 *
 * Mirrors src/main/ipc/skills.ts for standalone/web mode.
 */

import { createLogger } from '@shared/utils/logger';

import type { SkillsCatalogService } from '../services/extensions/skills/SkillsCatalogService';
import type { SkillsMutationService } from '../services/extensions/skills/SkillsMutationService';
import type { SkillSourceService } from '../services/extensions/skills/SkillSourceService';
import type { SkillsWatcherService } from '../services/extensions/skills/SkillsWatcherService';
import type { HttpServices } from './index';

import type {
  SkillCatalogItem,
  SkillDeleteRequest,
  SkillDetail,
  SkillImportRequest,
  SkillReviewPreview,
  SkillSource,
  SkillSourcesSnapshot,
  SkillUpsertRequest,
} from '@shared/types/extensions';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:skills');

interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function wrapHandler<T>(name: string, fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    logger.error(`${name} failed`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : `Unknown error in ${name}`,
    };
  }
}

function getCatalog(services: HttpServices): SkillsCatalogService {
  if (!services.skillsCatalogService) {
    throw new Error('Skills catalog service is not initialized');
  }
  return services.skillsCatalogService;
}

function getMutations(services: HttpServices): SkillsMutationService {
  if (!services.skillsMutationService) {
    throw new Error('Skills mutation service is not initialized');
  }
  return services.skillsMutationService;
}

function getSources(services: HttpServices): SkillSourceService {
  if (!services.skillSourceService) {
    throw new Error('Skill source service is not initialized');
  }
  return services.skillSourceService;
}

function getWatcher(services: HttpServices): SkillsWatcherService {
  if (!services.skillsWatcherService) {
    throw new Error('Skills watcher service is not initialized');
  }
  return services.skillsWatcherService;
}

export function registerSkillsRoutes(app: FastifyInstance, services: HttpServices): void {
  app.get<{
    Querystring: { projectPath?: string };
  }>('/api/extensions/skills', async (request) => {
    return wrapHandler('skillsList', () => getCatalog(services).list(request.query.projectPath));
  });

  app.get<{
    Params: { skillId: string };
    Querystring: { projectPath?: string };
  }>('/api/extensions/skills/:skillId', async (request) => {
    return wrapHandler('skillsGetDetail', () => {
      const { skillId } = request.params;
      if (!skillId) throw new Error('skillId is required');
      return getCatalog(services).getDetail(skillId, request.query.projectPath);
    });
  });

  app.post<{
    Body: SkillUpsertRequest;
  }>('/api/extensions/skills/preview-upsert', async (request) => {
    return wrapHandler('skillsPreviewUpsert', () => {
      if (!request.body) throw new Error('request is required');
      return getMutations(services).previewUpsert(request.body);
    });
  });

  app.post<{
    Body: SkillUpsertRequest;
  }>('/api/extensions/skills/apply-upsert', async (request) => {
    return wrapHandler('skillsApplyUpsert', () => {
      if (!request.body) throw new Error('request is required');
      return getMutations(services).applyUpsert(request.body);
    });
  });

  app.post<{
    Body: SkillImportRequest;
  }>('/api/extensions/skills/preview-import', async (request) => {
    return wrapHandler('skillsPreviewImport', () => {
      if (!request.body) throw new Error('request is required');
      return getMutations(services).previewImport(request.body);
    });
  });

  app.post<{
    Body: SkillImportRequest;
  }>('/api/extensions/skills/apply-import', async (request) => {
    return wrapHandler('skillsApplyImport', () => {
      if (!request.body) throw new Error('request is required');
      return getMutations(services).applyImport(request.body);
    });
  });

  app.post<{
    Body: SkillDeleteRequest;
  }>('/api/extensions/skills/delete', async (request) => {
    return wrapHandler('skillsDelete', () => {
      if (!request.body) throw new Error('request is required');
      return getMutations(services).deleteSkill(request.body);
    });
  });

  app.get('/api/extensions/skills/sources', async () => {
    return wrapHandler('skillSourcesList', () => getSources(services).getSnapshot());
  });

  app.post<{
    Body: SkillSource[];
  }>('/api/extensions/skills/sources/save', async (request) => {
    return wrapHandler('skillSourcesSave', () => getSources(services).saveSources(request.body));
  });

  app.post('/api/extensions/skills/sources/refresh', async () => {
    return wrapHandler('skillSourcesRefresh', () => getSources(services).refreshSources());
  });

  app.post<{
    Querystring: { projectPath?: string };
  }>('/api/extensions/skills/watching/start', async (request) => {
    return wrapHandler('skillsStartWatching', () =>
      getWatcher(services).start(request.query.projectPath)
    );
  });

  app.post<{
    Body: { watchId: string };
  }>('/api/extensions/skills/watching/stop', async (request) => {
    return wrapHandler('skillsStopWatching', () => {
      const { watchId } = request.body;
      if (typeof watchId !== 'string' || !watchId) {
        throw new Error('watchId is required');
      }
      return getWatcher(services).stop(watchId);
    });
  });

  logger.info('Skills routes registered');
}
