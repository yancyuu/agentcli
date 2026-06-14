/**
 * societyViewUtils 测试 —— 前端纯可视化逻辑。
 *
 * 图谱引擎不暴露节点尺寸/边宽/透明度字段，故历史上的 workerNodeRadius/edgeWidth/
 * trustOpacity 与看板用的 topWorkersByReputation/activeWorkers/sortNeedsByLifecycle
 * 在「纯图谱」改造后无消费者，已随实现一并删除（见 docs §15 迭代 #6）。本文件只覆盖
 * 当前仍被消费的纯映射：状态标签、声誉档色、状态区分色、头像稳定分配。
 * 纯函数，无 React/DOM 依赖，易测。
 */
import { describe, expect, it } from 'vitest';

import type { PublishedNeed } from '../core/domain/models/society';
import {
  NEED_STATUS_LABEL,
  needStatusColor,
  pickAvatarUrl,
  reputationColor,
} from './societyViewUtils';

describe('NEED_STATUS_LABEL', () => {
  it('provides a non-empty Chinese label for every need status', () => {
    const statuses: PublishedNeed['status'][] = [
      'open',
      'assigned',
      'in_progress',
      'delivered',
      'closed',
      'expired',
      'cancelled',
    ];
    for (const s of statuses) {
      expect(typeof NEED_STATUS_LABEL[s]).toBe('string');
      expect(NEED_STATUS_LABEL[s].length).toBeGreaterThan(0);
    }
  });
});

describe('reputationColor', () => {
  it('is green for high, amber for mid, red for low', () => {
    expect(reputationColor(80)).toBe('#16a34a');
    expect(reputationColor(50)).toBe('#d97706');
    expect(reputationColor(20)).toBe('#dc2626');
  });
});

describe('needStatusColor', () => {
  it('assigns a distinct color per status', () => {
    const statuses: PublishedNeed['status'][] = [
      'open',
      'assigned',
      'in_progress',
      'delivered',
      'closed',
      'expired',
      'cancelled',
    ];
    const colors = statuses.map(needStatusColor);
    expect(new Set(colors).size).toBe(statuses.length); // all distinct
  });
});

describe('pickAvatarUrl (stable sprite assignment)', () => {
  const urls = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
  it('is deterministic — same id always maps to the same url', () => {
    expect(pickAvatarUrl('frontend', urls)).toBe(pickAvatarUrl('frontend', urls));
  });
  it('always returns an in-range url for any id', () => {
    for (const id of ['a', 'b', 'c', 'x', 'y', 'z', 'long-id-123']) {
      expect(urls).toContain(pickAvatarUrl(id, urls));
    }
  });
  it('returns undefined for an empty url set', () => {
    expect(pickAvatarUrl('anyone', [])).toBeUndefined();
  });
  it('distributes distinct ids across the set (not all collapsed to one)', () => {
    const picks = new Set(
      ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'].map((id) => pickAvatarUrl(id, urls))
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});
