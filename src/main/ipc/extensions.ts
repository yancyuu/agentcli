/**
 * IPC handlers for the Extension Store.
 *
 * Bridges renderer requests to the extension services (catalog, install,
 * state, skills, credentials) and returns results via IPC.
 */

import type { CcAgentType } from '@shared/types/ccConnect';
import type {
  McpInstallRequest,
  McpCustomInstallRequest,
  OperationResult,
  PluginInstallRequest,
} from '@shared/types/extensions';

import { PluginCatalogService } from '@main/services/extensions/catalog/PluginCatalogService';
import { McpCatalogAggregator } from '@main/services/extensions/catalog/McpCatalogAggregator';
import { OfficialMcpRegistryService } from '@main/services/extensions/catalog/OfficialMcpRegistryService';
import { GlamaMcpEnrichmentService } from '@main/services/extensions/catalog/GlamaMcpEnrichmentService';
import { ExtensionFacadeService } from '@main/services/extensions/ExtensionFacadeService';
import { PluginInstallationStateService } from '@main/services/extensions/state/PluginInstallationStateService';
import { McpInstallationStateService } from '@main/services/extensions/state/McpInstallationStateService';
import { SkillsCatalogService } from '@main/services/extensions/skills/SkillsCatalogService';
import { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';
import { CredentialService } from '@main/services/extensions/credentials/CredentialService';
import { getAdapter } from '@main/services/extensions/runtime/adapterRegistry';
import { createLogger } from '@shared/utils/logger';

const logger = createLogger('Extensions:IPC');

// ── Result wrapper ──

interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function wrapHandler<T>(handler: () => Promise<T>): Promise<IpcResult<T>> {
  return handler()
    .then((data) => ({ success: true as const, data }))
    .catch((err) => ({
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
}

// ── Service instances (singleton) ──

let facade: ExtensionFacadeService | null = null;
let skillsCatalog: SkillsCatalogService | null = null;
let skillsMutation: SkillsMutationService | null = null;
let credentials: CredentialService | null = null;

function getFacade(): ExtensionFacadeService {
  if (!facade) {
    const pluginCatalog = new PluginCatalogService();
    const pluginState = new PluginInstallationStateService();
    const mcpOfficial = new OfficialMcpRegistryService();
    const mcpGlama = new GlamaMcpEnrichmentService();
    const mcpAggregator = new McpCatalogAggregator(mcpOfficial, mcpGlama);
    const mcpState = new McpInstallationStateService();
    facade = new ExtensionFacadeService(pluginCatalog, pluginState, mcpAggregator, mcpState);
  }
  return facade;
}

function getSkillsCatalog(): SkillsCatalogService {
  if (!skillsCatalog) skillsCatalog = new SkillsCatalogService();
  return skillsCatalog;
}

function getSkillsMutation(): SkillsMutationService {
  if (!skillsMutation) skillsMutation = new SkillsMutationService();
  return skillsMutation;
}

function getCredentials(): CredentialService {
  if (!credentials) credentials = new CredentialService();
  return credentials;
}

// ── IPC Channel Names ──

const channels = {
  PLUGIN_GET_ALL: 'extensions:plugin:getAll',
  PLUGIN_GET_README: 'extensions:plugin:getReadme',
  PLUGIN_INSTALL: 'extensions:plugin:install',
  PLUGIN_UNINSTALL: 'extensions:plugin:uninstall',
  MCP_SEARCH: 'extensions:mcp:search',
  MCP_BROWSE: 'extensions:mcp:browse',
  MCP_GET_BY_ID: 'extensions:mcp:getById',
  MCP_GET_INSTALLED: 'extensions:mcp:getInstalled',
  MCP_INSTALL: 'extensions:mcp:install',
  MCP_INSTALL_CUSTOM: 'extensions:mcp:installCustom',
  MCP_UNINSTALL: 'extensions:mcp:uninstall',
  SKILLS_LIST: 'extensions:skills:list',
  SKILLS_GET_DETAIL: 'extensions:skills:getDetail',
  SKILLS_UPSERT: 'extensions:skills:upsert',
  SKILLS_DELETE: 'extensions:skills:delete',
  CREDENTIALS_GET_MCP: 'extensions:credentials:getMcp',
  CREDENTIALS_SAVE_MCP: 'extensions:credentials:saveMcp',
  CREDENTIALS_GET_PROJECT_ENV: 'extensions:credentials:getProjectEnv',
  CREDENTIALS_SAVE_PROJECT_ENV: 'extensions:credentials:saveProjectEnv',
  CREDENTIALS_SCAN_REQUIRED: 'extensions:credentials:scanRequired',
  CREDENTIALS_RESOLVE_AGENT_ENV: 'extensions:credentials:resolveAgentEnv',
  CREDENTIALS_STATUS: 'extensions:credentials:status',
} as const;

export { channels as extensionChannels };

// ── Handler Registration ──

// For Hermit's web-based architecture, handlers are exposed as an API object
// rather than Electron ipcMain.handle. The server.ts or API layer calls these.

export const extensionHandlers = {
  // ── Plugins ──

  pluginGetAll: () => wrapHandler(() => getFacade().getEnrichedPlugins()),

  pluginGetReadme: (pluginId: string) => wrapHandler(() => getFacade().getPluginReadme(pluginId)),

  pluginInstall: (request: PluginInstallRequest) =>
    wrapHandler(async () => {
      const harnessType = (request.harnessType ?? 'claudecode') as CcAgentType;
      const adapter = getAdapter(harnessType);
      if (!adapter) return { state: 'error' as const, error: `No adapter for ${harnessType}` };

      // Resolve qualifiedName from catalog
      const resolved = await getFacade().getPluginReadme(request.pluginId);
      // For now, use pluginId as qualifiedName (catalog resolution TBD)
      const result = await adapter.installPlugin(request.pluginId, {
        scope: request.scope ?? 'user',
        projectPath: request.projectPath,
      });

      if (result.state === 'success') {
        getFacade().invalidateInstalledCache();
      }
      return result;
    }),

  pluginUninstall: (
    pluginId: string,
    scope?: string,
    projectPath?: string,
    harnessType?: CcAgentType
  ) =>
    wrapHandler(async () => {
      const ht = (harnessType ?? 'claudecode') as CcAgentType;
      const adapter = getAdapter(ht);
      if (!adapter) return { state: 'error' as const, error: `No adapter for ${ht}` };

      const result = await adapter.uninstallPlugin(pluginId, {
        scope: (scope as InstallOpts['scope']) ?? 'user',
        projectPath,
      });

      if (result.state === 'success') {
        getFacade().invalidateInstalledCache();
      }
      return result;
    }),

  // ── MCP ──

  mcpSearch: (query: string, limit?: number) =>
    wrapHandler(() => getFacade().searchMcp(query, limit)),

  mcpBrowse: (cursor?: string, limit?: number) =>
    wrapHandler(() => getFacade().browseMcp(cursor, limit)),

  mcpGetById: (registryId: string) => wrapHandler(() => getFacade().getMcpById(registryId)),

  mcpGetInstalled: (projectPath?: string) =>
    wrapHandler(() => getFacade().getInstalledMcp(projectPath)),

  mcpInstall: (request: McpInstallRequest) =>
    wrapHandler(async () => {
      const harnessType = (request.harnessType ?? 'claudecode') as CcAgentType;
      const adapter = getAdapter(harnessType);
      if (!adapter || !adapter.supportsMcp) {
        return { state: 'error' as const, error: `MCP not supported by ${harnessType}` };
      }

      // Re-fetch server from registry (security: don't trust renderer)
      const server = await getFacade().getMcpById(request.registryId);
      if (!server?.installSpec) {
        return {
          state: 'error' as const,
          error: `Server "${request.registryId}" not found or no install spec`,
        };
      }

      const result = await adapter.installMcp(
        request.serverName,
        server.installSpec,
        request.envValues,
        request.headers,
        { scope: request.scope ?? 'user', projectPath: request.projectPath }
      );

      if (result.state === 'success') {
        getFacade().invalidateInstalledCache();
        // Save credentials for auto-fill next time
        await getCredentials().saveMcpCredentials(request.serverName, request.envValues);
      }
      return result;
    }),

  mcpInstallCustom: (request: McpCustomInstallRequest) =>
    wrapHandler(async () => {
      const harnessType = (request.harnessType ?? 'claudecode') as CcAgentType;
      const adapter = getAdapter(harnessType);
      if (!adapter || !adapter.supportsMcp) {
        return { state: 'error' as const, error: `MCP not supported by ${harnessType}` };
      }

      const result = await adapter.installMcp(
        request.serverName,
        request.installSpec,
        request.envValues,
        request.headers,
        { scope: request.scope ?? 'user', projectPath: request.projectPath }
      );

      if (result.state === 'success') {
        getFacade().invalidateInstalledCache();
      }
      return result;
    }),

  mcpUninstall: (name: string, scope?: string, projectPath?: string, harnessType?: CcAgentType) =>
    wrapHandler(async () => {
      const ht = (harnessType ?? 'claudecode') as CcAgentType;
      const adapter = getAdapter(ht);
      if (!adapter) return { state: 'error' as const, error: `No adapter for ${ht}` };

      const result = await adapter.uninstallMcp(name, {
        scope: (scope as InstallOpts['scope']) ?? 'user',
        projectPath,
      });

      if (result.state === 'success') {
        getFacade().invalidateInstalledCache();
      }
      return result;
    }),

  // ── Skills ──

  skillsList: (projectPath?: string) => wrapHandler(() => getSkillsCatalog().list(projectPath)),

  skillsGetDetail: (skillId: string, projectPath?: string) =>
    wrapHandler(() => getSkillsCatalog().getDetail(skillId, projectPath)),

  // ── Credentials ──

  credentialsGetMcp: (mcpName: string) =>
    wrapHandler(() => getCredentials().getMcpCredentials(mcpName)),

  credentialsSaveMcp: (mcpName: string, envValues: Record<string, string>) =>
    wrapHandler(() => getCredentials().saveMcpCredentials(mcpName, envValues)),

  credentialsGetProjectEnv: (projectPath: string) =>
    wrapHandler(() => getCredentials().getProjectEnv(projectPath)),

  credentialsSaveProjectEnv: (projectPath: string, vars: Record<string, string>) =>
    wrapHandler(() => getCredentials().saveProjectEnv(projectPath, vars)),

  credentialsScanRequired: (
    projectPath: string,
    mcpServers: {
      name: string;
      envVars?: { name: string; isRequired: boolean; description?: string }[];
    }[],
    skillReqs: { name: string; envVars: string[] }[]
  ) => wrapHandler(() => getCredentials().scanRequiredEnv(projectPath, mcpServers, skillReqs)),

  credentialsResolveAgentEnv: (projectPath: string) =>
    wrapHandler(() => getCredentials().resolveAgentEnv(projectPath)),

  credentialsStatus: () => wrapHandler(() => getCredentials().getStorageStatus()),
};

// Re-export for type usage
type InstallOpts = import('@main/services/extensions/runtime/HarnessInstallAdapter').InstallOpts;
