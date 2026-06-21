import type {
  AgentCapability,
  CollabTask,
  DiscoverableTeam,
  DispatchMeta,
  TaskBusConfig,
  TaskDispatchPayload,
  TaskHandshakeResponse,
  TaskStatusUpdate,
} from '@shared/types/team';
import type { TeamWorkspaceService, TeamManifest, Task } from './TeamWorkspaceService';
import type { CollaborationBoardService } from './CollaborationBoardService';
import type Redis from 'ioredis';

import { normalizeRedisHost } from '@main/utils/redisConfig';

const DISPATCH_RULES_DEFAULT = `When to dispatch a task to another team:
- Task requires access to a different codebase/project
- Task explicitly mentions another team's domain or ownership
- Task is blocked by work owned by another team
- Task requires expertise the current team doesn't have

Do NOT dispatch:
- Task is within current team's project scope
- Task can be completed with available tools
- Task is a small change (< estimated 5 min)`;

interface PendingRequest {
  payload: TaskDispatchPayload;
  msgId: string;
  groupName: string;
  teamSlug: string;
  localTaskId?: string;
}

export interface DispatchResult {
  dispatchId: string;
  status: DispatchMeta['status'];
  targetTeam: string;
  message: string;
}

export class TaskDispatchService {
  private workspace: TeamWorkspaceService;
  private collabBoard: CollaborationBoardService;
  private config: TaskBusConfig | null = null;
  private redis: Redis | null = null;
  private redisSub: Redis | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consumerTimers: ReturnType<typeof setInterval>[] = [];
  private responseConsumerTimers: ReturnType<typeof setInterval>[] = [];
  private consumerTeamSlugs = new Set<string>();
  private responseConsumerTeamSlugs = new Set<string>();
  private disposed = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private startingTasks = new Set<string>();
  /** Callback fired when collab task state changes (for SSE broadcast). */
  onCollabChange?: (dispatchId: string, status: string, fromTeam: string, toTeam: string) => void;
  /** Runtime delivery hook. Cross-team tasks must only use this after a human clicks Start. */
  onRuntimeStart?: (params: { teamName: string; text: string }) => Promise<void>;

  constructor(workspace: TeamWorkspaceService, collabBoard: CollaborationBoardService) {
    this.workspace = workspace;
    this.collabBoard = collabBoard;
  }

  get dispatchRulesText(): string {
    return DISPATCH_RULES_DEFAULT;
  }

