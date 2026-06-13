/**
 * societyDemo 测试 —— 一键示例社会播种（TDD 先行）。
 *
 * 验证示例数据的「可演示不变量」：确定性、字段完整、能力可被 worker 覆盖
 * （否则自治选派会落空，演示失败）。纯函数，无 IO。
 */
import { describe, expect, it } from 'vitest';

import { buildDemoSociety } from './societyDemo';

const splitCaps = (s: string | undefined): string[] =>
  (s ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

describe('buildDemoSociety', () => {
  const demo = buildDemoSociety();

  it('returns a non-empty society with ≥3 workers and ≥2 needs', () => {
    expect(demo.workers.length).toBeGreaterThanOrEqual(3);
    expect(demo.needs.length).toBeGreaterThanOrEqual(2);
  });

  it('every worker has a unique workerId, non-empty name, and capabilities', () => {
    const ids = demo.workers.map((w) => w.workerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of demo.workers) {
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(splitCaps(w.capabilities).length).toBeGreaterThan(0);
    }
  });

  it('every need has a unique subject, a poster, and required capabilities', () => {
    const subjects = demo.needs.map((n) => n.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    for (const n of demo.needs) {
      expect(n.postedBy.trim().length).toBeGreaterThan(0);
      expect(splitCaps(n.requiredCapabilities).length).toBeGreaterThan(0);
    }
  });

  it('is satisfiable: every required capability is offered by some worker', () => {
    const workerCaps = new Set(demo.workers.flatMap((w) => splitCaps(w.capabilities)));
    for (const n of demo.needs) {
      for (const cap of splitCaps(n.requiredCapabilities)) {
        expect(
          workerCaps.has(cap),
          `need "${n.subject}" requires uncovered capability "${cap}"`
        ).toBe(true);
      }
    }
  });

  it('at least one worker alone covers each need (so autonomy can select)', () => {
    for (const n of demo.needs) {
      const needCaps = splitCaps(n.requiredCapabilities);
      const someoneCoversAll = demo.workers.some((w) => {
        const caps = new Set(splitCaps(w.capabilities));
        return needCaps.every((c) => caps.has(c));
      });
      expect(someoneCoversAll, `no single worker covers all of need "${n.subject}"`).toBe(true);
    }
  });

  it('is deterministic — identical output across calls', () => {
    expect(buildDemoSociety()).toEqual(buildDemoSociety());
  });
});
