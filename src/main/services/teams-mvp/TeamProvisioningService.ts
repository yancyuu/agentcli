/**
 * TeamProvisioningService — 团队生命周期管理，组合 cc-connect 调用。
 *
 * 设计（v2）:
 *   - 一个 Team = 一个 cc-connect project
 *   - createTeam(): 本地建目录 + cc-connect 创建 project + 注入 CLAUDE.md 指令
 *   - dispatchTask(): assignee 变化时通过 Bridge 推消息给目标团队的 agent
 */

import * as fs from 'fs';
import * as path from 'path';

import { createLogger } from '@shared/utils/logger';

import type { CcConnectBridge } from '../ccConnect/CcConnectBridge';
import type { CcConnectClient } from '../ccConnect/CcConnectClient';

import {
  TeamWorkspaceService,
  groupSessionKey,
  type CreateTeamInput,
  type Task,
  type TeamManifest,
} from './TeamWorkspaceService';

const logger = createLogger('TeamProvisioningService');
const TEAM_INSTRUCTIONS_BEGIN = '<!-- hermit:team-collaboration:start -->';
const TEAM_INSTRUCTIONS_END = '<!-- hermit:team-collaboration:end -->';

function removeSectionByHeading(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(
    new RegExp(`\\n{0,2}## ${escapedHeading}\\n[\\s\\S]*?(?=\\n## |\\s*$)`, 'g'),
    ''
  );
}

function removeManagedTeamInstructions(content: string): string {
  let next = content.replace(
    new RegExp(`\\n{0,2}${TEAM_INSTRUCTIONS_BEGIN}[\\s\\S]*?${TEAM_INSTRUCTIONS_END}\\n?`, 'g'),
    '\n'
  );
  next = removeSectionByHeading(next, 'Agent Collaboration (Hermit)');
  next = removeSectionByHeading(next, 'Cross-Team Task Dispatch (Hermit)');
  return next.replace(/\n{3,}/g, '\n\n').trimEnd();
}

