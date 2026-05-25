/**
 * TeamProvisioningService — 团队生命周期管理，组合 cc-connect 调用。
 *
 * 设计（v2）:
 *   - 一个 Team = 一个 cc-connect project
 *   - createTeam(): 本地建目录 + cc-connect 创建 project + 注入 MCP 配置
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

/** MCP server 地址，注入到 claudecode/qoder 配置 */
const MCP_SERVER_URL = process.env.HERMIT_MCP_URL ?? 'http://127.0.0.1:5680/mcp';

/** 支持自动注入 MCP 配置的 harness 类型 */
const MCP_AUTO_INJECT_HARNESS = new Set(['claudecode', 'qoder']);

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
   * 3. 如果 harness 支持，注入 MCP 配置到 workDir
   * 4. 触发 cc-connect restart 激活 project
   */
  async createTeam(
    input: CreateTeamInput & { createCcProject?: boolean }
  ): Promise<{ slug: string; manifest: TeamManifest }> {
    const { createCcProject = true, ...workspaceInput } = input;

    const { slug, manifest } = await this.workspace.createTeam(workspaceInput);

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

    if (MCP_AUTO_INJECT_HARNESS.has(manifest.harness)) {
      await this.injectMcpConfig(manifest.workDir, slug, manifest.harness);
    }

    await this.injectTeamInstructions(manifest.workDir, slug);

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
        | 'platformAllowFrom'
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
  // MCP config injection
  // ===========================================================================

  /**
   * 根据 harness 类型将 hermit-tasks MCP 配置注入到对应目录。
   */
  private async injectMcpConfig(
    workDir: string,
    teamSlug: string,
    harness?: string
  ): Promise<void> {
    const configPaths = this.getMcpConfigPaths(workDir, harness);
    for (const settingsPath of configPaths) {
      try {
        await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
        let existing: Record<string, unknown> = {};
        try {
          const raw = await fs.promises.readFile(settingsPath, 'utf8');
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // file doesn't exist yet
        }
        const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
        mcpServers['hermit-tasks'] = {
          url: MCP_SERVER_URL,
          env: { HERMIT_TEAM_SLUG: teamSlug },
        };
        const updated = { ...existing, mcpServers };
        await fs.promises.writeFile(settingsPath, JSON.stringify(updated, null, 2), 'utf8');
        logger.info(`injected MCP config → ${settingsPath}`);
      } catch (err) {
        logger.warn(
          `MCP config injection failed (${settingsPath}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private getMcpConfigPaths(workDir: string, harness?: string): string[] {
    const h = (harness ?? '').toLowerCase();
    if (h === 'cursor') return [path.join(workDir, '.cursor', 'mcp.json')];
    if (h === 'codex' || h === 'openai-codex')
      return [path.join(workDir, '.codex', 'settings.json')];
    if (h === 'gemini' || h === 'gemini-cli')
      return [path.join(workDir, '.gemini', 'settings.json')];
    return [path.join(workDir, '.claude', 'settings.json')];
  }

  private async injectTeamInstructions(workDir: string, teamSlug: string): Promise<void> {
    const mdPath = path.join(workDir, 'CLAUDE.md');
    const section = `

## Cross-Team Task Dispatch (Hermit)

You can dispatch tasks to other teams via the Hermit local API:

- **List available teams**: \`curl -s http://127.0.0.1:5680/api/cross-team/targets\`
- **Dispatch a task**: \`curl -s -X POST http://127.0.0.1:5680/api/cross-team/send -H 'Content-Type: application/json' -d '{"fromTeam":"${teamSlug}","toTeam":"TARGET_TEAM","subject":"Task title","description":"Optional description"}'\`

Current team slug: \`${teamSlug}\`

When to dispatch:
- Task requires access to a different codebase/project
- Task explicitly mentions another team's domain
- Task is blocked by work owned by another team

Do NOT dispatch:
- Task is within current team's project scope
- Task can be completed with available tools
`;

    try {
      let existing = '';
      try {
        existing = await fs.promises.readFile(mdPath, 'utf8');
      } catch {
        // File doesn't exist yet
      }

      if (existing.includes('Cross-Team Task Dispatch (Hermit)')) {
        return;
      }

      await fs.promises.writeFile(mdPath, existing + section, 'utf8');
      logger.info(`injected team instructions → ${mdPath}`);
    } catch (err) {
      logger.warn(
        `Team instructions injection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
