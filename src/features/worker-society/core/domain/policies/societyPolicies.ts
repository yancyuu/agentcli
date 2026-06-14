/**
 * Worker Society — 领域策略（纯函数，零副作用，可单测）
 *
 * 所有需要时间戳的函数都通过 `now` 参数注入时钟，保证 core 确定性。
 * 不读写 FS/网络，不调用 new Date()。
 */

import type {
  PublishedNeed,
  Relationship,
  Volunteer,
  WorkerDiscoveryQuery,
  WorkerProfile,
} from '../models/society';

// ── 常量 ────────────────────────────────────────────────────────────

export const DEFAULT_REPUTATION = 50;
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 100;
export const REVISION_LIMIT = 3;

export interface FitWeights {
  capability: number;
  loadFairness: number;
  reputation: number;
  relationship: number;
  interest: number;
}

/** 默认适配度权重，五项之和 = 1。 */
export const DEFAULT_FIT_WEIGHTS: FitWeights = {
  capability: 0.45,
  loadFairness: 0.2,
  reputation: 0.2,
  relationship: 0.1,
  interest: 0.05,
};

export interface FitBreakdown {
  capability: number;
  loadFairness: number;
  reputation: number;
  relationshipBonus: number;
  interest: number;
  score: number;
}

// ── 能力 / 容量 ─────────────────────────────────────────────────────

/** 所需能力在 worker 身上的覆盖率（0..1）。无要求时返回 1（任意 worker 适配）。 */
export function capabilityMatchScore(required: string[], worker: WorkerProfile): number {
  if (required.length === 0) return 1;
  const skills = new Set(worker.capabilities.map((c) => c.skill.toLowerCase()));
  let matched = 0;
  for (const r of required) {
    if (skills.has(r.toLowerCase())) matched += 1;
  }
  return matched / required.length;
}

/** 兴趣与所需能力的重合度（0..1）。 */
export function interestOverlap(required: string[], interests: string[]): number {
  if (required.length === 0) return 0;
  const want = new Set(interests.map((i) => i.toLowerCase()));
  let hit = 0;
  for (const r of required) {
    if (want.has(r.toLowerCase())) hit += 1;
  }
  return hit / required.length;
}

/** worker 是否已达并发上限。 */
export function isAtCapacity(worker: WorkerProfile): boolean {
  return worker.activeTaskCount >= worker.maxConcurrent;
}

/** 是否能对某 Need 自荐：广场仍开放 + 未超载 + 非自发自选 + 有能力。 */
export function canVolunteer(need: PublishedNeed, worker: WorkerProfile): boolean {
  if (need.status !== 'open') return false;
  if (isAtCapacity(worker)) return false;
  if (need.postedBy === worker.workerId) return false;
  // 必须至少满足一项所需能力（无要求时视为适配）。
  return capabilityMatchScore(need.requiredCapabilities, worker) > 0;
}

/**
 * 开放需求「为何无人自荐」的停滞归因（供弹卡给用户可操作的反馈，而非让 need 永远卡 open）。
 * 复用 canVolunteer 判「是否还有人能接」；无人能接时再区分：没人有能力 vs 有能力但都满载。
 * 返回 null = 未停滞（非 open / 已有自荐者 / 仍有 worker 可接，只是还没触发自治）。
 */
export type NeedStallReason = 'no_matching_worker' | 'workers_at_capacity';

export function classifyOpenNeedStall(
  need: PublishedNeed,
  workers: readonly WorkerProfile[]
): NeedStallReason | null {
  if (need.status !== 'open' || need.volunteers.length > 0) return null;
  if (workers.some((w) => canVolunteer(need, w))) return null;
  const capable = workers.filter(
    (w) => w.workerId !== need.postedBy && capabilityMatchScore(need.requiredCapabilities, w) > 0
  );
  return capable.length > 0 ? 'workers_at_capacity' : 'no_matching_worker';
}

// ── 适配度 ──────────────────────────────────────────────────────────

/**
 * 计算 worker 对某 Need 的综合适配度。
 * 各因子 ∈ [0,1]，按权重加权，score ∈ [0,1]。
 * relationshipBonus = worker→postedBy 的信任度（无关系则 0）。
 */
