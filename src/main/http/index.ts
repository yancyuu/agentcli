/**
 * HTTP Route Registration Orchestrator.
 *
 * Registers all domain-specific route handlers on a Fastify instance.
 * Each route file mirrors the corresponding IPC handler.
 */

import {
  type RecentProjectsFeatureFacade,
  registerRecentProjectsHttp,
} from '@features/recent-projects/main';
import { createLogger } from '@shared/utils/logger';

import { registerConfigRoutes } from './config';
import { registerCliInstallerRoutes } from './cliInstaller';
import { registerContextRoutes } from './context';
import { registerCrossTeamRoutes } from './crossTeam';
import { registerEditorRoutes } from './editor';
import { registerEventRoutes } from './events';
import { registerExtensionRoutes } from './extensions';
import { registerNotificationRoutes } from './notifications';
import { registerProjectRoutes } from './projects';
import { registerReviewRoutes } from './review';
import { registerScheduleRoutes } from './schedule';
import { registerSearchRoutes } from './search';
import { registerSessionRoutes } from './sessions';
import { registerSkillsRoutes } from './skills';
import { registerSshRoutes } from './ssh';
import { registerSubagentRoutes } from './subagents';
import { registerTeamRoutes } from './teams';
import { registerUpdaterRoutes } from './updater';
import { registerUtilityRoutes } from './utility';
import { registerValidationRoutes } from './validation';

import type {
  ChunkBuilder,
  DataCache,
  ProjectScanner,
  SessionParser,
  SubagentResolver,
} from '../services';
import type { SshConnectionManager } from '../services/infrastructure/SshConnectionManager';
import type { TeamProvisioningService } from '../services/team/TeamProvisioningService';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:routes');

export interface HttpServices {
  projectScanner: ProjectScanner;
  sessionParser: SessionParser;
  subagentResolver: SubagentResolver;
  chunkBuilder: ChunkBuilder;
  dataCache: DataCache;
  recentProjectsFeature?: RecentProjectsFeatureFacade;
  updaterService: {
    checkForUpdates: () => Promise<void>;
    downloadUpdate: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    setMainWindow: (w: unknown) => void;
  };
  sshConnectionManager: SshConnectionManager;
  teamProvisioningService?: TeamProvisioningService;
  teamDataService?: import('@main/services/team/TeamDataService').TeamDataService;
  teamMemberLogsFinder?: import('@main/services').TeamMemberLogsFinder;
  boardTaskActivityService?: import('@main/services').BoardTaskActivityService;
  boardTaskActivityDetailService?: import('@main/services').BoardTaskActivityDetailService;
  boardTaskLogStreamService?: import('@main/services').BoardTaskLogStreamService;
  boardTaskExactLogsService?: import('@main/services').BoardTaskExactLogsService;
  boardTaskExactLogDetailService?: import('@main/services').BoardTaskExactLogDetailService;
  changeExtractorService?: import('@main/services/team/ChangeExtractorService').ChangeExtractorService;
  reviewApplierService?: import('@main/services/team/ReviewApplierService').ReviewApplierService;
  fileContentResolverService?: import('@main/services/team/FileContentResolver').FileContentResolver;
  extensionFacadeService?: import('../services/extensions/ExtensionFacadeService').ExtensionFacadeService;
  pluginInstallService?: import('../services/extensions/install/PluginInstallService').PluginInstallService;
  mcpInstallService?: import('../services/extensions/install/McpInstallService').McpInstallService;
  mcpHealthDiagnosticsService?: import('../services/extensions/state/McpHealthDiagnosticsService').McpHealthDiagnosticsService;
  skillsCatalogService?: import('../services/extensions/skills/SkillsCatalogService').SkillsCatalogService;
  skillsMutationService?: import('../services/extensions/skills/SkillsMutationService').SkillsMutationService;
  skillSourceService?: import('../services/extensions/skills/SkillSourceService').SkillSourceService;
  skillsWatcherService?: import('../services/extensions/skills/SkillsWatcherService').SkillsWatcherService;
  contextRegistry?: import('../services/infrastructure/ServiceContextRegistry').ServiceContextRegistry;
  schedulerService?: import('../services/schedule/SchedulerService').SchedulerService;
  crossTeamService?: import('../services/team/CrossTeamService').CrossTeamService;
}

export function registerHttpRoutes(
  app: FastifyInstance,
  services: HttpServices,
  sshModeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>
): void {
  registerProjectRoutes(app, services);
  registerSessionRoutes(app, services);
  registerSearchRoutes(app, services);
  registerSubagentRoutes(app, services);
  if (services.teamProvisioningService) {
    registerTeamRoutes(app, services);
  }
  registerEditorRoutes(app);
  if (services.changeExtractorService) {
    registerReviewRoutes(app, services);
  }
  registerNotificationRoutes(app);
  registerConfigRoutes(app);
  registerCliInstallerRoutes(app);
  registerValidationRoutes(app);
  registerUtilityRoutes(app);
  registerSshRoutes(app, services.sshConnectionManager, sshModeSwitchCallback);
  registerUpdaterRoutes(app, services);
  if (services.recentProjectsFeature) {
    registerRecentProjectsHttp(app, services.recentProjectsFeature);
  }
  registerEventRoutes(app);
  if (services.extensionFacadeService) {
    registerExtensionRoutes(app, services);
  }
  if (services.skillsCatalogService) {
    registerSkillsRoutes(app, services);
  }
  registerContextRoutes(app, services);
  if (services.schedulerService) {
    registerScheduleRoutes(app, services);
  }
  if (services.crossTeamService) {
    registerCrossTeamRoutes(app, services);
  }

  logger.info('All HTTP routes registered');
}