async function injectHermitTasksMcpConfig(workDir: string): Promise<void> {
  const settingsPath = path.join(workDir, '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.promises.readFile(settingsPath, 'utf8');
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  const existingMcpServers =
    settings.mcpServers && typeof settings.mcpServers === 'object'
      ? (settings.mcpServers as Record<string, unknown>)
      : {};
  const port = process.env.PORT ?? '5680';
  settings.mcpServers = {
    ...existingMcpServers,
    'hermit-tasks': {
      type: 'sse',
      url: `http://127.0.0.1:${port}/mcp`,
    },
  };

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

export class TeamProvisioningService {
  private readonly workspace: TeamWorkspaceService;

  constructor(
    private readonly cc: CcConnectClient,
    private readonly bridge: CcConnectBridge,
    workspace?: TeamWorkspaceService
  ) {
    this.workspace = workspace ?? new TeamWorkspaceService();
  }

  // ===========================================================================
  // Team CRUD
  // ===========================================================================

  /**
   * 创建团队：
   * 1. 本地建目录 + team.json
   * 2. 在 cc-connect 创建 project（bridge platform）
   * 3. 注入 CLAUDE.md 跨团队派发指令
   * 4. 触发 cc-connect restart 激活 project
   */
  async createTeam(
    input: CreateTeamInput & { createCcProject?: boolean }
  ): Promise<{ slug: string; manifest: TeamManifest }> {
    const { createCcProject = true, ...workspaceInput } = input;

    const { slug, manifest } = await this.workspace.createTeam(workspaceInput);

    if (manifest.harness === 'claudecode') {
      await injectHermitTasksMcpConfig(manifest.workDir);
    }

    if (createCcProject) {
      try {
        const platformType = manifest.platform ?? 'bridge';
        const platformOpts = manifest.platformOptions ?? {};
        const result = await this.cc.createProject(
          manifest.bindProject,
          manifest.harness,
          manifest.workDir,
          platformType,
          platformOpts as Record<string, string>
        );
        if (result.restart_required) {
          await this.cc.restart();
          logger.info(`cc-connect restarted after creating project ${manifest.bindProject}`);
        }
      } catch (err) {
        logger.warn(
          `cc-connect project creation failed (team=${slug}): ${err instanceof Error ? err.message : String(err)}`
        );
        // 不中断流程 — project 可能已存在
      }
    }

    return { slug, manifest };
  }

  async listTeams(): Promise<TeamManifest[]> {
    return this.workspace.listTeams();
  }

  async readTeamManifest(teamSlug: string): Promise<TeamManifest> {
    return this.workspace.readTeamManifest(teamSlug);
  }

  async readTeamManifestByProject(projectName: string): Promise<TeamManifest> {
    return this.workspace.readTeamManifestByProject(projectName);
  }

  async updateTeam(
    teamSlug: string,
    patch: Partial<
      Pick<
        TeamManifest,
        | 'displayName'
        | 'color'
        | 'description'
        | 'collaboration'
        | 'harness'
        | 'workDir'
        | 'language'
        | 'permissionMode'
        | 'showContextIndicator'
        | 'replyFooter'
        | 'injectSender'
        | 'managedSources'
        | 'disabledCommands'
        | 'platform'
        | 'platformOptions'
        | 'platformAllowFrom'
        | 'platformAllowChat'
      >
    >
  ): Promise<TeamManifest> {
    return this.workspace.updateTeam(teamSlug, patch);
  }

  async deleteTeam(teamSlug: string, opts: { deleteFiles?: boolean } = {}): Promise<void> {
    return this.workspace.deleteTeam(teamSlug, opts);
  }

  // ===========================================================================
  // Task Dispatcher
  // ===========================================================================

  /**
   * 任务调度：当任务有 assignee 时，通过 Bridge 推送通知给目标团队的 agent。
   * 目标团队的 agent 收到消息后，用 MCP hermit-tasks 工具认领并处理任务。
   */
  async dispatchTask(sourceTeamSlug: string, task: Task): Promise<void> {
    if (!task.assignee) return;

    const targetSlug = task.assignee;

    // 检查来源团队协同开关（本地 manifest 可选）
    try {
      const sourceManifest = await this.workspace.readTeamManifest(sourceTeamSlug);
      if (sourceManifest.collaboration === false) {
        logger.info(`dispatchTask: source team "${sourceTeamSlug}" collaboration=false, skipping`);
        return;
      }
    } catch {
      // no local manifest — treat as collaboration=true
    }

    // 检查目标团队协同开关（目标团队必须存在）
    let targetManifest: TeamManifest;
    try {
      targetManifest = await this.workspace.readTeamManifest(targetSlug);
    } catch {
      logger.info(`dispatchTask: target team "${targetSlug}" not found, skipping`);
      return;
    }
    if (targetManifest.collaboration === false) {
      logger.info(`dispatchTask: target team "${targetSlug}" collaboration=false, skipping`);
      return;
    }

    // session key for bridge dispatch — cc-connect will apply share_session_in_channel natively
    const sessionKey = groupSessionKey(targetSlug);
    const message = [
      `[任务分配] 来自团队 ${sourceTeamSlug}`,
      `任务 ID: ${task.id}`,
      `标题: ${task.title}`,
      task.description ? `描述: ${task.description}` : null,
      ``,
      `请使用 hermit-tasks MCP 工具处理：`,
      `  claim_task("${targetSlug}", "${task.id}")  ← 认领任务`,
      `  complete_task("${targetSlug}", "${task.id}", result)  ← 完成任务`,
    ]
      .filter((l) => l !== null)
      .join('\n');

    try {
      this.bridge.sendUserMessage({
        sessionKey,
        userId: 'hermit',
        userName: `hermit[${sourceTeamSlug}]`,
        content: message,
        project: targetManifest.bindProject,
        chatId: targetSlug,
      });
      logger.info(
        `dispatched task ${task.id} → team:${targetSlug} (cc-project:${targetManifest.bindProject})`
      );
    } catch (err) {
      logger.warn(
        `dispatchTask failed (target=${targetSlug}): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 记录消息到来源团队
    await this.workspace.appendMessage(sourceTeamSlug, {
      from: 'hermit',
      to: targetSlug,
      role: 'system',
      content: `任务 ${task.id} 已分配给团队 ${targetSlug}`,
    });
  }

  // ===========================================================================
  // Tasks (passthrough to workspace)
  // ===========================================================================

  readTasks(teamSlug: string) {
    return this.workspace.readTasks(teamSlug);
  }

  createTask(teamSlug: string, payload: Parameters<TeamWorkspaceService['createTask']>[1]) {
    return this.workspace.createTask(teamSlug, payload);
  }

  patchTask(
    teamSlug: string,
    taskId: string,
    patch: Parameters<TeamWorkspaceService['patchTask']>[2]
  ) {
    return this.workspace.patchTask(teamSlug, taskId, patch);
  }

  deleteTask(teamSlug: string, taskId: string) {
    return this.workspace.deleteTask(teamSlug, taskId);
  }

  // ===========================================================================
  // Messages (passthrough to workspace)
  // ===========================================================================

  readMessages(teamSlug: string, opts?: { limit?: number }) {
    return this.workspace.readMessages(teamSlug, opts);
  }

  appendMessage(teamSlug: string, msg: Parameters<TeamWorkspaceService['appendMessage']>[1]) {
    return this.workspace.appendMessage(teamSlug, msg);
  }

  // ===========================================================================
  // CLAUDE.md instruction injection
  // ===========================================================================

  async injectTeamInstructions(workDir: string, teamSlug: string): Promise<void> {
    const mdPath = path.join(workDir, 'CLAUDE.md');
    const teams = await this.workspace.listTeams().catch(() => []);
    const availableTeams = teams
      .filter((team) => team.slug !== teamSlug)
      .map((team) => {
        const label =
          team.displayName && team.displayName !== team.slug
            ? `${team.slug} (${team.displayName})`
            : team.slug;
        return team.description ? `- ${label}: ${team.description}` : `- ${label}`;
      });
    const section = `

${TEAM_INSTRUCTIONS_BEGIN}

## Hermit Team Context

Current team slug: \`${teamSlug}\`

Available teams:
${availableTeams.length > 0 ? availableTeams.join('\n') : '- No other teams currently registered.'}

Cross-team work is routed by Hermit itself. If the user mentions another team with \`@team\`,
Hermit will create and track the cross-team collaboration task automatically.

Do not call cross-team dispatch APIs yourself and do not invent dispatch IDs.
You may use the team list only to understand which teams exist and when a user is referring to one.
${TEAM_INSTRUCTIONS_END}
`;

    try {
      let existing = '';
      try {
        existing = await fs.promises.readFile(mdPath, 'utf8');
      } catch {
        // File doesn't exist yet
      }

      const cleaned = removeManagedTeamInstructions(existing);
      await fs.promises.writeFile(mdPath, `${cleaned}${section}`, 'utf8');
      logger.info(`injected team instructions → ${mdPath}`);
    } catch (err) {
      logger.warn(
        `Team instructions injection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async removeTeamInstructions(workDir: string): Promise<void> {
    const mdPath = path.join(workDir, 'CLAUDE.md');
    try {
      const existing = await fs.promises.readFile(mdPath, 'utf8');
      const cleaned = removeManagedTeamInstructions(existing);
      if (cleaned === existing.trimEnd()) return;
      await fs.promises.writeFile(mdPath, cleaned ? `${cleaned}\n` : '', 'utf8');
      logger.info(`removed team instructions → ${mdPath}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      logger.warn(
        `Team instructions removal failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
