/**
 * Worker Society — 应用层自治引擎
 *
 * 把领域策略编排成可被 MCP 工具 / Fastify 路由 / 前端调用的 use case。
 * 这是「worker 自治」替代「派单」的主路径：发布需求 → 自荐 → 选派 →
 * 执行 → 交付 → 审核，全程无中心 dispatch，并持续积累声誉与关系。
 *
 * 依赖注入：所有副作用通过 ports，保证可单测。
 */

import type {
  PublishedNeed,
  Relationship,
  SocialEvent,
  WorkerDiscoveryQuery,
  WorkerProfile,
} from '../domain/models/society';
import {
  applyReputationDelta,
  autonomousVolunteers,
  computeFitScore,
  discoverWorkers as discoverWorkersPolicy,
  recordCollaboration,
  reputationDeltaForOutcome,
  requestRevision,
  selectAssignee as selectAssigneePolicy,
  transitionNeed,
  volunteerFor,
} from '../domain/policies/societyPolicies';
import type { AutonomyOptions } from '../domain/policies/societyPolicies';
import type {
  ClockPort,
  MessageGateway,
  NeedStore,
  RelationshipStore,
  SocialEventSink,
  WorkerProfileStore,
} from './ports';

export interface RegisterProfileCommand {
  workerId: string;
  name: string;
  kind?: 'composite' | 'atomic';
  harness?: string;
  capabilities?: WorkerProfile['capabilities'];
  interests?: string[];
  maxConcurrent?: number;
  reputation?: number;
  description?: string;
}

export interface PublishNeedCommand {
  postedBy: string;
  subject: string;
  description?: string;
  requiredCapabilities: string[];
  priority?: number;
  deadline?: string;
}

export interface Outcome {
  ok: boolean;
  reason?: string;
  [k: string]: unknown;
}

export class WorkerSocietyService {
  constructor(
    private readonly profiles: WorkerProfileStore,
    private readonly needs: NeedStore,
    private readonly relationships: RelationshipStore,
    private readonly messages: MessageGateway,
    private readonly clock: ClockPort,
    private readonly events?: SocialEventSink
  ) {}

  // ── 身份 / 发现 ──────────────────────────────────────────────────

  /** 注册或更新一个 worker 社会档案。 */
  async registerProfile(cmd: RegisterProfileCommand): Promise<WorkerProfile> {
    const existing = await this.profiles.get(cmd.workerId);
    const profile: WorkerProfile = {
      workerId: cmd.workerId,
      name: cmd.name,
      kind: cmd.kind ?? 'composite',
      harness: cmd.harness ?? existing?.harness,
      capabilities: cmd.capabilities ?? existing?.capabilities ?? [],
      interests: cmd.interests ?? existing?.interests ?? [],
      maxConcurrent: cmd.maxConcurrent ?? existing?.maxConcurrent ?? 3,
      activeTaskCount: existing?.activeTaskCount ?? 0,
      reputation: cmd.reputation ?? existing?.reputation ?? 50,
      status: existing?.status ?? 'online',
      description: cmd.description ?? existing?.description,
    };
    return this.profiles.upsert(profile);
  }

  async getProfile(workerId: string): Promise<WorkerProfile | undefined> {
    return this.profiles.get(workerId);
  }

  /** 动态发现 worker（按能力过滤、声誉排序）。 */
  async discoverWorkers(query: WorkerDiscoveryQuery = {}): Promise<WorkerProfile[]> {
    const all = await this.profiles.list();
    return discoverWorkersPolicy(all, query);
  }

  async getRelationships(): Promise<Relationship[]> {
    return this.relationships.list();
  }

  // ── 广场生命周期 ────────────────────────────────────────────────

  /** 发布一个需求到广场。 */
  async publishNeed(cmd: PublishNeedCommand): Promise<{ need: PublishedNeed }> {
    const now = this.clock.now();
    const needId = `need-${randomId()}`;
    const need: PublishedNeed = {
      needId,
      postedBy: cmd.postedBy,
      subject: cmd.subject,
      description: cmd.description,
      requiredCapabilities: cmd.requiredCapabilities,
      priority: cmd.priority ?? 5,
      deadline: cmd.deadline,
      status: 'open',
      volunteers: [],
      createdAt: now,
      revisionCount: 0,
    };
    const saved = await this.needs.upsert(need);
    this.emit({
      type: 'need_published',
      actors: [cmd.postedBy],
      needId,
      summary: `${cmd.postedBy} 发布需求：${cmd.subject}`,
    });
    return { need: saved };
  }

