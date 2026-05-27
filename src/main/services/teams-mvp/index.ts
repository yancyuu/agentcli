/**
 * Hermit team workspace + provisioning services (v2).
 *
 * 设计：一个 Team = 一个 cc-connect project，无 Member 子层级。
 * - TeamWorkspaceService: 本地目录管理（team.json / messages / tasks/board.json）
 * - TeamProvisioningService: 组合 cc-connect，含 Task Dispatcher
 * - CollaborationBoardService: 全局协作看板数据管理
 */

export {
  TeamWorkspaceService,
  toSlug,
  teamsRoot,
  teamRoot,
  groupSessionKey,
} from './TeamWorkspaceService';

export type {
  TeamManifest,
  CreateTeamInput,
  GroupMessage,
  AppendGroupMessageInput,
  Task,
  TaskStatus,
} from './TeamWorkspaceService';

export { TeamProvisioningService } from './TeamProvisioningService';

export { CollaborationBoardService } from './CollaborationBoardService';
