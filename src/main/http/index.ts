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
import { registerEditorRoutes } from './editor';
import { registerEventRoutes } from './events';
import { registerNotificationRoutes } from './notifications';
import { registerProjectRoutes } from './projects';
import { registerSearchRoutes } from './search';
import { registerSessionRoutes } from './sessions';
import { registerSshRoutes } from './ssh';
import { registerSubagentRoutes } from './subagents';
import { registerTeamRoutes } from './teams';
import { registerReviewRoutes } from './review';
import { registerUpdaterRoutes } from './updater';
import { registerUtilityRoutes } from './utility';
import { registerValidationRoutes } from './validation';

import type {
  ChunkBuilder,
  DataCache,
  ProjectScanner,
  SessionParser,
  SubagentResolver,
  UpdaterService,
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
  updaterService: UpdaterService;
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

  logger.info('All HTTP routes registered');
}