  /** worker 对需求自荐。 */
  async volunteerFor(needId: string, workerId: string, note?: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    const worker = await this.profiles.get(workerId);
    if (!worker) return { ok: false, reason: 'worker_not_found' };

    const rels = await this.relationships.list();
    const outcome = volunteerFor(need, worker, this.clock.now(), rels);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    await this.needs.upsert(outcome.need);
    this.emit({
      type: 'volunteered',
      actors: [workerId, need.postedBy],
      needId,
      summary: `${worker.name} 自荐了「${need.subject}」（适配度 ${(outcome.volunteer!.fitScore * 100).toFixed(0)}%）`,
    });
    await this.messages
      .send({
        fromWorker: workerId,
        toWorker: need.postedBy,
        text: note
          ? `${worker.name} 自荐了你的需求「${need.subject}」。备注：${note}`
          : `${worker.name} 自荐了你的需求「${need.subject}」。`,
        needId,
      })
      .catch(() => undefined);
    return { ok: true, fitScore: outcome.volunteer!.fitScore };
  }

  /** 为需求选择最优自荐者并进入 assigned。 */
  async selectAssignee(needId: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    const all = await this.profiles.list();
    const byId = new Map(all.map((w) => [w.workerId, w]));
    const rels = await this.relationships.list();
    const chosen = selectAssigneePolicy(need, byId, rels);
    if (!chosen) return { ok: false, reason: 'no_eligible_volunteer' };

    const t = transitionNeed(need, 'assigned', this.clock.now(), { assignee: chosen.workerId });
    if (!t.ok) return { ok: false, reason: t.reason };
    const saved = await this.needs.upsert(t.need);
    // 自荐者被选中后，占用一个并发槽。
    const w = byId.get(chosen.workerId);
    if (w) await this.profiles.upsert({ ...w, activeTaskCount: w.activeTaskCount + 1 });
    this.emit({
      type: 'assigned',
      actors: [chosen.workerId, saved.postedBy],
      needId,
      summary: `${chosen.workerId} 被选派执行「${saved.subject}」`,
    });
    await this.messages
      .send({
        fromWorker: saved.postedBy,
        toWorker: chosen.workerId,
        text: `你被选派执行需求「${saved.subject}」。完成后请调用 deliver_need 交付。`,
        needId,
      })
      .catch(() => undefined);
    return { ok: true, assignee: chosen.workerId };
  }

  /** 执行者开始执行。 */
  async startNeed(needId: string, byWorker: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    if (need.assignee !== byWorker) return { ok: false, reason: 'not_assignee' };
    const t = transitionNeed(need, 'in_progress', this.clock.now());
    if (!t.ok) return { ok: false, reason: t.reason };
    await this.needs.upsert(t.need);
    this.emit({
      type: 'collaboration_started',
      actors: [byWorker],
      needId,
      summary: `${byWorker} 开始执行「${need.subject}」`,
    });
    return { ok: true };
  }

  /** 执行者交付结果。 */
  async deliverNeed(needId: string, result: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    const t = transitionNeed(need, 'delivered', this.clock.now(), { result });
    if (!t.ok) return { ok: false, reason: t.reason };
    await this.needs.upsert(t.need);
    this.emit({
      type: 'delivered',
      actors: [need.assignee ?? '?', need.postedBy],
      needId,
      summary: `${need.assignee} 交付了「${need.subject}」`,
    });
    return { ok: true };
  }

  /** 审核通过 → 关闭，并奖励声誉 + 强化关系。 */
  async acceptDelivery(needId: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    const t = transitionNeed(need, 'closed', this.clock.now());
    if (!t.ok) return { ok: false, reason: t.reason };
    await this.needs.upsert(t.need);

    if (need.assignee) await this.reward(need.assignee, need.postedBy, true, needId);
    // 释放并发槽。
    const w = await this.profiles.get(need.assignee ?? '');
    if (w)
      await this.profiles.upsert({ ...w, activeTaskCount: Math.max(0, w.activeTaskCount - 1) });

    this.emit({
      type: 'closed',
      actors: [need.postedBy, need.assignee ?? '?'],
      needId,
      summary: `「${need.subject}」审核通过，协作完成`,
    });
    return { ok: true };
  }

  /** 审核退回 → 重做；记录一次未成功协作，声誉小幅下降。 */
  async requestRevision(needId: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    const t = requestRevision(need, this.clock.now());
    if (!t.ok) return { ok: false, reason: t.reason };
    await this.needs.upsert(t.need);
    if (need.assignee) await this.reward(need.assignee, need.postedBy, false, needId);
    this.emit({
      type: 'delivered',
      actors: [need.postedBy, need.assignee ?? '?'],
      needId,
      summary: `「${need.subject}」被退回重做（第 ${t.need.revisionCount} 次）`,
    });
    return { ok: true, escalated: t.reason === 'revision_limit_exceeded' };
  }

