/**
 * Hermit team workspace + provisioning services.
 *
 * - TeamWorkspaceService: 托管目录(team.json / mappings.json / messages/group.jsonl / tasks/board.json)
 * - TeamProvisioningService: 把团队操作翻译成 cc-connect 调用(group chat 共享 session_key)
 */

export {
  TeamWorkspaceService,
  toSlug,
  teamsRoot,
  teamRoot,
  memberWorkDir,
  groupSessionKey,
} from './TeamWorkspaceService';

export type {
  TeamMember,
  TeamMemberInput,
  TeamManifest,
  TeamMode,
  CreateTeamInput,
  GroupMessage,
  AppendGroupMessageInput,
  Task,
  TaskStatus,
} from './TeamWorkspaceService';

export { TeamProvisioningService } from './TeamProvisioningService';
export type { GroupSendResult } from './TeamProvisioningService';
