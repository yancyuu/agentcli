/**
 * Worker Society — 前端纯可视化逻辑。
 *
 * 图谱（@claude-teams/agent-graph）自身负责节点尺寸/边样式/粒子：其 GraphNode/GraphEdge
 * 契约不暴露 size/radius/width/opacity 字段，故「声誉=节点大小、协作=边宽、信任=边透明度」
 * 无法经图谱编码——这些信息改由 SocietyNodeOverlay 弹卡呈现（声誉色/状态徽章）。
 * 旧的 workerNodeRadius/edgeWidth/trustOpacity 及看板用的排行榜/排序映射在「纯图谱」改造后
 * 已无消费者（见 docs §15 迭代 #6），一并删除，杜绝死代码。
 *
 * 本文件只保留当前真正被消费的纯映射：
 *   - NEED_STATUS_LABEL：需求状态中文标签（弹卡/徽章单一来源）；
 *   - reputationColor / needStatusColor：声誉档 / 需求状态 → 区分色（弹卡用）；
 *   - pickAvatarUrl：把 workerId 稳定映射到内置头像列表（图谱用）。
 * 纯函数，无 React/DOM/network 副作用，便于单测与复用。
 */
import type { NeedStatus, PublishedNeed } from '../core/domain/models/society';

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

/** 声誉档位颜色：高=绿、中=琥珀、低=红。 */
export function reputationColor(reputation: number): string {
  if (reputation >= 70) return '#16a34a';
  if (reputation >= 40) return '#d97706';
  return '#dc2626';
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
