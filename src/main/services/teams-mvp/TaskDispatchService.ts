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
import type { TeamWorkspaceService, TeamManifest } from './TeamWorkspaceService';
import type { CollaborationBoardService } from './CollaborationBoardService';
import type Redis from 'ioredis';

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
  /** Callback fired when collab task state changes (for SSE broadcast). */
  onCollabChange?: (dispatchId: string, status: string, fromTeam: string, toTeam: string) => void;

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
    opts?: { deadlineMinutes?: number; needsHumanReview?: boolean }
  ): Promise<DispatchResult> {
    if (fromTeam === targetTeam) {
      return {
        dispatchId: '',
        status: 'failed',
        targetTeam,
        message: 'Cannot dispatch to self — use native task tools instead.',
      };
    }

    const dispatchId = crypto.randomUUID();
    const now = new Date();
    const deadline = opts?.deadlineMinutes
      ? new Date(now.getTime() + opts.deadlineMinutes * 60_000).toISOString()
      : undefined;

    const dispatchMeta: DispatchMeta = {
      dispatchId,
      originTeam: fromTeam,
      targetTeam,
      status: 'pending_accept',
      dispatchedAt: now.toISOString(),
      deadline,
    };

    // Add to collaboration board before external delivery. Even failed dispatches
    // must remain visible in the canonical task projection for diagnosis/retry.
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
      status: 'pending_accept',
      deadline,
      needsHumanReview: opts?.needsHumanReview ?? false,
      revisionCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.collabBoard.addTask(collabTask);

    // Route: all dispatches require Redis
    if (!this.redis) {
      const failedTask = this.collabBoard.transition({
        dispatchId,
        expected: 'pending_accept',
        next: 'failed',
        actor: { type: 'system', id: 'task-dispatch' },
        eventType: 'task_failed',
        payload: { reason: 'Redis not configured' },
        extra: { reason: 'Redis not configured — cross-team dispatch requires task bus.' },
      });
      this.emitCollabChange(dispatchId, failedTask.status, fromTeam, targetTeam);
      return {
        dispatchId,
        status: 'failed',
        targetTeam,
        message: 'Redis not configured — cross-team dispatch requires task bus.',
      };
    }

    try {
      await this.handleRedisDispatch(dispatchMeta, task, opts?.needsHumanReview);
    } catch (err) {
      this.pendingRequests.delete(dispatchId);
      const reason = err instanceof Error ? err.message : 'Unknown Redis dispatch failure';
      const failedTask = this.collabBoard.transition({
        dispatchId,
        expected: 'pending_accept',
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

    this.emitCollabChange(dispatchId, 'pending_accept', fromTeam, targetTeam);

    return {
      dispatchId,
      status: 'pending_accept',
      targetTeam,
      message: `Task dispatched to ${targetTeam}, awaiting acceptance.`,
    };
  }

  async acceptTask(teamSlug: string, dispatchId: string): Promise<{ taskId: string }> {
    const pending = this.pendingRequests.get(dispatchId);
    if (!pending) {
      throw new Error(`No pending request found for dispatchId: ${dispatchId}`);
    }

    const { payload, msgId, groupName, localTaskId } = pending;

    const remoteTaskId = localTaskId ?? payload.dispatchId;

    // Send accept response
    const response: TaskHandshakeResponse = {
      dispatchId: payload.dispatchId,
      type: 'task_accept',
      fromTeam: teamSlug,
      toTeam: payload.originTeam,
      remoteTaskId,
      acceptedAt: new Date().toISOString(),
    };

    const isLocalOrigin = await this.isLocalTeam(payload.originTeam);
    if (isLocalOrigin) {
      await this.handleLocalResponse(response);
    } else if (this.redis) {
      await this.redis
        .xadd(`task:response:${payload.originTeam}`, '*', 'payload', JSON.stringify(response))
        .catch((err: Error) => {
          console.error('[TaskDispatchService] accept xadd failed:', err.message);
        });
    }

    if (this.redis) {
      await this.redis.xack(`task:dispatch:${teamSlug}`, groupName, msgId).catch(() => {});
    }

    this.pendingRequests.delete(dispatchId);

    // Update collab board
    const acceptedAt = new Date().toISOString();
    this.collabBoard.transition({
      dispatchId: payload.dispatchId,
      expected: 'pending_accept',
      next: 'accepted',
      actor: { type: 'team', id: teamSlug },
      eventType: 'task_accepted',
      payload: { remoteTaskId },
      extra: { acceptedAt },
    });
    this.emitCollabChange(payload.dispatchId, 'accepted', payload.originTeam, payload.targetTeam);

    // Fixed flow: notify receiving agent to start executing
    try {
      await this.workspace.appendMessage(teamSlug, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务已确认] "${payload.task.subject}" — 来自 ${payload.originTeam} 的任务已被人工确认接单，请开始执行。任务描述：${payload.task.description ?? '无'}`,
        meta: {
          source: 'cross_team_accepted',
          dispatchId: payload.dispatchId,
          originTeam: payload.originTeam,
          taskId: remoteTaskId,
        },
      });
    } catch {}

    // Fixed flow: notify originating agent that task was accepted
    try {
      await this.workspace.appendMessage(payload.originTeam, {
        from: 'system',
        to: 'team',
        role: 'agent',
        content: `[跨团队任务已接单] "${payload.task.subject}" — ${teamSlug} 已确认接单，正在执行中。`,
        meta: {
          source: 'cross_team_accepted_notify',
          dispatchId: payload.dispatchId,
          targetTeam: teamSlug,
        },
      });
    } catch {}

    // Feishu notification
    this.sendFeishuNotification(
      `跨团队任务已接单：${payload.originTeam} → ${teamSlug}\n${payload.task.subject}\n状态：执行中`
    );

    return { taskId: remoteTaskId };
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
      expected: 'pending_accept',
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
      expected: ['accepted', 'revision'],
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

    // If local team, also write to inbox
    const isLocal = await this.isLocalTeam(dispatchMeta.targetTeam);
    if (isLocal) {
      try {
        await this.workspace.appendMessage(dispatchMeta.targetTeam, {
          from: dispatchMeta.originTeam,
          to: 'team',
          role: 'agent',
          content: `[跨团队任务] ${task.subject}${task.description ? '\n' + task.description : ''}`,
          meta: {
            source: 'cross_team_dispatch',
            dispatchId: dispatchMeta.dispatchId,
            originTeam: dispatchMeta.originTeam,
            needsHumanReview,
          },
        });
      } catch (err) {
        console.error('[TaskDispatchService] inbox write failed:', (err as Error).message);
      }
    }

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
      const { host, port, password, db } = this.config.redis;
      const opts = {
        host,
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
      this.collabBoard.setRedis(this.redis);
      this.startHeartbeat();
      this.startConsumers();
      this.startResponseConsumers();
      this.subscribeStatus();
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
            task.dispatchMeta?.status === 'pending_accept' &&
            task.dispatchMeta.deadline &&
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
        status: 'pending_accept',
        deadline: payload.deadline,
        needsHumanReview: payload.needsHumanReview ?? false,
        revisionCount: 0,
        createdAt,
        updatedAt: createdAt,
      });
      this.emitCollabChange(payload.dispatchId, 'pending_accept', payload.originTeam, teamSlug);

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
            status: 'pending_accept',
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

      if (!alreadyPending) {
        await this.workspace
          .appendMessage(teamSlug, {
            from: payload.originTeam,
            to: 'team',
            role: 'agent',
            content: `[跨团队任务] ${payload.task.subject}${
              payload.task.description ? '\n' + payload.task.description : ''
            }`,
            meta: {
              source: 'cross_team_dispatch',
              dispatchId: payload.dispatchId,
              originTeam: payload.originTeam,
              needsHumanReview: payload.needsHumanReview,
            },
          })
          .catch((err: Error) => {
            console.error('[TaskDispatchService] inbox write failed:', err.message);
          });
      }

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
