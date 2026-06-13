/**
 * Worker Society — 前端纯可视化逻辑。
 *
 * 把社会属性映射为图形属性，供 SocietyView 渲染「不同 worker 在不同任务下的交互」：
 *   worker 节点大小 = 声誉；节点颜色 = 声誉档；关系边粗细 = 协作次数；边透明度 = 信任度；
 *   需求卡片颜色 = 生命周期状态。
 * 纯函数，无 React/DOM/network 副作用，便于单测与复用。
 */
import type { NeedStatus, PublishedNeed, WorkerProfile } from '../core/domain/models/society';

/** 需求生命周期状态的中文标签（弹卡/状态徽章共用，单一来源）。 */
export const NEED_STATUS_LABEL: Record<NeedStatus, string> = {
  open: '招募中',
  assigned: '已选派',
  in_progress: '执行中',
  delivered: '待审核',
  closed: '已完结',
  expired: '已过期',
  cancelled: '已取消',
};

/** 声誉 0..100 → 节点半径 12..36（越大越显眼）。 */
export function workerNodeRadius(reputation: number): number {
  const clamped = Math.max(0, Math.min(100, reputation));
  return 12 + (clamped / 100) * 24;
}

/** 声誉档位颜色：高=绿、中=琥珀、低=红。 */
export function reputationColor(reputation: number): string {
  if (reputation >= 70) return '#16a34a';
  if (reputation >= 40) return '#d97706';
  return '#dc2626';
}

/** 协作次数 → 关系边线宽 [1,8]px。 */
export function edgeWidth(collaborations: number): number {
  return Math.max(1, Math.min(8, collaborations));
}

/** 信任度 0..1 → 边透明度 0.2..1（弱关系也可见但更淡）。 */
export function trustOpacity(trust: number): number {
  const clamped = Math.max(0, Math.min(1, trust));
  return 0.2 + clamped * 0.8;
}

/** 需求生命周期状态 → 区分色。 */
export function needStatusColor(status: PublishedNeed['status']): string {
  switch (status) {
    case 'open':
      return '#2563eb';
    case 'assigned':
      return '#7c3aed';
    case 'in_progress':
      return '#d97706';
    case 'delivered':
      return '#0891b2';
    case 'closed':
      return '#16a34a';
    case 'expired':
      return '#9ca3af';
    case 'cancelled':
      return '#dc2626';
    default:
      return '#9ca3af';
  }
}

/** 按声誉降序取前 N 名 worker（排行榜）。 */
export function topWorkersByReputation(workers: WorkerProfile[], n: number): WorkerProfile[] {
  return [...workers].sort((a, b) => b.reputation - a.reputation).slice(0, n);
}

/** 在线/忙碌、或虽离线但有进行中任务的 worker（社会活跃成员）。 */
export function activeWorkers(workers: WorkerProfile[]): WorkerProfile[] {
  return workers.filter((w) => w.status !== 'offline' || w.activeTaskCount > 0);
}

/** 需求生命周期阶段排序权重：招募中在前，越接近完结越靠后。 */
const LIFECYCLE_RANK: Record<PublishedNeed['status'], number> = {
  open: 0,
  assigned: 1,
  in_progress: 2,
  delivered: 3,
  closed: 4,
  expired: 5,
  cancelled: 6,
};

/**
 * 生命周期排序比较器：招募中(open) → 已选派 → 执行中 → 待审核 → 终结；
 * 同阶段按优先级降序（更紧急的在前）。供看板展示完整在途任务流——避免任务一被选派
 * 就从列表「消失」（open→assigned 即离开 openOnly 列表的 UX bug）。
 */
export function byLifecycleOrder(a: PublishedNeed, b: PublishedNeed): number {
  const dr = LIFECYCLE_RANK[a.status] - LIFECYCLE_RANK[b.status];
  if (dr !== 0) return dr;
  return b.priority - a.priority;
}

/** 把需求按生命周期顺序排好（返回新数组，不改入参）。 */
export function sortNeedsByLifecycle(needs: readonly PublishedNeed[]): PublishedNeed[] {
  return [...needs].sort(byLifecycleOrder);
}

/**
 * 把一个 id 稳定映射到 url 列表中的某一项（确定性哈希：同 id 永远同一项）。
 * 空列表返回 undefined。供 SocietyGraph 给每个 worker 稳定分配头像（复用 hermit
 * 自带的 participant-avatars 目录）。
 */
export function pickAvatarUrl(seed: string, urls: readonly string[]): string | undefined {
  if (urls.length === 0) return undefined;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return urls[h % urls.length];
}