  async start(config?: TaskBusConfig): Promise<void> {
    this.disposed = false;
    this.config = config ?? null;
    if (config?.enabled && config.redis) {
      await this.connectRedis();
      if (!this.redis) {
        throw new Error('Redis connection failed: PING did not succeed');
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    this.stopConsumers();
    this.stopResponseConsumers();
    this.collabBoard.setRedis(null);
    this.redis?.disconnect();
    this.redisSub?.disconnect();
    this.redis = null;
    this.redisSub = null;
  }

  /**
   * Whether the team-bus Redis connection is currently live. Drives the
   * "已连接 / 未连接" status surfaced in the settings UI (via the telemetry
   * status endpoint), so it must reflect the real connection rather than a
   * hardcoded flag — otherwise a healthy bus always reads as disconnected.
   */
  isRedisConnected(): boolean {
    return !this.disposed && this.redis !== null;
  }

  // ── Agent-facing ──────────────────────────────────────────────

  async listTeams(): Promise<DiscoverableTeam[]> {
    return this.discoverTeams();
  }

  async discoverTeams(): Promise<DiscoverableTeam[]> {
    const teams: DiscoverableTeam[] = [];

    const localTeams = await this.workspace.listTeams();
    for (const team of localTeams) {
      teams.push({
        slug: team.slug,
        displayName: team.displayName ?? team.slug,
        location: 'local',
        status: 'online',
        collaboration: team.collaboration !== false,
        description: team.description,
        harness: team.harness,
        capabilities: this.inferCapabilities(team),
        workDir: team.workDir,
      });
    }

    if (this.redis) {
      try {
        const now = Date.now();
        const staleThreshold = 90_000;
        const entries = await this.redis.zrange('task:teams', 0, -1, 'WITHSCORES');
        const localSlugs = new Set(teams.map((t) => t.slug));
        for (let i = 0; i < entries.length; i += 2) {
          const slug = entries[i] as string;
          const ts = Number(entries[i + 1]);
          if (localSlugs.has(slug)) continue;
          const isOnline = now - ts < staleThreshold;

          let info: Record<string, string> | null = null;
          try {
            info = (await this.redis!.hgetall(`task:team:info:${slug}`)) as Record<string, string>;
          } catch {
            /* degraded */
          }

          const capabilities = info?.capabilities
            ? (JSON.parse(info.capabilities) as AgentCapability[])
            : undefined;

          teams.push({
            slug,
            displayName: info?.displayName ?? slug,
            location: 'remote',
            status: isOnline ? 'online' : 'offline',
            collaboration: info?.collaboration !== 'false',
            description: info?.description || undefined,
            harness: info?.harness || undefined,
            capabilities,
            workDir: info?.workDir || undefined,
          });
        }
      } catch {
        // Redis read failure — return local teams only
      }
    }

    return teams;
  }

  async dispatchTask(
    fromTeam: string,
    task: { subject: string; description?: string; prompt?: string },
    targetTeam: string,
    opts?: { deadlineMinutes?: number; needsHumanReview?: boolean; dispatchId?: string }
  ): Promise<DispatchResult> {
    if (fromTeam === targetTeam) {
      return {
        dispatchId: '',
        status: 'failed',
        targetTeam,
        message: 'Cannot dispatch to self — use native task tools instead.',
      };
    }

    const dispatchId = opts?.dispatchId ?? crypto.randomUUID();
    const now = new Date();
    const dispatchedAt = now.toISOString();
    const deadline = opts?.deadlineMinutes
      ? new Date(now.getTime() + opts.deadlineMinutes * 60_000).toISOString()
      : undefined;

    const dispatchMeta: DispatchMeta = {
      dispatchId,
      originTeam: fromTeam,
      targetTeam,
      status: 'received',
      dispatchedAt,
      receivedAt: dispatchedAt,
      deadline,
    };
    const payload: TaskDispatchPayload = {
      dispatchId,
      originTeam: fromTeam,
      targetTeam,
      task: { subject: task.subject, description: task.description, prompt: task.prompt },
      dispatchedAt,
      deadline,
      needsHumanReview: opts?.needsHumanReview,
    };

    // Add to collaboration board before external delivery. Dispatch creation only
    // means "visible in the target team's TODO"; runtime execution waits for Start.
    const fromTeamManifest = await this.safeReadManifest(fromTeam);
    const toTeamManifest = await this.safeReadManifest(targetTeam);
    const collabTask: CollabTask = {
      id: dispatchId,
      dispatchId,
      subject: task.subject,
      description: task.description,
      fromTeam,
      fromTeamDisplay: fromTeamManifest?.displayName ?? fromTeam,
      toTeam: targetTeam,
      toTeamDisplay: toTeamManifest?.displayName ?? targetTeam,
      status: 'received',
      deadline,
      needsHumanReview: opts?.needsHumanReview ?? false,
      revisionCount: 0,
      createdAt: dispatchedAt,
      updatedAt: dispatchedAt,
    };
    this.collabBoard.addTask(collabTask);

    const isLocalTarget = await this.isLocalTeam(targetTeam);
    if (isLocalTarget) {
      const localTask = await this.createOrReuseReceivedTask(targetTeam, payload, dispatchMeta);
      this.pendingRequests.set(dispatchId, {
        payload,
        msgId: `local-${Date.now()}`,
        groupName: 'local-dispatch',
        teamSlug: targetTeam,
        localTaskId: localTask.id,
      });
      this.emitCollabChange(dispatchId, 'received', fromTeam, targetTeam);
      this.sendFeishuNotification(
        `跨团队任务进入待启动：${fromTeam} → ${targetTeam}\n${task.subject}`
      );
      return {
        dispatchId,
        status: 'received',
        targetTeam,
        message: `Task queued in ${targetTeam} TODO, waiting for manual start.`,
      };
    }

    // Remote teams still require Redis to create the target-side TODO projection.
    if (!this.redis) {
      const failedTask = this.collabBoard.transition({
        dispatchId,
        expected: ['received', 'pending_accept'],
        next: 'failed',
        actor: { type: 'system', id: 'task-dispatch' },
        eventType: 'task_failed',
        payload: { reason: 'Redis not configured' },
        extra: { reason: 'Redis not configured — remote cross-team dispatch requires task bus.' },
      });
      this.emitCollabChange(dispatchId, failedTask.status, fromTeam, targetTeam);
      return {
        dispatchId,
        status: 'failed',
        targetTeam,
        message: 'Redis not configured — remote cross-team dispatch requires task bus.',
      };
    }

    try {
      await this.handleRedisDispatch(dispatchMeta, task, opts?.needsHumanReview);
    } catch (err) {
      this.pendingRequests.delete(dispatchId);
      const reason = err instanceof Error ? err.message : 'Unknown Redis dispatch failure';
      const failedTask = this.collabBoard.transition({
        dispatchId,
        expected: ['received', 'pending_accept'],
        next: 'failed',
        actor: { type: 'system', id: 'task-dispatch' },
        eventType: 'task_failed',
        payload: { reason },
        extra: { reason },
      });
      this.emitCollabChange(dispatchId, failedTask.status, fromTeam, targetTeam);
      return {
        dispatchId,
        status: 'failed',
        targetTeam,
        message: `Task dispatch failed: ${reason}`,
      };
    }

    this.emitCollabChange(dispatchId, 'received', fromTeam, targetTeam);

    return {
      dispatchId,
      status: 'received',
      targetTeam,
      message: `Task queued in ${targetTeam} TODO, waiting for manual start.`,
    };
  }

  private async createOrReuseReceivedTask(
    teamSlug: string,
    payload: TaskDispatchPayload,
    dispatchMeta: DispatchMeta
  ): Promise<Task> {
    const existingTasks = await this.workspace.readTasks(teamSlug).catch(() => []);
    const existingTask = existingTasks.find(
      (task) => task.dispatchMeta?.dispatchId === payload.dispatchId
    );
    if (existingTask) return existingTask;

    return this.workspace.createTask(teamSlug, {
      title: payload.task.subject,
      description: payload.task.description ?? payload.task.prompt ?? '',
      status: 'todo',
      dispatchMeta,
    });
  }

  async startDispatchedTask(
    teamSlug: string,
    taskId: string
  ): Promise<{ taskId: string; dispatchId: string }> {
    const lockKey = `${teamSlug}:${taskId}`;
    if (this.startingTasks.has(lockKey)) {
      throw new Error('cross-team task is already starting');
    }
    this.startingTasks.add(lockKey);
    try {
      return await this.startDispatchedTaskLocked(teamSlug, taskId);
    } finally {
      this.startingTasks.delete(lockKey);
    }
  }

  private async startDispatchedTaskLocked(
    teamSlug: string,
    taskId: string
  ): Promise<{ taskId: string; dispatchId: string }> {
    const tasks = await this.workspace.readTasks(teamSlug);
    const task = tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    if (!task.dispatchMeta) throw new Error(`task is not a cross-team dispatch: ${taskId}`);
    if (task.dispatchMeta.targetTeam !== teamSlug) {
      throw new Error(
        `cross-team task belongs to ${task.dispatchMeta.targetTeam}, not ${teamSlug}`
      );
    }
    if (task.status !== 'todo') {
      throw new Error('cross-team task has already been started or completed');
    }
    if (!['received', 'pending_accept', 'accepted'].includes(task.dispatchMeta.status)) {
      throw new Error(`cross-team task cannot be started from status ${task.dispatchMeta.status}`);
    }

    const startedAt = new Date().toISOString();
    const meta: DispatchMeta = {
      ...task.dispatchMeta,
      status: 'in_progress',
      acceptedAt: task.dispatchMeta.acceptedAt ?? startedAt,
      remoteTaskId: task.id,
    };

    await this.workspace.patchTask(teamSlug, taskId, {
      status: 'doing',
      dispatchMeta: meta,
    } as any);

    const description = task.description?.trim();
    const runtimeText = `[跨团队任务启动] 来自 ${meta.originTeam} 的任务已由用户点击启动，请开始执行。\n\n任务：${task.title}${description ? `\n\n描述：${description}` : ''}\n\n完成后请调用 complete_task 标记完成。`;
    try {
      await this.onRuntimeStart?.({ teamName: teamSlug, text: runtimeText });
    } catch (err) {
      await this.workspace
        .patchTask(teamSlug, taskId, {
          status: 'todo',
          dispatchMeta: task.dispatchMeta,
        } as any)
        .catch(() => {});
      throw err;
    }

    const collabTask = this.collabBoard.getTask(meta.dispatchId);
    if (collabTask && ['received', 'pending_accept', 'accepted'].includes(collabTask.status)) {
      const next = this.collabBoard.transition({
        dispatchId: meta.dispatchId,
        expected: ['received', 'pending_accept', 'accepted'],
        next: 'in_progress',
        actor: { type: 'team', id: teamSlug },
        eventType: 'task_accepted',
        payload: { remoteTaskId: task.id, startedAt },
        extra: { acceptedAt: startedAt, remoteTaskId: task.id },
      });
      this.emitCollabChange(meta.dispatchId, next.status, next.fromTeam, next.toTeam);
    }

    const pending = this.pendingRequests.get(meta.dispatchId);
    if (pending?.teamSlug === teamSlug) {
      if (this.redis && !pending.msgId.startsWith('local-')) {
        await this.redis
          .xack(`task:dispatch:${teamSlug}`, pending.groupName, pending.msgId)
          .catch(() => {});
      }
      this.pendingRequests.delete(meta.dispatchId);
    }

    const update: TaskStatusUpdate = {
      dispatchId: meta.dispatchId,
      originTeam: meta.originTeam,
      status: 'in_progress',
      remoteTaskId: task.id,
      timestamp: startedAt,
    };
    if (this.redis) {
      await this.redis
        .publish(`task:status:${meta.originTeam}`, JSON.stringify(update))
        .catch(() => {});
    }

    await this.workspace
      .appendMessage(meta.originTeam, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务已启动] "${task.title}" — ${teamSlug} 已从 TODO 点击启动并开始执行。`,
        meta: {
          source: 'cross_team_started',
          dispatchId: meta.dispatchId,
          targetTeam: teamSlug,
          taskId,
        },
      })
      .catch(() => {});

    return { taskId, dispatchId: meta.dispatchId };
  }

  async acceptTask(teamSlug: string, dispatchId: string): Promise<{ taskId: string }> {
    const pending = this.pendingRequests.get(dispatchId);
    if (!pending) {
      throw new Error(`No pending request found for dispatchId: ${dispatchId}`);
    }

    const { payload, localTaskId } = pending;

    const remoteTaskId = localTaskId ?? payload.dispatchId;

    // Legacy accept_task only acknowledges receipt. It must not advance execution;
    // runtime delivery is gated by the target team's TODO Start button.
    const tasks = await this.workspace.readTasks(teamSlug).catch(() => []);
    const localTask = tasks.find(
      (task) => task.id === remoteTaskId || task.dispatchMeta?.dispatchId === payload.dispatchId
    );
    if (localTask?.dispatchMeta) {
      await this.workspace
        .patchTask(teamSlug, localTask.id, {
          dispatchMeta: {
            ...localTask.dispatchMeta,
            status: 'received',
            remoteTaskId: localTask.id,
          },
        } as any)
        .catch(() => {});
    }
    this.emitCollabChange(payload.dispatchId, 'received', payload.originTeam, payload.targetTeam);

    // Do not append anything to the target inbox on receipt/accept. The target
    // team's TODO card is the only pre-start surface; inbox/runtime delivery is
    // gated by explicit Start.

    this.sendFeishuNotification(
      `跨团队任务待启动：${payload.originTeam} → ${teamSlug}\n${payload.task.subject}\n状态：等待目标团队点击启动`
    );

    return { taskId: localTask?.id ?? remoteTaskId };
  }

  async rejectTask(teamSlug: string, dispatchId: string, reason?: string): Promise<void> {
    const pending = this.pendingRequests.get(dispatchId);
    if (!pending) {
      throw new Error(`No pending request found for dispatchId: ${dispatchId}`);
    }

    const { payload, msgId, groupName } = pending;

    const response: TaskHandshakeResponse = {
      dispatchId: payload.dispatchId,
      type: 'task_reject',
      fromTeam: teamSlug,
      toTeam: payload.originTeam,
      reason,
      rejectedAt: new Date().toISOString(),
    };

    const isLocalOrigin = await this.isLocalTeam(payload.originTeam);
    if (isLocalOrigin) {
      await this.handleLocalResponse(response);
    } else if (this.redis) {
      await this.redis
        .xadd(`task:response:${payload.originTeam}`, '*', 'payload', JSON.stringify(response))
        .catch((err: Error) => {
          console.error('[TaskDispatchService] reject xadd failed:', err.message);
        });
    }

    if (this.redis) {
      await this.redis.xack(`task:dispatch:${teamSlug}`, groupName, msgId).catch(() => {});
    }

    this.pendingRequests.delete(dispatchId);

    // Update collab board
    this.collabBoard.transition({
      dispatchId: payload.dispatchId,
      expected: ['received', 'pending_accept'],
      next: 'rejected',
      actor: { type: 'team', id: teamSlug },
      eventType: 'task_rejected',
      payload: { reason },
      extra: { reason, rejectedAt: response.rejectedAt },
    });
    this.emitCollabChange(payload.dispatchId, 'rejected', payload.originTeam, payload.targetTeam);

    // Fixed flow: notify originating agent that task was rejected
    try {
      await this.workspace.appendMessage(payload.originTeam, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务被拒绝] "${payload.task.subject}" — ${teamSlug} 拒绝了此任务。原因：${reason ?? '未说明'}`,
        meta: {
          source: 'cross_team_rejected',
          dispatchId: payload.dispatchId,
          targetTeam: teamSlug,
          rejectReason: reason,
        },
      });
    } catch {}