export function computeFitScore(
  need: PublishedNeed,
  worker: WorkerProfile,
  relationships: Relationship[] = [],
  weights: FitWeights = DEFAULT_FIT_WEIGHTS
): FitBreakdown {
  const capability = capabilityMatchScore(need.requiredCapabilities, worker);
  const loadFairness =
    worker.maxConcurrent > 0 ? Math.max(0, 1 - worker.activeTaskCount / worker.maxConcurrent) : 0;
  const reputation = clamp01(worker.reputation / REPUTATION_MAX);
  const relToPoster =
    relationships.find((r) => r.fromWorker === worker.workerId && r.toWorker === need.postedBy)
      ?.trust ?? 0;
  const relationshipBonus = relToPoster;
  const interest = interestOverlap(need.requiredCapabilities, worker.interests);

  const score =
    weights.capability * capability +
    weights.loadFairness * loadFairness +
    weights.reputation * reputation +
    weights.relationship * relationshipBonus +
    weights.interest * interest;

  return {
    capability,
    loadFairness,
    reputation,
    relationshipBonus,
    interest,
    score,
  };
}

// ── 选择 / 发现 ─────────────────────────────────────────────────────

/**
 * 在自荐者中选出执行者。
 * 规则：取适配度最高者；同分按声誉高者；再同分按负载低者；仍同分取 workerId 字典序（稳定）。
 * 返回 null 表示无可选者（自荐为空或全部无效）。
 */
export function selectAssignee(
  need: PublishedNeed,
  workersById: ReadonlyMap<string, WorkerProfile>,
  relationships: Relationship[] = [],
  weights: FitWeights = DEFAULT_FIT_WEIGHTS
): Volunteer | null {
  const eligible = need.volunteers.filter((v) => {
    const w = workersById.get(v.workerId);
    return w && !isAtCapacity(w) && need.postedBy !== v.workerId;
  });
  if (eligible.length === 0) return null;

  const scored = eligible.map((v) => {
    const w = workersById.get(v.workerId)!;
    return { v, fit: computeFitScore(need, w, relationships, weights) };
  });

  scored.sort((a, b) => {
    if (b.fit.score !== a.fit.score) return b.fit.score - a.fit.score;
    const wa = workersById.get(a.v.workerId)!;
    const wb = workersById.get(b.v.workerId)!;
    if (wb.reputation !== wa.reputation) return wb.reputation - wa.reputation;
    if (wa.activeTaskCount !== wb.activeTaskCount) return wa.activeTaskCount - wb.activeTaskCount;
    return a.v.workerId.localeCompare(b.v.workerId);
  });

  return scored[0].v;
}

// ── 自组织驱动（自治大脑）──────────────────────────────────────────

export interface AutonomousVolunteerDecision {
  needId: string;
  workerId: string;
  fitScore: number;
}

export interface AutonomyOptions {
  /** 每个需求本轮最多收多少个自荐者（含已存在的自荐者）。 */
  maxVolunteersPerNeed?: number;
  /** 每个 worker 本轮最多主动认领多少个需求。 */
  maxNeedsPerWorker?: number;
}

const DEFAULT_MAX_VOLUNTEERS_PER_NEED = 3;
const DEFAULT_MAX_NEEDS_PER_WORKER = 1;

/**
 * 自组织驱动（纯函数）：给定当前 open 需求与 worker 花名册，决定本轮「谁去自荐哪个需求」。
 *
 * 这是「worker 自治」替代「派单」的核心：没有中心 dispatcher，能干且在线的 worker
 * 主动认领自己擅长的事，模拟社会中人对机会的自发响应。
 *
 * 候选条件（在 canVolunteer 之上再加自治约束）：
 *   - 需求状态为 open；
 *   - worker 在线（离线者不主动行动）；
 *   - 该 worker 尚未自荐过此需求（避免重复）；
 *   - canVolunteer（广场开放 + 未超载 + 非自发 + 有能力）。
 *
 * 分配：把所有「(需求, worker) 候选对」按适配度降序贪心匹配，受双向配额约束——
 * 每个 worker 每轮最多认领 maxNeedsPerWorker 个（默认 1，专注），
 * 每个需求最多收 maxVolunteersPerNeed 个自荐者（含已存在的，默认 3）。
 *
 * 纯函数：不读时钟、不落盘、不改入参。
 */