  async cancelNeed(needId: string): Promise<Outcome> {
    const need = await this.needs.get(needId);
    if (!need) return { ok: false, reason: 'need_not_found' };
    const t = transitionNeed(need, 'cancelled', this.clock.now());
    if (!t.ok) return { ok: false, reason: t.reason };
    await this.needs.upsert(t.need);
    return { ok: true };
  }

  /** 扫描过期未分配的需求，标记 expired。返回处理数量。 */
  async expireNeeds(): Promise<number> {
    const now = this.clock.now();
    const nowMs = Date.parse(now);
    const open = await this.needs.listOpen();
    let n = 0;
    for (const need of open) {
      if (need.deadline && Date.parse(need.deadline) < nowMs) {
        const t = transitionNeed(need, 'expired', now);
        if (t.ok) {
          await this.needs.upsert(t.need);
          n += 1;
        }
      }
    }
    return n;
  }

  /**
   * 自治驱动一轮：扫描广场上所有 open 需求，让匹配的 worker 主动自荐。
   * 返回本轮实际产生的自荐次数。这是「worker 自治」替代「派单」的运行时入口——
   * 可由定时器、MCP 工具或前端按钮触发，全程无中心调度。
   *
   * 决策由纯策略 autonomousVolunteers 给出；此处只负责拉取快照、落库自荐、计数。
   * 每个决策都通过 volunteerFor 走标准路径，复用其校验与事件/消息副作用。
   */
  async runAutonomyTick(opts: AutonomyOptions = {}): Promise<number> {
    const [openNeeds, workers, relationships] = await Promise.all([
      this.needs.listOpen(),
      this.profiles.list(),
      this.relationships.list(),
    ]);
    const decisions = autonomousVolunteers(openNeeds, workers, relationships, opts);
    let applied = 0;
    for (const d of decisions) {
      const r = await this.volunteerFor(d.needId, d.workerId);
      if (r.ok) applied += 1;
    }
    return applied;
  }

  /**
   * 自治选派（去中心化）：扫描所有「仍有自荐者、尚未选派」的 open 需求，
   * 逐一按适配度选出最优自荐者并进入 assigned。返回本轮选派次数。
   *
   * 与 runAutonomyTick 配合构成完整自治回路：先让 worker 自发投标（volunteer），
   * 待竞争充分后再由适配度择优（select）——全程无中心 dispatcher 人工指派。
   * 复用 selectAssignee 的标准路径（占用并发槽、发事件、发消息）。
   */
  async autoSelectPending(): Promise<number> {
    const open = await this.needs.listOpen();
    let selected = 0;
    for (const need of open) {
      if (need.volunteers.length === 0) continue;
      const r = await this.selectAssignee(need.needId);
      if (r.ok) selected += 1;
    }
    return selected;
  }

  // ── 社交消息 ────────────────────────────────────────────────────

  /** worker 自由发送一条社交消息（非任务交付）；仅投递消息 + 发事件，不变更声誉/关系。 */
  async sendSocialMessage(fromWorker: string, toWorker: string, text: string): Promise<Outcome> {
    const from = await this.profiles.get(fromWorker);
    if (!from) return { ok: false, reason: 'worker_not_found' };
    const res = await this.messages.send({ fromWorker, toWorker, text });
    this.emit({
      type: 'message',
      actors: [fromWorker, toWorker],
      summary: `${from.name} → ${toWorker}：${text.slice(0, 60)}`,
    });
    return { ok: res.delivered };
  }

  // ── helpers ────────────────────────────────────────────────────

  /** 应用声誉增量 + 双向记录协作关系。 */
  private async reward(
    workerId: string,
    partner: string,
    success: boolean,
    needId: string
  ): Promise<void> {
    const w = await this.profiles.get(workerId);
    if (w) {
      const delta = reputationDeltaForOutcome(success);
      await this.profiles.upsert(applyReputationDelta(w, delta));
    }
    const rels = await this.relationships.list();
    const now = this.clock.now();
    const next = recordCollaboration(
      recordCollaboration(rels, workerId, partner, success, now),
      partner,
      workerId,
      success,
      now
    );
    await this.relationships.bulkSet(next);
    if (success) {
      this.emit({
        type: 'relationship_strengthened',
        actors: [workerId, partner],
        needId,
        summary: `${workerId} 与 ${partner} 信任度上升`,
      });
    }
  }

  private emit(e: Omit<SocialEvent, 'eventId' | 'timestamp'>): void {
    this.events?.append({ ...e, eventId: `evt-${randomId()}`, timestamp: this.clock.now() });
  }
}

function randomId(): string {
  // 应用层（非 workflow 脚本）可使用 crypto.randomUUID；降级到时间+计数。
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** 为外部调用方暴露 computeFitScore 的便捷包装（如前端预估）。 */
export function estimateFit(
  need: PublishedNeed,
  worker: WorkerProfile,
  relationships: Relationship[] = []
): number {
  return computeFitScore(need, worker, relationships).score;
}
