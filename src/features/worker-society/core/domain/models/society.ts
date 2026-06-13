/**
 * Worker Society — 领域模型（纯类型，零副作用）
 *
 * Spec 11。把 hermit 的 worker 抽象（Spec 9）从「被派工的劳动力」
 * 提升为「自治的社会成员」：每个 worker 有持久社会档案（能力/兴趣/容量/
 * 声誉/关系），在广场（Agora）自组织协作。
 *
 * 约束：本文件只含纯类型，不引入 FS/网络/Redis/Fastify/React。
 * 所有类型均为向后兼容的新增，不改动现有持久化格式。
 */

import type { AgentCapability } from '@shared/types/team';

export type { AgentCapability };

/** worker 在社会中的在线状态。 */
export type WorkerSocietyStatus = 'online' | 'busy' | 'offline';

/** Worker 的社会档案 —— 身份 + 能力 + 偏好 + 容量 + 声誉。 */
export interface WorkerProfile {
  /** 稳定身份，等于 teamName（composite）或服务自报 id（atomic）。 */
  workerId: string;
  name: string;
  kind: 'composite' | 'atomic';
  /** 运行时载体：'claudecode' | 'codex' | 'gemini' | ... */
  harness?: string;
  /** 能力清单，复用 AgentCapability。 */
  capabilities: AgentCapability[];
  /** 兴趣/偏好：worker *想*做的 skill，驱动自选（不只是能做）。 */
  interests: string[];
  /** 并发容量上限。 */
  maxConcurrent: number;
  /** 当前在进行的任务数（负载）。 */
  activeTaskCount: number;
  /** 声誉 0..100，默认 50。 */
  reputation: number;
  status: WorkerSocietyStatus;
  description?: string;
}

/** 广场上一个已发布的需求（任务帖）。 */
export interface PublishedNeed {
  needId: string;
  /** 发布者：workerId 或 'user'。 */
  postedBy: string;
  subject: string;
  description?: string;
  /** 所需 skill id 列表。 */
  requiredCapabilities: string[];
  /** 优先级 0..10，越高越紧急/回报越高。 */
  priority: number;
  /** ISO 截止时间；过期未分配则 expired。 */
  deadline?: string;
  status: NeedStatus;
  /** 自荐者列表。 */
  volunteers: Volunteer[];
  /** 选中的执行 workerId。 */
  assignee?: string;
  createdAt: string;
  assignedAt?: string;
  /** 执行者开始执行的时间。 */
  startedAt?: string;
  deliveredAt?: string;
  closedAt?: string;
  /** 交付结果摘要。 */
  result?: string;
  /** 修订次数（审核退回后重做计数）。 */
  revisionCount: number;
}

export type NeedStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'delivered'
  | 'closed'
  | 'expired'
  | 'cancelled';

/** 一次自荐（投标）。 */
export interface Volunteer {
  workerId: string;
  needId: string;
  /** 发布时由 computeFitScore 计算并快照。 */
  fitScore: number;
  note?: string;
  volunteeredAt: string;
}

/** worker 间的持久社交关系（有向边）。 */
export interface Relationship {
  fromWorker: string;
  toWorker: string;
  /** 累计协作次数。 */
  collaborations: number;
  /** 其中成功（通过审核）的次数。 */
  successes: number;
  /** 信任度 0..1，派生自 successes/collaborations（零次协作时为 0）。 */
  trust: number;
  lastInteractedAt: string;
}

export type SocialEventType =
  | 'need_published'
  | 'volunteered'
  | 'assigned'
  | 'collaboration_started'
  | 'delivered'
  | 'closed'
  | 'message'
  | 'relationship_strengthened';

/** 社会活动流中的一条事件。 */
export interface SocialEvent {
  eventId: string;
  type: SocialEventType;
  /** 参与的 workerId 列表。 */
  actors: string[];
  needId?: string;
  summary: string;
  timestamp: string;
}

/** 能力查询（用于动态发现 worker）。 */
export interface WorkerDiscoveryQuery {
  /** 至少满足其中任一 skill（OR），空表示不限。 */
  anyCapability?: string[];
  /** 仅返回在线 worker（默认 true）。 */
  onlineOnly?: boolean;
  /** 最多返回条数。 */
  limit?: number;
}