    // Feishu notification
    this.sendFeishuNotification(
      `跨团队任务被拒绝：${payload.originTeam} → ${teamSlug}\n${payload.task.subject}\n原因：${reason ?? '未说明'}`
    );
  }

  // ── Deliver / Approve / Revision ────────────────────────────────

  async deliverTask(
    teamSlug: string,
    dispatchId: string,
    result: string
  ): Promise<{ ok: boolean }> {
    const collabTask = this.collabBoard.getTask(dispatchId);
    if (!collabTask) {
      throw new Error(`No collab task found for dispatchId: ${dispatchId}`);
    }

    const localTasks = await this.workspace.readTasks(teamSlug).catch(() => []);
    const completedTask = localTasks.find((task) => task.dispatchMeta?.dispatchId === dispatchId);
    if (!completedTask) {
      throw new Error(`No local task found for dispatchId: ${dispatchId}`);
    }
    if (completedTask.status !== 'done') {
      throw new Error('Task result cannot be delivered before the agent marks the task done.');
    }

    if (collabTask.status === 'approved') {
      throw new Error('Task result has already been approved and cannot be delivered again.');
    }

    const deliveredAt = new Date().toISOString();

    // Send deliver response to origin team
    const response: TaskHandshakeResponse = {
      dispatchId,
      type: 'task_deliver',
      fromTeam: teamSlug,
      toTeam: collabTask.fromTeam,
      result,
      deliveredAt,
    };

    const isLocalOrigin = await this.isLocalTeam(collabTask.fromTeam);
    if (isLocalOrigin) {
      await this.handleLocalResponse(response);
    } else if (this.redis) {
      await this.redis
        .xadd(`task:response:${collabTask.fromTeam}`, '*', 'payload', JSON.stringify(response))
        .catch((err: Error) => {
          console.error('[TaskDispatchService] deliver xadd failed:', err.message);
        });
    }

    // Update local collab board
    const deliveredTask = this.collabBoard.transition({
      dispatchId,
      expected: ['in_progress', 'accepted', 'revision'],
      next: 'delivered',
      actor: { type: 'team', id: teamSlug },
      eventType: 'task_delivered',
      payload: { summary: result.slice(0, 1000) },
      extra: { result, deliveredAt },
    });
    this.emitCollabChange(dispatchId, 'delivered', deliveredTask.fromTeam, deliveredTask.toTeam);

    // Notify origin agent: task is ready for review
    try {
      await this.workspace.appendMessage(collabTask.fromTeam, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务待审核] "${collabTask.subject}" — ${teamSlug} 已完成任务并提交交付结果，请审核。结果：${result}`,
        meta: {
          source: 'cross_team_delivered',
          dispatchId,
          targetTeam: teamSlug,
          result,
        },
      });
    } catch {}

    this.sendFeishuNotification(
      `跨团队任务待审核：${collabTask.fromTeam} ← ${teamSlug}\n${collabTask.subject}\n状态：待审核`
    );

    return { ok: true };
  }

  async approveTask(teamSlug: string, dispatchId: string): Promise<{ ok: boolean }> {
    const collabTask = this.collabBoard.getTask(dispatchId);
    if (!collabTask) {
      throw new Error(`No collab task found for dispatchId: ${dispatchId}`);
    }

    const approvedAt = new Date().toISOString();

    // Send approve response to target team
    const response: TaskHandshakeResponse = {
      dispatchId,
      type: 'task_approve',
      fromTeam: teamSlug,
      toTeam: collabTask.toTeam,
      approvedAt,
    };

    const isLocalTarget = await this.isLocalTeam(collabTask.toTeam);
    if (isLocalTarget) {
      await this.handleLocalResponse(response);
    } else if (this.redis) {
      await this.redis
        .xadd(`task:response:${collabTask.toTeam}`, '*', 'payload', JSON.stringify(response))
        .catch((err: Error) => {
          console.error('[TaskDispatchService] approve xadd failed:', err.message);
        });
    }

    // Update collab board
    const approvedTask = this.collabBoard.transition({
      dispatchId,
      expected: 'delivered',
      next: 'approved',
      actor: { type: 'team', id: teamSlug },
      eventType: 'task_approved',
      payload: { approvedAt },
      extra: { approvedAt },
    });
    this.emitCollabChange(dispatchId, 'approved', approvedTask.fromTeam, approvedTask.toTeam);

    // Notify origin agent: task is fully complete, you can continue
    try {
      await this.workspace.appendMessage(collabTask.fromTeam, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务已完成] "${collabTask.subject}" — ${collabTask.toTeam} 的交付已通过审核，此跨团队任务结束。`,
        meta: {
          source: 'cross_team_approved',
          dispatchId,
          targetTeam: collabTask.toTeam,
        },
      });
    } catch {}

    // Notify target agent: approved
    try {
      await this.workspace.appendMessage(collabTask.toTeam, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务审核通过] "${collabTask.subject}" — ${teamSlug} 已通过审核，任务完成。`,
        meta: {
          source: 'cross_team_approved_target',
          dispatchId,
          originTeam: teamSlug,
        },
      });
    } catch {}

    this.sendFeishuNotification(
      `跨团队任务完成：${collabTask.fromTeam} ← ${collabTask.toTeam}\n${collabTask.subject}\n状态：已完成`
    );

    return { ok: true };
  }

  async rejectResult(
    teamSlug: string,
    dispatchId: string,
    feedback: string
  ): Promise<{ ok: boolean }> {
    const collabTask = this.collabBoard.getTask(dispatchId);
    if (!collabTask) {
      throw new Error(`No collab task found for dispatchId: ${dispatchId}`);
    }

    const newRevisionCount = collabTask.revisionCount + 1;

    // Send revision response to target team
    const response: TaskHandshakeResponse = {
      dispatchId,
      type: 'task_revision',
      fromTeam: teamSlug,
      toTeam: collabTask.toTeam,
      feedback,
    };

    const isLocalTarget = await this.isLocalTeam(collabTask.toTeam);
    if (isLocalTarget) {
      await this.handleLocalResponse(response);
    } else if (this.redis) {
      await this.redis
        .xadd(`task:response:${collabTask.toTeam}`, '*', 'payload', JSON.stringify(response))
        .catch((err: Error) => {
          console.error('[TaskDispatchService] revision xadd failed:', err.message);
        });
    }

    // Update collab board
    const revisionTask = this.collabBoard.transition({
      dispatchId,
      expected: 'delivered',
      next: 'revision',
      actor: { type: 'team', id: teamSlug },
      eventType: 'revision_requested',
      payload: {
        feedback,
        previousResult: collabTask.result,
        revisionCount: newRevisionCount,
      },
      extra: {
        feedback,
        revisionCount: newRevisionCount,
      },
    });
    this.emitCollabChange(dispatchId, 'revision', revisionTask.fromTeam, revisionTask.toTeam);

    return { ok: true };
  }

  /** Get the collaboration board. */
  getCollabBoard() {
    return this.collabBoard.getBoard();
  }

  /** Get a single collab task. */
  getCollabTask(dispatchId: string) {
    return this.collabBoard.getTask(dispatchId);
  }

  /** Get event log for a collab task. */
  getCollabTaskEvents(dispatchId: string) {
    return this.collabBoard.getEvents(dispatchId);
  }

  listPendingRequests(teamSlug: string): TaskDispatchPayload[] {
    const results: TaskDispatchPayload[] = [];
    for (const [, req] of this.pendingRequests) {
      if (req.teamSlug === teamSlug) {
        results.push(req.payload);
      }
    }
    return results;
  }

  async onTaskCompleted(teamSlug: string, taskId: string): Promise<void> {
    const tasks = await this.workspace.readTasks(teamSlug);
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.dispatchMeta) return;

    const meta = task.dispatchMeta;
    const update: TaskStatusUpdate = {
      dispatchId: meta.dispatchId,
      originTeam: meta.originTeam,
      status: 'completed',
      remoteTaskId: task.id,
      timestamp: new Date().toISOString(),
      result: task.result ?? undefined,
    };

    await this.workspace.patchTask(teamSlug, taskId, {
      dispatchMeta: { ...meta, status: 'completed', completedAt: update.timestamp },
    } as any);

    const collabTask = this.collabBoard.getTask(meta.dispatchId);
    if (collabTask) {
      this.emitCollabChange(
        meta.dispatchId,
        collabTask.status,
        collabTask.fromTeam,
        collabTask.toTeam
      );
    }

    // Completion only marks the target-side task as done. The origin team should
    // receive the callback/result through deliverTask(), which is gated above by
    // this local done state.

    if (this.redis) {
      const channel = `task:status:${meta.originTeam}`;
      await this.redis.publish(channel, JSON.stringify(update)).catch((err: Error) => {
        console.error('[TaskDispatchService] status publish failed:', err.message);
      });
    }
  }

  // ── Local team check ─────────────────────────────────────────

  private async isLocalTeam(teamSlug: string): Promise<boolean> {
    try {
      await this.workspace.readTeamManifest(teamSlug);
      return true;
    } catch {
      return false;
    }
  }

  // ── Unified Redis dispatch ───────────────────────────────────────

  private async handleRedisDispatch(
    dispatchMeta: DispatchMeta,
    task: { subject: string; description?: string; prompt?: string },
    needsHumanReview?: boolean
  ): Promise<void> {
    const payload: TaskDispatchPayload = {
      dispatchId: dispatchMeta.dispatchId,
      originTeam: dispatchMeta.originTeam,
      targetTeam: dispatchMeta.targetTeam,
      task: { subject: task.subject, description: task.description, prompt: task.prompt },
      dispatchedAt: dispatchMeta.dispatchedAt,
      deadline: dispatchMeta.deadline,
      needsHumanReview,
    };

    // Store in memory for accept/reject
    this.pendingRequests.set(dispatchMeta.dispatchId, {
      payload,
      msgId: `redis-${Date.now()}`,
      groupName: 'dispatch-group',
      teamSlug: dispatchMeta.targetTeam,
    });

    // Publish to Redis stream
    const streamKey = `task:dispatch:${dispatchMeta.targetTeam}`;
    await this.redis!.xadd(streamKey, '*', 'payload', JSON.stringify(payload));

    // Do not write an execution-looking runtime/inbox prompt here. Dispatch creation
    // only makes a target TODO visible; runtime delivery happens after Start.
    void needsHumanReview;

    this.sendFeishuNotification(
      `跨团队任务派发：${dispatchMeta.originTeam} → ${dispatchMeta.targetTeam}\n${task.subject}`
    );
  }

  // ── Feishu notification helper ──────────────────────────────────

  private sendFeishuNotification(text: string): void {
    setTimeout(() => {
      try {
        const { execSync } = require('node:child_process');
        execSync(
          `feishu-cli msg send --receive-id-type chat_id --receive-id oc_e7d4204895f8f9d763d9f0e42ead1e5e --text ${JSON.stringify(text)}`,
          { timeout: 5000, stdio: 'pipe' }
        );
      } catch {
        // best effort
      }
    }, 0);
  }

  // ── Local response (same machine) ─────────────────────────────

  private async handleLocalResponse(response: TaskHandshakeResponse): Promise<void> {
    await this.applyResponse(response);
  }

  // ── Redis connection ──────────────────────────────────────────

  private async connectRedis(): Promise<void> {
    if (!this.config?.redis) return;
    let redis: Redis | null = null;
    let redisSub: Redis | null = null;
    try {
      const ioredis = await import('ioredis');
      const { port, password, db } = this.config.redis;
      const opts = {
        host: normalizeRedisHost(this.config.redis.host),
        port,
        password: password || undefined,
        db: db ?? 0,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      };

      redis = new ioredis.default(opts);
      redisSub = new ioredis.default(opts);

      redis.on('error', () => {
        /* handled by task bus connection status */
      });
      redisSub.on('error', () => {
        /* handled by task bus connection status */
      });

      await redis.connect();
      await redisSub.connect();
      await redis.ping();

      this.redis = redis;
      this.redisSub = redisSub;
      redis = null;
      redisSub = null;
      // The connection itself stays open even when cross-team collaboration is
      // disabled: usage telemetry shares this Redis (and the telemetry "已连接"
      // status is driven by isRedisConnected()), so a healthy bus must read as
      // connected. But the team-bus producers below are pure collaboration —
      // heartbeat discovery (task:teams / task:team:info:*), dispatch/response
      // stream consumers, and the status pub/sub — so they are gated on
      // collaboration. With collaboration off, NO task:* keys are ever written,
      // which is exactly what users expect when they disable the feature.
      if (this.config?.collaboration !== false) {
        this.collabBoard.setRedis(this.redis);
        this.startHeartbeat();
        this.startConsumers();
        this.startResponseConsumers();
        this.subscribeStatus();
      }
    } catch {
      this.collabBoard.setRedis(null);
      redis?.disconnect();
      redisSub?.disconnect();
      this.redis?.disconnect();
      this.redisSub?.disconnect();
      this.redis = null;
      this.redisSub = null;
    }
  }

  // ── Heartbeat + agent info ────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const beat = async () => {
      if (!this.redis || this.disposed) return;
      const now = Date.now();
      const localTeams = await this.workspace.listTeams();
      for (const team of localTeams) {
        await this.redis.zadd('task:teams', now, team.slug).catch(() => {});
        await this.redis
          .hset(`task:team:info:${team.slug}`, {
            slug: team.slug,
            displayName: team.displayName ?? team.slug,
            harness: team.harness,
            description: team.description ?? '',
            capabilities: JSON.stringify(this.inferCapabilities(team)),
            collaboration: String(team.collaboration !== false),
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }

      // Check deadline timeouts
      await this.checkDeadlines(localTeams);
    };
    beat();
    this.heartbeatTimer = setInterval(beat, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async checkDeadlines(localTeams: TeamManifest[]): Promise<void> {
    for (const team of localTeams) {
      try {
        const tasks = await this.workspace.readTasks(team.slug);
        for (const task of tasks) {
          if (
            ['received', 'pending_accept'].includes(task.dispatchMeta?.status ?? '') &&
            task.dispatchMeta?.deadline &&
            new Date(task.dispatchMeta.deadline).getTime() < Date.now()
          ) {
            await this.workspace.patchTask(team.slug, task.id, {
              dispatchMeta: {
                ...task.dispatchMeta,
                status: 'failed',
                rejectionReason: 'handshake timeout',
              },
            } as any);
          }
        }
      } catch {
        /* skip broken teams */
      }
    }
  }

  // ── Dispatch consumers (XREADGROUP) ───────────────────────────

  private startConsumers(): void {
    if (!this.redis || !this.redisSub) return;

    const startForTeam = async (teamSlug: string) => {
      if (this.consumerTeamSlugs.has(teamSlug)) return;
      this.consumerTeamSlugs.add(teamSlug);
      const streamKey = `task:dispatch:${teamSlug}`;
      const groupName = `hermit-${teamSlug}`;
      const consumerId = `consumer-${process.pid}`;

      try {
        await this.redis!.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
      } catch {
        // Group already exists
      }

      const poll = async () => {
        if (this.disposed || !this.redisSub) return;
        try {
          const raw: unknown = await (this.redisSub as any).xreadgroup(
            'GROUP',
            groupName,
            consumerId,
            'BLOCK',
            5000,
            'COUNT',
            1,
            'STREAMS',
            streamKey,
            '>'
          );
          const results = raw as [string, [string, (string | Buffer)[]][]][] | null;

          if (!results || results.length === 0) return;

          for (const [, messages] of results) {
            if (!Array.isArray(messages)) continue;
            for (const [msgId, fields] of messages) {
              await this.handleIncomingDispatch(teamSlug, msgId, fields, groupName);
            }
          }
        } catch {
          // Read error — will retry next poll
        }
      };

      poll();
      const timer = setInterval(poll, 5000);
      this.consumerTimers.push(timer);
    };

    const syncConsumers = () =>
      void this.workspace.listTeams().then((teams) => {
        for (const team of teams) {
          void startForTeam(team.slug);
        }
      });
    syncConsumers();
    this.consumerTimers.push(setInterval(syncConsumers, 10_000));
  }

  private async handleIncomingDispatch(
    teamSlug: string,
    msgId: string,
    fields: (string | Buffer)[],
    groupName: string
  ): Promise<void> {
    try {
      const payloadStr = fields[1]?.toString();
      if (!payloadStr) return;

      const payload: TaskDispatchPayload = JSON.parse(payloadStr);
      const alreadyPending = this.pendingRequests.has(payload.dispatchId);

      const fromTeamManifest = await this.safeReadManifest(payload.originTeam);
      const toTeamManifest = await this.safeReadManifest(teamSlug);
      const createdAt = payload.dispatchedAt || new Date().toISOString();
      this.collabBoard.addTask({
        id: payload.dispatchId,
        dispatchId: payload.dispatchId,
        subject: payload.task.subject,
        description: payload.task.description,
        fromTeam: payload.originTeam,
        fromTeamDisplay: fromTeamManifest?.displayName ?? payload.originTeam,
        toTeam: teamSlug,
        toTeamDisplay: toTeamManifest?.displayName ?? teamSlug,
        status: 'received',
        deadline: payload.deadline,
        needsHumanReview: payload.needsHumanReview ?? false,
        revisionCount: 0,
        createdAt,
        updatedAt: createdAt,
      });
      this.emitCollabChange(payload.dispatchId, 'received', payload.originTeam, teamSlug);

      const existingTasks = await this.workspace.readTasks(teamSlug).catch(() => []);
      const existingTask = existingTasks.find(
        (task) => task.dispatchMeta?.dispatchId === payload.dispatchId
      );
      const localTask =
        existingTask ??
        (await this.workspace.createTask(teamSlug, {
          title: payload.task.subject,
          description: payload.task.description ?? payload.task.prompt ?? '',
          status: 'todo',
          dispatchMeta: {
            dispatchId: payload.dispatchId,
            originTeam: payload.originTeam,
            targetTeam: teamSlug,
            status: 'received',
            dispatchedAt: payload.dispatchedAt,
            receivedAt: new Date().toISOString(),
            deadline: payload.deadline,
          },
        }));

      // Store in pending requests — wait for a human to accept/reject the agent-created dispatch.
      this.pendingRequests.set(payload.dispatchId, {
        payload,
        msgId,
        groupName,
        teamSlug,
        localTaskId: localTask.id,
      });

      // Do not append an execution-looking message here. The target TODO card is
      // the only pre-start surface; runtime delivery happens after the user clicks Start.
      void alreadyPending;

      console.log(
        `[TaskDispatchService] received dispatch request: ${payload.dispatchId} from ${payload.originTeam} → ${teamSlug}`
      );
    } catch (err) {
      console.error('[TaskDispatchService] handleIncomingDispatch error:', err);
    }
  }

  private stopConsumers(): void {
    for (const t of this.consumerTimers) clearInterval(t);
    this.consumerTimers = [];
    this.consumerTeamSlugs.clear();
  }

  // ── Response consumers (XREADGROUP) ───────────────────────────

  private startResponseConsumers(): void {
    if (!this.redis || !this.redisSub) return;

    const startForTeam = async (teamSlug: string) => {
      if (this.responseConsumerTeamSlugs.has(teamSlug)) return;
      this.responseConsumerTeamSlugs.add(teamSlug);
      const streamKey = `task:response:${teamSlug}`;
      const groupName = `hermit-response-${teamSlug}`;
      const consumerId = `response-consumer-${process.pid}`;

      try {
        await this.redis!.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
      } catch {
        // Group already exists
      }

      const poll = async () => {
        if (this.disposed || !this.redisSub) return;
        try {
          const raw: unknown = await (this.redisSub as any).xreadgroup(
            'GROUP',
            groupName,
            consumerId,
            'BLOCK',
            5000,
            'COUNT',
            1,
            'STREAMS',
            streamKey,
            '>'
          );
          const results = raw as [string, [string, (string | Buffer)[]][]][] | null;

          if (!results || results.length === 0) return;

          for (const [, messages] of results) {
            if (!Array.isArray(messages)) continue;
            for (const [msgId, fields] of messages) {
              await this.handleIncomingResponse(teamSlug, msgId, fields, groupName);
            }
          }
        } catch {
          // Read error — will retry next poll
        }
      };

      poll();
      const timer = setInterval(poll, 5000);
      this.responseConsumerTimers.push(timer);
    };

    const syncConsumers = () =>
      void this.workspace.listTeams().then((teams) => {
        for (const team of teams) {
          void startForTeam(team.slug);
        }
      });
    syncConsumers();
    this.responseConsumerTimers.push(setInterval(syncConsumers, 10_000));
  }

  private async handleIncomingResponse(
    _teamSlug: string,
    msgId: string,
    fields: (string | Buffer)[],
    groupName: string
  ): Promise<void> {
    try {
      const payloadStr = fields[1]?.toString();
      if (!payloadStr) return;

      const response: TaskHandshakeResponse = JSON.parse(payloadStr);
      await this.applyResponse(response);

      // ACK
      if (this.redis) {
        await this.redis.xack(`task:response:${_teamSlug}`, groupName, msgId).catch(() => {});
      }
    } catch (err) {
      console.error('[TaskDispatchService] handleIncomingResponse error:', err);
    }
  }

  private async applyResponse(response: TaskHandshakeResponse): Promise<void> {
    const originTeam = response.toTeam;
    const tasks = await this.workspace.readTasks(originTeam);
    const shadowTask = tasks.find((t) => t.dispatchMeta?.dispatchId === response.dispatchId);
    if (!shadowTask) return;

    const meta = { ...shadowTask.dispatchMeta! };

    if (response.type === 'task_accept') {
      meta.status = 'accepted';
      meta.acceptedAt = response.acceptedAt;
      meta.remoteTaskId = response.remoteTaskId;
      // Collab board update already done in acceptTask
    } else if (response.type === 'task_reject') {
      meta.status = 'rejected';
      meta.rejectedAt = response.rejectedAt;
      meta.rejectionReason = response.reason;
      // Collab board update already done in rejectTask
    } else if (response.type === 'task_deliver') {
      meta.status = 'completed';
      meta.completedAt = response.deliveredAt;
      await this.workspace.patchTask(originTeam, shadowTask.id, {
        dispatchMeta: meta,
      } as any);

      // Auto-approve if no human review needed
      const collabTask = this.collabBoard.getTask(response.dispatchId);
      if (collabTask && !collabTask.needsHumanReview && collabTask.status === 'delivered') {
        const approvedAt = new Date().toISOString();
        this.collabBoard.transition({
          dispatchId: response.dispatchId,
          expected: 'delivered',
          next: 'approved',
          actor: { type: 'system', id: 'auto-approve' },
          eventType: 'task_approved',
          payload: { auto: true },
          extra: { approvedAt },
        });
        this.emitCollabChange(response.dispatchId, 'approved', response.fromTeam, response.toTeam);
      }
      return;
    } else if (response.type === 'task_approve') {
      // Received by target team — already handled in approveTask
      return;
    } else if (response.type === 'task_revision') {
      // Received by target team — already handled in rejectResult
      return;
    }

    await this.workspace.patchTask(originTeam, shadowTask.id, {
      dispatchMeta: meta,
    } as any);
  }

  private stopResponseConsumers(): void {
    for (const t of this.responseConsumerTimers) clearInterval(t);
    this.responseConsumerTimers = [];
    this.responseConsumerTeamSlugs.clear();
  }

  // ── Status subscribe (completion notifications) ──────────────

  private subscribeStatus(): void {
    if (!this.redisSub) return;

    this.workspace.listTeams().then((teams) => {
      for (const team of teams) {
        const channel = `task:status:${team.slug}`;

        this.redisSub!.subscribe(channel).catch((err: Error) => {
          console.error('[TaskDispatchService] subscribe failed:', err.message);
        });
      }
    });

    this.redisSub.on('message', (channel: string, message: string) => {
      if (!channel.startsWith('task:status:')) return;

      try {
        const update: TaskStatusUpdate = JSON.parse(message);
        const teamSlug = channel.replace('task:status:', '');
        this.handleStatusSync(teamSlug, update);
      } catch {
        // Ignore malformed messages
      }
    });
  }

  private async handleStatusSync(teamSlug: string, update: TaskStatusUpdate): Promise<void> {
    const tasks = await this.workspace.readTasks(teamSlug);
    const shadowTask = tasks.find((t) => t.dispatchMeta?.dispatchId === update.dispatchId);
    if (!shadowTask) return;

    await this.workspace.patchTask(teamSlug, shadowTask.id, {
      dispatchMeta: {
        ...shadowTask.dispatchMeta!,
        status: update.status,
        completedAt:
          update.status === 'completed' ? update.timestamp : shadowTask.dispatchMeta!.completedAt,
        remoteTaskId: update.remoteTaskId ?? shadowTask.dispatchMeta!.remoteTaskId,
      },
    } as any);
  }

  // ── Capability inference ──────────────────────────────────────

  private inferCapabilities(team: TeamManifest): AgentCapability[] {
    const caps: AgentCapability[] = [];
    if (team.harness) {
      caps.push({ skill: team.harness, description: `${team.harness} agent` });
    }
    if (team.description) {
      caps.push({ skill: 'general', description: team.description });
    }
    return caps;
  }

  private async safeReadManifest(teamSlug: string): Promise<TeamManifest | null> {
    try {
      return await this.workspace.readTeamManifest(teamSlug);
    } catch {
      return null;
    }
  }

  private emitCollabChange(
    dispatchId: string,
    status: string,
    fromTeam: string,
    toTeam: string
  ): void {
    this.onCollabChange?.(dispatchId, status, fromTeam, toTeam);
  }
}
