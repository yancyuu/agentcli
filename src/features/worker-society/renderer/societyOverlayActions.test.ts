/**
 * societyOverlayActions 测试 —— 纯图谱交互模型的核心规则（TDD 先行）。
 *
 * 删掉看板后，节点点开弹出的小卡片是唯一的交互入口。该模块决定：
 *   1. 一个 need 处于某状态时，卡片上该出现哪些生命周期动作按钮；
 *   2. 弹卡定位如何不被屏幕边缘裁切。
 * 这两条规则是「纯图谱」UX 的全部决策点，必须测全。
 */
import { describe, expect, it } from 'vitest';

import { needLifecycleActions, type NeedOverlayAction } from './societyOverlayActions';

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