export function autonomousVolunteers(
  openNeeds: readonly PublishedNeed[],
  workers: readonly WorkerProfile[],
  relationships: readonly Relationship[] = [],
  opts: AutonomyOptions = {}
): AutonomousVolunteerDecision[] {
  const maxPerNeed = opts.maxVolunteersPerNeed ?? DEFAULT_MAX_VOLUNTEERS_PER_NEED;
  const maxPerWorker = opts.maxNeedsPerWorker ?? DEFAULT_MAX_NEEDS_PER_WORKER;
  // 入参声明为 readonly（纯函数契约：不改入参）；这里取一份可变引用供下游 computeFitScore 复用。
  const rels = [...relationships];

  // 收集所有候选对，并按适配度降序排（稳定排序，同分保持输入顺序）。
  const pairs: AutonomousVolunteerDecision[] = [];
  for (const need of openNeeds) {
    if (need.status !== 'open') continue;
    const already = new Set(need.volunteers.map((v) => v.workerId));
    for (const w of workers) {
      if (w.status === 'offline') continue;
      if (already.has(w.workerId)) continue;
      if (!canVolunteer(need, w)) continue;
      pairs.push({
        needId: need.needId,
        workerId: w.workerId,
        fitScore: computeFitScore(need, w, rels).score,
      });
    }
  }
  pairs.sort((a, b) => b.fitScore - a.fitScore);

  // 贪心分配，受双向配额约束。needCount 以「已存在的自荐者数」为起点，
  // 这样 per-need 上限会把历史自荐者一并计入。
  const needCount = new Map<string, number>(openNeeds.map((n) => [n.needId, n.volunteers.length]));
  const workerCount = new Map<string, number>();
  const decisions: AutonomousVolunteerDecision[] = [];
  for (const p of pairs) {
    const wUsed = workerCount.get(p.workerId) ?? 0;
    const nUsed = needCount.get(p.needId) ?? 0;
    if (wUsed >= maxPerWorker) continue;
    if (nUsed >= maxPerNeed) continue;
    decisions.push(p);
    workerCount.set(p.workerId, wUsed + 1);
    needCount.set(p.needId, nUsed + 1);
  }
  return decisions;
}

/**
 * 按能力查询 worker 花名册，按声誉降序、负载升序排序。
 * onlineOnly 默认 true；返回前 limit 条（默认全部）。
 */
export function discoverWorkers(
  workers: readonly WorkerProfile[],
  query: WorkerDiscoveryQuery = {}
): WorkerProfile[] {
  const onlineOnly = query.onlineOnly ?? true;
  const required = (query.anyCapability ?? []).map((s) => s.toLowerCase());
  const requireSet = new Set(required);

  const filtered = workers.filter((w) => {
    if (onlineOnly && w.status === 'offline') return false;
    if (requireSet.size === 0) return true;
    const skills = new Set(w.capabilities.map((c) => c.skill.toLowerCase()));
    for (const r of requireSet) {
      if (skills.has(r)) return true;
    }
    return false;
  });

  filtered.sort((a, b) => {
    if (b.reputation !== a.reputation) return b.reputation - a.reputation;
    if (a.activeTaskCount !== b.activeTaskCount) return a.activeTaskCount - b.activeTaskCount;
    return a.workerId.localeCompare(b.workerId);
  });

  const limit = query.limit;
  return typeof limit === 'number' && limit > 0 ? filtered.slice(0, limit) : filtered;
}

// ── 自荐（守卫式，不可变） ─────────────────────────────────────────

export interface VolunteerOutcome {
  ok: boolean;
  need: PublishedNeed;
  volunteer?: Volunteer;
  reason?: string;
}

/**
 * worker 对 Need 自荐。返回带守卫结果的（不可变）新 Need。
 * 失败原因：not_open / at_capacity / self_assign / no_capability / already_volunteered。
 */
export function volunteerFor(
  need: PublishedNeed,
  worker: WorkerProfile,
  now: string,
  relationships: Relationship[] = [],
  weights: FitWeights = DEFAULT_FIT_WEIGHTS
): VolunteerOutcome {
  if (need.status !== 'open') {
    return { ok: false, need, reason: 'not_open' };
  }
  if (need.postedBy === worker.workerId) {
    return { ok: false, need, reason: 'self_assign' };
  }
  if (isAtCapacity(worker)) {
    return { ok: false, need, reason: 'at_capacity' };
  }
  if (need.volunteers.some((v) => v.workerId === worker.workerId)) {
    return { ok: false, need, reason: 'already_volunteered' };
  }
  if (capabilityMatchScore(need.requiredCapabilities, worker) <= 0) {
    return { ok: false, need, reason: 'no_capability' };
  }
  const fit = computeFitScore(need, worker, relationships, weights);
  const volunteer: Volunteer = {
    workerId: worker.workerId,
    needId: need.needId,
    fitScore: fit.score,
    volunteeredAt: now,
  };
  return {
    ok: true,
    need: { ...need, volunteers: [...need.volunteers, volunteer] },
    volunteer,
  };
}

// ── Need 状态机（不可变转换） ──────────────────────────────────────

export interface NeedTransition {
  ok: boolean;
  need: PublishedNeed;
  reason?: string;
}

