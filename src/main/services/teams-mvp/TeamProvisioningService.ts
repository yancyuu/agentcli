/**
 * TeamProvisioningService — 把 Hermit 团队操作翻译成 cc-connect 调用。
 *
 * MVP 设计:
 *   - 不动态创建 cc-connect project(cc-connect 1.3.2 强制每个 project 至少有
 *     一个非-bridge platform,且 Management API 没有通用 create endpoint)
 *   - 团队成员通过 bindProject 字段绑定到已存在的 cc-connect project
 *   - 群聊采用共享 sessionKey:hermit:<team-slug>:group
 *     全队成员发言进同一会话,agent 看到的是连续上下文
 *   - 消息持久化到 ~/.hermit/teams/<slug>/messages/group.jsonl
 */

import { createLogger } from '@shared/utils/logger';

import type { CcBridgeIncomingMessage } from '@shared/types/ccConnect';

import type { CcConnectBridge } from '../ccConnect/CcConnectBridge';
import type { CcConnectClient } from '../ccConnect/CcConnectClient';

import {
  groupSessionKey,
  TeamWorkspaceService,
  type CreateTeamInput,
  type GroupMessage,
  type TeamManifest,
} from './TeamWorkspaceService';

const logger = createLogger('TeamProvisioningService');

export interface GroupSendResult {
  userEntry: GroupMessage;
  replyEntry: GroupMessage;
  reply: { content?: string; format?: string; session_key?: string };
  ccProjectName: string;
  sessionKey: string;
  durationMs: number;
}

export class TeamProvisioningService {
  constructor(
    private readonly cc: CcConnectClient,
    private readonly bridge: CcConnectBridge,
    private readonly workspace: TeamWorkspaceService = new TeamWorkspaceService()
  ) {}

  // ===========================================================================
  // Team CRUD
  // ===========================================================================

  async createTeam(input: CreateTeamInput) {
    return this.workspace.createManagedTeam(input);
  }

  async listTeams(): Promise<TeamManifest[]> {
    return this.workspace.listTeams();
  }

  async readTeamManifest(teamSlug: string): Promise<TeamManifest> {
    return this.workspace.readTeamManifest(teamSlug);
  }

  async deleteTeam(teamSlug: string, opts: { deleteFiles?: boolean } = {}): Promise<void> {
    return this.workspace.deleteTeam(teamSlug, opts);
  }

  /**
   * 启动团队:校验 cc-connect 可达 + 校验所有绑定 project 存在。
   * 不实际操作 cc-connect(不创建/不修改 project),只确认绑定关系有效。
   */
  async launchTeam(teamSlug: string): Promise<{ manifest: TeamManifest; bound: number }> {
    const manifest = await this.workspace.readTeamManifest(teamSlug);
    await this.cc.getStatus();

    const list = await this.cc.listProjects();
    const ccProjects = new Set(list.map((p) => p.name));

    const errors: string[] = [];
    for (const m of manifest.members) {
      if (!m.bindProject) {
        errors.push(`成员 ${m.slug} 未绑定 cc-connect project`);
        continue;
      }
      if (!ccProjects.has(m.bindProject)) {
        errors.push(
          `成员 ${m.slug} 绑定的 project "${m.bindProject}" 在 cc-connect 中不存在(可用: ${[...ccProjects].join(', ') || '无'})`
        );
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));

    return { manifest, bound: manifest.members.length };
  }

  /**
   * 停止团队:MVP 只清空 hermit 自己持有的状态,不动 cc-connect。
   */
  async stopTeam(teamSlug: string): Promise<{ cleared: number }> {
    // 当前 mvp 不持有运行状态(每条消息都是独立的 send),
    // 仅作为 future-proof API 占位。
    void teamSlug;
    return { cleared: 0 };
  }

  // ===========================================================================
  // Group chat
  // ===========================================================================

  /**
   * 群聊模式发消息:
   *   - 整团队共享 sessionKey: `hermit:<team-slug>:group`
   *   - content 自动加上 `[from <author>] [to <target>]` 前缀,让 agent 看清群聊里
   *     谁在跟谁说话
   *   - 入参与回复都会 append 到团队根目录的 messages/group.jsonl
   */
  async groupSend(
    teamSlug: string,
    targetMemberSlug: string,
    text: string,
    opts: {
      author?: string;
      timeoutMs?: number;
      onEvent?: (evt: CcBridgeIncomingMessage) => void;
    } = {}
  ): Promise<GroupSendResult> {
    const author = opts.author ?? 'user';
    const manifest = await this.workspace.readTeamManifest(teamSlug);
    const target = manifest.members.find((m) => m.slug === targetMemberSlug);
    if (!target) throw new Error(`成员 "${targetMemberSlug}" 不存在`);
    if (!target.bindProject) {
      throw new Error(`成员 "${targetMemberSlug}" 未绑定 cc-connect project`);
    }

    const ccName = target.bindProject;
    const sessionKey = groupSessionKey(teamSlug);

    const userEntry = await this.workspace.appendGroupMessage(teamSlug, {
      from: author,
      to: targetMemberSlug,
      role: author === 'user' ? 'user' : 'agent',
      content: text,
    });

    const wrapped = `[from: ${author}] [to: ${targetMemberSlug}] ${text}`;

    const t0 = Date.now();
    let reply;
    try {
      reply = await this.bridge.sendAndWaitReply(
        {
          sessionKey,
          userId: 'group',
          userName: author,
          content: wrapped,
          project: ccName,
          chatId: teamSlug,
        },
        { timeoutMs: opts.timeoutMs, onEvent: opts.onEvent }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`groupSend failed (team=${teamSlug}, target=${targetMemberSlug}): ${message}`);
      await this.workspace.appendGroupMessage(teamSlug, {
        from: targetMemberSlug,
        to: 'group',
        role: 'system',
        content: `[ERROR] ${message}`,
        meta: { error: true },
      });
      throw err;
    }
    const durationMs = Date.now() - t0;

    const replyEntry = await this.workspace.appendGroupMessage(teamSlug, {
      from: targetMemberSlug,
      to: 'group',
      role: 'agent',
      content: reply.content || '(空回复)',
      meta: {
        durationMs,
        ccProjectName: ccName,
        sessionKey: reply.session_key || sessionKey,
        format: reply.format || 'text',
      },
    });

    return {
      userEntry,
      replyEntry,
      reply,
      ccProjectName: ccName,
      sessionKey,
      durationMs,
    };
  }

  async listGroupMessages(
    teamSlug: string,
    opts: { limit?: number } = {}
  ): Promise<GroupMessage[]> {
    return this.workspace.readGroupMessages(teamSlug, opts);
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
}
