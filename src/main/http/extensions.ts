/**
 * HTTP route handlers for Extension Store (plugin catalog + MCP registry).
 *
 * Mirrors src/main/ipc/extensions.ts for standalone/web mode.
 */

import { createLogger } from '@shared/utils/logger';

import type { ExtensionFacadeService } from '../services/extensions/ExtensionFacadeService';
import type { HttpServices } from './index';

import type {
  McpCustomInstallRequest,
  McpInstallRequest,
  PluginInstallRequest,
} from '@shared/types/extensions';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:extensions');

const VALID_SCOPES = new Set(['local', 'user', 'project']);

interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function wrapHandler<T>(operation: string, handler: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await handler();
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[extensions:${operation}] ${message}`);
    return { success: false, error: message };
  }
}

function getFacade(services: HttpServices): ExtensionFacadeService {
  if (!services.extensionFacadeService) {
    throw new Error('Extension facade not initialized');
  }
  return services.extensionFacadeService;
}

export function registerExtensionRoutes(app: FastifyInstance, services: HttpServices): void {
  // ── Plugin routes ───────────────────────────────────────────────────────

  app.get<{
    Querystring: { projectPath?: string; forceRefresh?: string };
  }>('/api/extensions/plugins', async (request) => {
    return wrapHandler('getAll', () =>
      getFacade(services).getEnrichedPlugins(
        request.query.projectPath,
        request.query.forceRefresh === 'true'
      )
    );
  });

  app.get<{
    Params: { pluginId: string };
  }>('/api/extensions/plugins/:pluginId/readme', async (request) => {
    return wrapHandler('getReadme', () => {
      const { pluginId } = request.params;
      if (!pluginId) throw new Error('pluginId is required');
      return getFacade(services).getPluginReadme(pluginId);
    });
  });

  app.post<{
    Body: PluginInstallRequest;
  }>('/api/extensions/plugins/install', async (request) => {
    return wrapHandler('pluginInstall', async () => {
      const req = request.body;
      if (!req || typeof req.pluginId !== 'string' || !req.pluginId) {
        throw new Error('Invalid install request: pluginId is required');
      }
      if (req.scope && !VALID_SCOPES.has(req.scope)) {
        throw new Error(`Invalid scope: "${req.scope}"`);
      }
      if (!services.pluginInstallService) throw new Error('Plugin installer not initialized');
      const result = await services.pluginInstallService.install(req);
      if (result.state === 'success') {
        getFacade(services).invalidateInstalledCache();
      }
      return result;
    });
  });

  app.post<{
    Body: { pluginId: string; scope?: string; projectPath?: string };
  }>('/api/extensions/plugins/uninstall', async (request) => {
    return wrapHandler('pluginUninstall', async () => {
      const { pluginId, scope, projectPath } = request.body;
      if (typeof pluginId !== 'string' || !pluginId) {
        throw new Error('pluginId is required');
      }
      if (scope && !VALID_SCOPES.has(scope)) {
        throw new Error(`Invalid scope: "${scope}"`);
      }
      if (!services.pluginInstallService) throw new Error('Plugin installer not initialized');
      const result = await services.pluginInstallService.uninstall(pluginId, scope, projectPath);
      if (result.state === 'success') {
        getFacade(services).invalidateInstalledCache();
      }
      return result;
    });
  });

  // ── MCP Registry routes ─────────────────────────────────────────────────

  app.get<{
    Querystring: { q?: string; limit?: string };
  }>('/api/extensions/mcp/search', async (request) => {
    return wrapHandler('mcpSearch', () =>
      getFacade(services).searchMcp(
        request.query.q ?? '',
        request.query.limit ? parseInt(request.query.limit, 10) : undefined
      )
    );
  });

  app.get<{
    Querystring: { cursor?: string; limit?: string };
  }>('/api/extensions/mcp/browse', async (request) => {
    return wrapHandler('mcpBrowse', () =>
      getFacade(services).browseMcp(
        request.query.cursor,
        request.query.limit ? parseInt(request.query.limit, 10) : undefined
      )
    );
  });

  app.get<{
    Querystring: { projectPath?: string };
  }>('/api/extensions/mcp/installed', async (request) => {
    return wrapHandler('mcpGetInstalled', () =>
      getFacade(services).getInstalledMcp(request.query.projectPath)
    );
  });

  app.get<{
    Querystring: { projectPath?: string };
  }>('/api/extensions/mcp/diagnose', async (request) => {
    return wrapHandler('mcpDiagnose', () => {
      if (!services.mcpHealthDiagnosticsService) {
        throw new Error('MCP health diagnostics not initialized');
      }
      return services.mcpHealthDiagnosticsService.diagnose(request.query.projectPath);
    });
  });

  app.get<{
    Params: { registryId: string };
  }>('/api/extensions/mcp/:registryId', async (request) => {
    return wrapHandler('mcpGetById', () => {
      const { registryId } = request.params;
      if (!registryId) throw new Error('registryId is required');
      return getFacade(services).getMcpById(registryId);
    });
  });

  app.post<{
    Body: McpInstallRequest;
  }>('/api/extensions/mcp/install', async (request) => {
    return wrapHandler('mcpInstall', async () => {
      const req = request.body;
      if (!req || typeof req.registryId !== 'string' || !req.registryId) {
        throw new Error('Invalid install request: registryId is required');
      }
      if (typeof req.serverName !== 'string' || !req.serverName) {
        throw new Error('Invalid install request: serverName is required');
      }
      if (req.scope && !VALID_SCOPES.has(req.scope)) {
        throw new Error(`Invalid scope: "${req.scope}"`);
      }
      if (!services.mcpInstallService) throw new Error('MCP installer not initialized');
      const result = await services.mcpInstallService.install(req);
      if (result.state === 'success') {
        getFacade(services).invalidateInstalledCache();
      }
      return result;
    });
  });

  app.post<{
    Body: McpCustomInstallRequest;
  }>('/api/extensions/mcp/install-custom', async (request) => {
    return wrapHandler('mcpInstallCustom', async () => {
      const req = request.body;
      if (!req || typeof req.serverName !== 'string' || !req.serverName) {
        throw new Error('Invalid custom install request: serverName is required');
      }
      if (!req.installSpec) {
        throw new Error('Invalid custom install request: installSpec is required');
      }
      if (req.scope && !VALID_SCOPES.has(req.scope)) {
        throw new Error(`Invalid scope: "${req.scope}"`);
      }
      if (!services.mcpInstallService) throw new Error('MCP installer not initialized');
      const result = await services.mcpInstallService.installCustom(req);
      if (result.state === 'success') {
        getFacade(services).invalidateInstalledCache();
      }
      return result;
    });
  });

  app.post<{
    Body: { name: string; scope?: string; projectPath?: string };
  }>('/api/extensions/mcp/uninstall', async (request) => {
    return wrapHandler('mcpUninstall', async () => {
      const { name, scope, projectPath } = request.body;
      if (typeof name !== 'string' || !name) {
        throw new Error('Server name is required');
      }
      if (scope && !VALID_SCOPES.has(scope)) {
        throw new Error(`Invalid scope: "${scope}"`);
      }
      if (!services.mcpInstallService) throw new Error('MCP installer not initialized');
      const result = await services.mcpInstallService.uninstall(name, scope, projectPath);
      if (result.state === 'success') {
        getFacade(services).invalidateInstalledCache();
      }
      return result;
    });
  });

  app.post<{
    Body: { repositoryUrls: string[] };
  }>('/api/extensions/mcp/github-stars', async (request) => {
    return wrapHandler('githubStars', async () => {
      const { GitHubStarsService } =
        await import('../services/extensions/catalog/GitHubStarsService');
      const starsService = new GitHubStarsService();
      return starsService.fetchStars(request.body.repositoryUrls);
    });
  });

  logger.info('Extension routes registered');
}