/** 合法的正向转换表。 */
const ALLOWED_TRANSITIONS: Record<NeedStatusKey, NeedStatusKey[]> = {
  open: ['assigned', 'expired', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['delivered'],
  delivered: ['closed', 'in_progress'],
  closed: [],
  expired: [],
  cancelled: [],
};
type NeedStatusKey = PublishedNeed['status'];

/**
 * 对 Need 做状态转换。非法转换返回 ok:false 且 Need 不变。
 * `assignee` 仅在 assigned 时写入；`result` 仅在 delivered 时写入。
 */
export function transitionNeed(
  need: PublishedNeed,
  next: PublishedNeed['status'],
  now: string,
  patch: { assignee?: string; result?: string } = {}
): NeedTransition {
  const allowed = ALLOWED_TRANSITIONS[need.status] ?? [];
  if (!allowed.includes(next)) {
    return { ok: false, need, reason: `illegal:${need.status}->${next}` };
  }
  const updated: PublishedNeed = { ...need, status: next };
  if (next === 'assigned') {
    if (!patch.assignee) return { ok: false, need, reason: 'missing_assignee' };
    updated.assignee = patch.assignee;
    updated.assignedAt = now;
  }
  if (next === 'in_progress') {
    updated.startedAt = now;
  }
  if (next === 'delivered') {
    updated.result = patch.result ?? updated.result;
    updated.deliveredAt = now;
    updated.revisionCount = need.revisionCount; // 退回重做不增加；显式 revision 才增加
  }
  if (next === 'closed') {
    updated.closedAt = now;
  }
  return { ok: true, need: updated };
}

/** 审核退回：delivered → in_progress，并递增 revisionCount；超 REVISION_LIMIT 触发 escalate。 */
export function requestRevision(need: PublishedNeed, now: string): NeedTransition {
  if (need.status !== 'delivered') {
    return { ok: false, need, reason: `illegal:${need.status}->revision` };
  }
  const revisionCount = need.revisionCount + 1;
  return {
    ok: true,
    need: {
      ...need,
      status: 'in_progress',
      startedAt: now,
      revisionCount,
    },
    reason: revisionCount > REVISION_LIMIT ? 'revision_limit_exceeded' : undefined,
  };
}

// ── 关系 / 声誉 ─────────────────────────────────────────────────────

/**
 * 记录一次协作结果，返回更新后的关系集合（不可变）。
 * - 新关系：collaborations=1, successes = success?1:0, trust=success?1:0。
 * - 已有关系：累加，trust 重算 = successes/collaborations。
 * 关系是有向的：a→b 与 b→a 各自独立记录。
 */
export function recordCollaboration(
  relationships: readonly Relationship[],
  fromWorker: string,
  toWorker: string,
  success: boolean,
  now: string
): Relationship[] {
  const idx = relationships.findIndex(
    (r) => r.fromWorker === fromWorker && r.toWorker === toWorker
  );
  if (idx < 0) {
    const rel: Relationship = {
      fromWorker,
      toWorker,
      collaborations: 1,
      successes: success ? 1 : 0,
      trust: success ? 1 : 0,
      lastInteractedAt: now,
    };
    return [...relationships, rel];
  }
  const prev = relationships[idx];
  const collaborations = prev.collaborations + 1;
  const successes = prev.successes + (success ? 1 : 0);
  const next: Relationship = {
    ...prev,
    collaborations,
    successes,
    trust: collaborations > 0 ? successes / collaborations : 0,
    lastInteractedAt: now,
  };
  return relationships.map((r, i) => (i === idx ? next : r));
}

/** 把声誉值夹取到领域不变量 [REPUTATION_MIN, REPUTATION_MAX]。 */
export function clampReputation(value: number): number {
  return clamp(value, REPUTATION_MIN, REPUTATION_MAX);
}

/** 声誉增量，夹取到 [0,100]。 */
export function applyReputationDelta(profile: WorkerProfile, delta: number): WorkerProfile {
  return {
    ...profile,
    reputation: clampReputation(profile.reputation + delta),
  };
}

/** 协作成功/失败对应的声誉增量（成功 +2，失败 -5，可调）。 */
export function reputationDeltaForOutcome(success: boolean): number {
  return success ? 2 : -5;
}

/**
 * 仍在交互生命周期内（未终结）的需求状态。
 * 画布据此展示 worker 跑向/停在任务：覆盖 open→assigned→in_progress→delivered，
 * 仅排除已终结（closed/expired/cancelled）——这样 worker 选派后不会丢下任务飘走。
 */
export const ACTIVE_NEED_STATUSES: PublishedNeed['status'][] = [
  'open',
  'assigned',
  'in_progress',
  'delivered',
];

// ── helpers ────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
