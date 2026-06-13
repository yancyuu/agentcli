/**
 * societyOverlayActions —— 纯图谱交互模型的决策核心（纯函数）。
 *
 * 删掉看板后，点开 worker/need 节点弹出的卡片是唯一的交互入口。本模块封装两条
 * 与渲染无关、可单测的决策：
 *
 *   1. needLifecycleActions —— 某 need 处于某状态时，卡片上出现哪些动作按钮。
 *      自荐改由「触发自治」自动完成（反派单），所以 open 状态不再有「自荐」手选，
 *      只有「选派最优（若有自荐者）」与「触发自治」。
 *   2. clampOverlayPosition —— 弹卡定位不被屏幕边缘裁切（右侧溢出翻左，上下夹紧）。
 */
import type { NeedStatus } from '../core/domain/models/society';

/** 节点弹卡上可出现的 need 生命周期动作（与 store 的命令一一对应）。 */
export type NeedOverlayAction =
  | 'selectAssignee' // open + 有自荐者 → 选派最优
  | 'triggerAutonomy' // open → 让 worker 自荐/选派（反派单）
  | 'startNeed' // assigned → 开始执行
  | 'deliverNeed' // in_progress → 标记交付
  | 'acceptDelivery'; // delivered → 通过审核

/**
 * 按 need 状态返回卡片应展示的生命周期动作（顺序即按钮顺序）。
 *
 * - open：有自荐者→「选派最优」+「触发自治」；无自荐者→仅「触发自治」。
 * - assigned/in_progress/delivered：各一个推进动作，与是否有自荐者无关。
 * - closed/expired/cancelled：图谱不渲染这些节点，但返回空数组做安全兜底。
 */
export function needLifecycleActions(
  status: NeedStatus,
  hasVolunteers: boolean
): NeedOverlayAction[] {
  switch (status) {
    case 'open':
      return hasVolunteers ? ['selectAssignee', 'triggerAutonomy'] : ['triggerAutonomy'];
    case 'assigned':
      return ['startNeed'];
    case 'in_progress':
      return ['deliverNeed'];
    case 'delivered':
      return ['acceptDelivery'];
    case 'closed':
    case 'expired':
    case 'cancelled':
      return [];
    default:
      return [];
  }
}

/**
 * 把弹卡放在节点右侧、垂直居中；右侧放不下翻到左侧；上下越界夹进视口。
 * 返回相对于 fixed 包裹层的 absolute {left,top}（px）。
 */
export function clampOverlayPosition(
  pos: { x: number; y: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  gap = 12
): { left: number; top: number } {
  const margin = 8;
  // 默认右侧。
  let left = pos.x + gap;
  const topCentered = pos.y - size.height / 2;
  // 右侧溢出 → 翻左。
  if (left + size.width > viewport.width - margin) {
    left = pos.x - gap - size.width;
  }
  // 左侧仍越界（节点太靠左）→ 贴左边距。
  if (left < margin) left = margin;

  // 上下夹进视口。
  let top = topCentered;
  if (top < margin) top = margin;
  if (top + size.height > viewport.height - margin) {
    top = viewport.height - size.height - margin;
  }
  return { left, top };
}
