/**
 * societyOverlayActions 测试 —— 纯图谱交互模型的核心规则（TDD 先行）。
 *
 * 删掉看板后，节点点开弹出的小卡片是唯一的交互入口。该模块决定：
 *   1. 一个 need 处于某状态时，卡片上该出现哪些生命周期动作按钮；
 *   2. 弹卡定位如何不被屏幕边缘裁切。
 * 这两条规则是「纯图谱」UX 的全部决策点，必须测全。
 */
import { describe, expect, it } from 'vitest';

import {
  clampOverlayPosition,
  needLifecycleActions,
  type NeedOverlayAction,
} from './societyOverlayActions';

describe('needLifecycleActions', () => {
  it('open need with volunteers → 选派最优 + 触发自治', () => {
    expect(needLifecycleActions('open', true)).toEqual<NeedOverlayAction[]>([
      'selectAssignee',
      'triggerAutonomy',
    ]);
  });

  it('open need with no volunteers → 仅触发自治（让 worker 自荐，无手选）', () => {
    expect(needLifecycleActions('open', false)).toEqual<NeedOverlayAction[]>(['triggerAutonomy']);
  });

  it('assigned → 开始执行', () => {
    expect(needLifecycleActions('assigned', false)).toEqual<NeedOverlayAction[]>(['startNeed']);
  });

  it('in_progress → 标记交付', () => {
    expect(needLifecycleActions('in_progress', false)).toEqual<NeedOverlayAction[]>([
      'deliverNeed',
    ]);
  });

  it('delivered → 通过审核', () => {
    expect(needLifecycleActions('delivered', false)).toEqual<NeedOverlayAction[]>([
      'acceptDelivery',
    ]);
  });

  it('closed/expired/cancelled → 无动作（不会出现在图谱上，但要安全兜底）', () => {
    expect(needLifecycleActions('closed', false)).toEqual<NeedOverlayAction[]>([]);
    expect(needLifecycleActions('expired', false)).toEqual<NeedOverlayAction[]>([]);
    expect(needLifecycleActions('cancelled', false)).toEqual<NeedOverlayAction[]>([]);
  });

  it('volunteers flag only matters for open needs', () => {
    // assigned/in_progress/delivered 不因是否有自荐者而改变动作。
    expect(needLifecycleActions('assigned', true)).toEqual(needLifecycleActions('assigned', false));
    expect(needLifecycleActions('in_progress', true)).toEqual(
      needLifecycleActions('in_progress', false)
    );
    expect(needLifecycleActions('delivered', true)).toEqual(
      needLifecycleActions('delivered', false)
    );
  });
});

describe('clampOverlayPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 240, height: 160 };
  const gap = 12;

  it('默认落在节点右侧、垂直居中', () => {
    const pos = { x: 300, y: 400 };
    const out = clampOverlayPosition(pos, viewport, size, gap);
    expect(out.left).toBe(312); // x + gap
    expect(out.top).toBe(320); // y - height/2
  });

  it('右侧溢出 → 翻到节点左侧', () => {
    // 节点靠近右边缘：右侧放不下，翻左侧。
    const pos = { x: 850, y: 400 };
    const out = clampOverlayPosition(pos, viewport, size, gap);
    expect(out.left).toBe(850 - gap - size.width); // 598
    expect(out.left + size.width).toBeLessThanOrEqual(pos.x);
  });

  it('顶部越界 → 贴近上边距', () => {
    const pos = { x: 300, y: 20 };
    const out = clampOverlayPosition(pos, viewport, size, gap);
    expect(out.top).toBeGreaterThanOrEqual(8);
  });

  it('底部越界 → 贴近下边距', () => {
    const pos = { x: 300, y: 790 };
    const out = clampOverlayPosition(pos, viewport, size, gap);
    expect(out.top + size.height).toBeLessThanOrEqual(viewport.height - 8);
  });

  it('左侧也不够 → 至少留 8px 边距（不出现负值/越界）', () => {
    // 节点在最左上角，翻左也不够宽，必须 clamp 到 ≥8。
    const pos = { x: 0, y: 0 };
    const out = clampOverlayPosition(pos, viewport, size, gap);
    expect(out.left).toBeGreaterThanOrEqual(8);
    expect(out.top).toBeGreaterThanOrEqual(8);
  });
});
