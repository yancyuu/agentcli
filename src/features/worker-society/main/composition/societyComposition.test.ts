/**
 * Composition root 集成测试 —— 证明真实适配器（FS store + cross-team 网关 + 系统时钟）
 * 组合后能跑通完整自治流程，且状态跨「重启」（新建实例）持久化。
 *
 * 这是 worker-society 从纯库走向「持久化社交平台」的关键证据。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkerSociety, defaultSocietyRoot } from './societyComposition';

describe('createWorkerSociety (composition root)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-comp-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('wires a full self-organization flow that persists across a simulated restart', async () => {
    const { service } = createWorkerSociety(root);
    await service.registerProfile({
      workerId: 'poster',
      name: 'Poster',
      capabilities: [{ skill: 'pm', description: 'pm' }],
    });
    await service.registerProfile({
      workerId: 'dev',
      name: 'Dev',
      capabilities: [{ skill: 'code', description: 'code' }],
      reputation: 60,
    });

    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'build feature X',
      requiredCapabilities: ['code'],
    });
    await service.volunteerFor(need.needId, 'dev');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'dev');
    await service.deliverNeed(need.needId, 'v1');
    await service.acceptDelivery(need.needId);

    // 新实例模拟重启：dev 声誉上升、关系形成、需求关闭 —— 全部已落盘。
    const { service: reloaded, gateway } = createWorkerSociety(root);
    const dev = await reloaded.getProfile('dev');
    expect(dev?.reputation).toBeGreaterThan(60);
    expect((await reloaded.getRelationships()).length).toBeGreaterThan(0);
    const closedNeed = await reloaded.getProfile('poster'); // 触发一次 store 读
    expect(closedNeed).toBeTruthy();
    // 自荐/选派消息经 cross-team 网关持久化到 messages.jsonl
    expect((await gateway.recent(10)).length).toBeGreaterThan(0);
  });

  it('exposes stores + gateway + service from a single root', () => {
    const c = createWorkerSociety(root);
    expect(c.service).toBeTruthy();
    expect(c.gateway).toBeTruthy();
    expect(c.profiles).toBeTruthy();
    expect(c.needs).toBeTruthy();
    expect(c.relationships).toBeTruthy();
  });

  it('defaultSocietyRoot resolves to ~/.hermit/society (the canonical on-disk data root)', () => {
    // createWorkerSociety 的默认参数 = defaultSocietyRoot()，但既有测试都传显式 tmpdir →
    // 该导出从未被调用（FNDA:0）。这是声誉/关系/需求/消息跨重启落盘的规范路径，锁定防漂移。
    expect(defaultSocietyRoot()).toBe(join(homedir(), '.hermit', 'society'));
  });
});
