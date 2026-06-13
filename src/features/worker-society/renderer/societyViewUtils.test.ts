/**
 * societyViewUtils 测试 —— 前端纯可视化逻辑（TDD 先行）。
 *
 * 把"声誉/协作/状态"映射为图形属性（半径/颜色/线宽/透明度），是「不同 worker 在不同
 * 任务下交互」可视化的核心映射；纯函数，无 React/DOM 依赖，易测。
 */
import { describe, expect, it } from 'vitest';

import type { PublishedNeed, Relationship, WorkerProfile } from '../core/domain/models/society';
import {
  activeWorkers,
  edgeWidth,
  needStatusColor,
  pickAvatarUrl,
  reputationColor,
  sortNeedsByLifecycle,
  topWorkersByReputation,
  trustOpacity,
  workerNodeRadius,
} from './societyViewUtils';

describe('workerNodeRadius (size = reputation)', () => {
  it('maps reputation 0→min, 100→max', () => {
    expect(workerNodeRadius(0)).toBe(12);
    expect(workerNodeRadius(100)).toBe(36);
    expect(workerNodeRadius(50)).toBe(24);
  });
  it('clamps out-of-range reputation', () => {
    expect(workerNodeRadius(150)).toBe(36);
    expect(workerNodeRadius(-10)).toBe(12);
  });
});

describe('reputationColor', () => {
  it('is green for high, amber for mid, red for low', () => {
    expect(reputationColor(80)).toBe('#16a34a');
    expect(reputationColor(50)).toBe('#d97706');
    expect(reputationColor(20)).toBe('#dc2626');
  });
});

describe('edgeWidth (collaboration strength)', () => {
  it('scales with collaborations and clamps to [1,8]', () => {
    expect(edgeWidth(0)).toBe(1);
    expect(edgeWidth(4)).toBe(4);
    expect(edgeWidth(100)).toBe(8);
  });
});

describe('trustOpacity', () => {
  it('maps trust 0→0.2 .. 1→1', () => {
    expect(trustOpacity(0)).toBeCloseTo(0.2);
    expect(trustOpacity(1)).toBeCloseTo(1);
    expect(trustOpacity(0.5)).toBeCloseTo(0.6);
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

describe('topWorkersByReputation', () => {
  const w = (id: string, rep: number): WorkerProfile => ({
    workerId: id,
    name: id,
    kind: 'composite',
    capabilities: [],
    interests: [],
    maxConcurrent: 3,
    activeTaskCount: 0,
    reputation: rep,
    status: 'online',
  });
  it('sorts workers by reputation desc and slices top N', () => {
    const res = topWorkersByReputation([w('a', 40), w('b', 90), w('c', 60)], 2);
    expect(res.map((x) => x.workerId)).toEqual(['b', 'c']);
  });
});

describe('activeWorkers', () => {
  const w = (id: string, active: number, status: WorkerProfile['status']): WorkerProfile => ({
    workerId: id,
    name: id,
    kind: 'composite',
    capabilities: [],
    interests: [],
    maxConcurrent: 3,
    activeTaskCount: active,
    reputation: 50,
    status,
  });
  it('keeps workers that are online/busy OR currently have active tasks', () => {
    const res = activeWorkers([
      w('online-idle', 0, 'online'),
      w('busy', 2, 'busy'),
      w('offline', 0, 'offline'),
      w('offline-but-working', 1, 'offline'),
    ]);
    expect(res.map((x) => x.workerId).sort()).toEqual([
      'busy',
      'offline-but-working',
      'online-idle',
    ]);
  });
});

describe('sortNeedsByLifecycle', () => {
  const n = (id: string, status: PublishedNeed['status'], priority = 5): PublishedNeed => ({
    needId: id,
    postedBy: 'user',
    subject: id,
    requiredCapabilities: [],
    priority,
    status,
    volunteers: [],
    createdAt: '',
    revisionCount: 0,
  });
  it('orders by lifecycle stage: open → assigned → in_progress → delivered → closed', () => {
    const sorted = sortNeedsByLifecycle([
      n('c', 'closed'),
      n('d', 'delivered'),
      n('asg', 'assigned'),
      n('ip', 'in_progress'),
      n('o', 'open'),
    ]);
    expect(sorted.map((x) => x.needId)).toEqual(['o', 'asg', 'ip', 'd', 'c']);
  });
  it('within the same stage, higher priority comes first', () => {
    const sorted = sortNeedsByLifecycle([
      n('lo', 'open', 1),
      n('hi', 'open', 9),
      n('mid', 'open', 5),
    ]);
    expect(sorted.map((x) => x.needId)).toEqual(['hi', 'mid', 'lo']);
  });
  it('does not mutate the input array', () => {
    const input = [n('a', 'delivered'), n('b', 'open')];
    const snapshot = input.map((x) => x.needId);
    sortNeedsByLifecycle(input);
    expect(input.map((x) => x.needId)).toEqual(snapshot);
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

describe('Relationship helpers integration', () => {
  it('edgeWidth + trustOpacity compose for a strong vs weak tie', () => {
    const strong: Relationship = {
      fromWorker: 'a',
      toWorker: 'b',
      collaborations: 9,
      successes: 8,
      trust: 0.9,
      lastInteractedAt: '',
    };
    const weak: Relationship = {
      fromWorker: 'a',
      toWorker: 'c',
      collaborations: 1,
      successes: 0,
      trust: 0,
      lastInteractedAt: '',
    };
    expect(edgeWidth(strong.collaborations)).toBeGreaterThan(edgeWidth(weak.collaborations));
    expect(trustOpacity(strong.trust)).toBeGreaterThan(trustOpacity(weak.trust));
  });
});
