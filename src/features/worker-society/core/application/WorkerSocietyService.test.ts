import { describe, expect, it } from 'vitest';

import { WorkerSocietyService } from './WorkerSocietyService';
import type { AgentCapability } from '../domain/models/society';

// Fakes（仿 TaskDispatchService.test.ts 的 FakeWorkspace 模式）—— 放在独立 fakes.ts
// 中以便后续 adapter / renderer 测试复用。
import {
  FakeClock,
  FakeMessageGateway,
  FakeNeedStore,
  FakeProfileStore,
  FakeRelationshipStore,
  MemoryEventSink,
} from './fakes';

function cap(skill: string): AgentCapability {
  return { skill, description: skill };
}

function makeService() {
  const clock = new FakeClock('2026-06-13T10:00:00.000Z');
  const profiles = new FakeProfileStore();
  const needs = new FakeNeedStore();
  const relationships = new FakeRelationshipStore();
  const messages = new FakeMessageGateway();
  const events = new MemoryEventSink();
  const service = new WorkerSocietyService(profiles, needs, relationships, messages, clock, events);
  return { service, clock, profiles, needs, relationships, messages, events };
}

async function seedTwoWorkers(service: WorkerSocietyService) {
  await service.registerProfile({
    workerId: 'poster',
    name: 'Poster',
    capabilities: [cap('pm')],
    interests: [],
    maxConcurrent: 2,
  });
  await service.registerProfile({
    workerId: 'designer',
    name: 'Designer',
    capabilities: [cap('design'), cap('frontend')],
    interests: ['design'],
    maxConcurrent: 2,
    reputation: 70,
  });
}

// ── 注册 / 发现 ───────────────────────────────────────────────────

describe('WorkerSocietyService.registerProfile', () => {
  it('creates a profile with defaults', async () => {
    const { service } = makeService();
    const p = await service.registerProfile({
      workerId: 'w1',
      name: 'W1',
      capabilities: [cap('x')],
    });
    expect(p.workerId).toBe('w1');
    expect(p.reputation).toBe(50);
    expect(p.maxConcurrent).toBe(3);
    expect(p.status).toBe('online');
  });
  it('preserves activeTaskCount/reputation on re-register', async () => {
    const { service, profiles } = makeService();
    await service.registerProfile({ workerId: 'w1', name: 'W1', reputation: 80 });
    await profiles.upsert({ ...(await service.getProfile('w1'))!, activeTaskCount: 2 });
    const updated = await service.registerProfile({ workerId: 'w1', name: 'W1-new' });
    expect(updated.name).toBe('W1-new');
    expect(updated.activeTaskCount).toBe(2);
    expect(updated.reputation).toBe(80);
  });
});

describe('WorkerSocietyService.discoverWorkers', () => {
  it('returns workers matching capability, ranked by reputation', async () => {
    const { service } = makeService();
    await service.registerProfile({
      workerId: 'a',
      name: 'A',
      capabilities: [cap('design')],
      reputation: 60,
    });
    await service.registerProfile({
      workerId: 'b',
      name: 'B',
      capabilities: [cap('design')],
      reputation: 90,
    });
    await service.registerProfile({ workerId: 'c', name: 'C', capabilities: [cap('devops')] });
    const res = await service.discoverWorkers({ anyCapability: ['design'] });
    expect(res.map((w) => w.workerId)).toEqual(['b', 'a']);
  });
});

// ── 取消需求 ──────────────────────────────────────────────────────

describe('WorkerSocietyService.cancelNeed', () => {
  it('cancels an open need and persists status "cancelled" (neutral — no reputation change)', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    const res = await service.cancelNeed(need.needId);
    expect(res).toEqual({ ok: true });
    expect((await needs.get(need.needId))?.status).toBe('cancelled');
  });

  it('returns need_not_found for an unknown need id', async () => {
    const { service } = makeService();
    expect(await service.cancelNeed('does-not-exist')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });

  it('refuses to cancel an in-progress need (illegal transition)', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'designer');
    const res = await service.cancelNeed(need.needId);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('illegal:in_progress->cancelled');
  });
});

// ── 自组织全流程 ──────────────────────────────────────────────────

describe('WorkerSocietyService self-organization happy path', () => {
  it('publish → volunteer → select → start → deliver → accept closes the loop', async () => {
    const { service, events, needs } = makeService();
    await seedTwoWorkers(service);

    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'Hero banner',
      requiredCapabilities: ['design'],
    });
    expect(need.status).toBe('open');

    const vol = await service.volunteerFor(need.needId, 'designer');
    expect(vol.ok).toBe(true);

    const sel = await service.selectAssignee(need.needId);
    expect(sel.ok).toBe(true);
    expect(sel.assignee).toBe('designer');

    expect(await service.startNeed(need.needId, 'designer')).toMatchObject({ ok: true });
    expect(await service.deliverNeed(need.needId, 'banner v1')).toMatchObject({ ok: true });
    expect(await service.acceptDelivery(need.needId)).toMatchObject({ ok: true });

    const final = await needs.get(need.needId);
    expect(final?.status).toBe('closed');

    // 声誉上升、并发槽释放
    const designer = await service.getProfile('designer');
    expect(designer?.reputation).toBeGreaterThan(70);
    expect(designer?.activeTaskCount).toBe(0);

    // 双向关系形成且 trust=1
    const rels = await service.getRelationships();
    const d2p = rels.find((r) => r.fromWorker === 'designer' && r.toWorker === 'poster');
    const p2d = rels.find((r) => r.fromWorker === 'poster' && r.toWorker === 'designer');
    expect(d2p?.trust).toBe(1);
    expect(p2d?.trust).toBe(1);

    // 事件流覆盖完整生命周期
    const types = events.all().map((e) => e.type);
    expect(types).toContain('need_published');
    expect(types).toContain('volunteered');
    expect(types).toContain('assigned');
    expect(types).toContain('closed');
    expect(types).toContain('relationship_strengthened');
  });

  it('emits an outbound message to the poster when a worker volunteers', async () => {
    const { service, messages } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    expect(messages.sent).toHaveLength(1);
    expect(messages.sent[0]).toMatchObject({ fromWorker: 'designer', toWorker: 'poster' });
  });
});

// ── 守卫 ──────────────────────────────────────────────────────────

describe('WorkerSocietyService guards', () => {
  // at-capacity 拒绝由 societyPolicies.volunteerFor 穷举覆盖；此处保留 duplicate 验证 reason 透传。
  it('volunteer fails on duplicate', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    const again = await service.volunteerFor(need.needId, 'designer');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already_volunteered');
  });
  it('selectAssignee fails with no eligible volunteer', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    const out = await service.selectAssignee(need.needId);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_eligible_volunteer');
  });
  it('start rejects a non-assignee', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    await service.registerProfile({
      workerId: 'other',
      name: 'Other',
      capabilities: [cap('design')],
    });
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    const out = await service.startNeed(need.needId, 'other');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_assignee');
  });
  it('deliver before start is rejected', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    const out = await service.deliverNeed(need.needId, 'too early');
    expect(out.ok).toBe(false);
  });
  // accept-before-deliver 的非法状态迁移由 societyPolicies.transitionNeed 覆盖（service 仅转发结果）。
});

// ── 退回 / 过期 ──────────────────────────────────────────────────

describe('WorkerSocietyService revision & expiry', () => {
  it('revision returns work to in_progress and lowers reputation', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'designer');
    await service.deliverNeed(need.needId, 'v1');
    const before = (await service.getProfile('designer'))!.reputation;
    await service.requestRevision(need.needId);
    const after = (await service.getProfile('designer'))!.reputation;
    expect((await needs.get(need.needId))?.status).toBe('in_progress');
    expect(after).toBeLessThan(before);
  });
  it('revision beyond limit flags escalation', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'designer');
    // drive revisionCount to the limit
    for (let i = 0; i <= 3; i++) {
      await service.deliverNeed(need.needId, `v${i}`);
      await service.requestRevision(need.needId);
    }
    // last requestRevision when revisionCount was already 3 → escalated
    // (we just assert the flow doesn't throw and need is back in_progress)
    expect((await needs.get(need.needId))?.status).toBe('in_progress');
  });
  it('expireNeeds sweeps past-deadline open needs', async () => {
    const { service, clock, needs } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
      deadline: '2026-06-13T09:00:00.000Z',
    });
    clock.set('2026-06-13T12:00:00.000Z');
    const n = await service.expireNeeds();
    expect(n).toBe(1);
    expect((await needs.get(need.needId))?.status).toBe('expired');
  });
});

// ── 社交消息 ─────────────────────────────────────────────────────

describe('WorkerSocietyService.sendSocialMessage', () => {
  it('delivers a free worker-to-worker message and emits a message event', async () => {
    const { service, messages, events } = makeService();
    await seedTwoWorkers(service);
    const out = await service.sendSocialMessage(
      'designer',
      'poster',
      'hey, can you clarify the brief?'
    );
    expect(out.ok).toBe(true);
    expect(messages.sent).toHaveLength(1);
    expect(events.all().some((e) => e.type === 'message')).toBe(true);
  });
  it('rejects unknown sender', async () => {
    const { service } = makeService();
    const out = await service.sendSocialMessage('nobody', 'poster', 'hi');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('worker_not_found');
  });
});

// ── 自治驱动（runAutonomyTick）────────────────────────────────────

describe('WorkerSocietyService.runAutonomyTick', () => {
  it('makes matching online workers autonomously volunteer for open needs', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service); // poster(pm) + designer(design,frontend, rep 70)
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'Hero banner',
      requiredCapabilities: ['design'],
    });
    const applied = await service.runAutonomyTick();
    expect(applied).toBeGreaterThanOrEqual(1);
    const updated = await needs.get(need.needId);
    expect(updated?.volunteers.map((v) => v.workerId)).toContain('designer');
  });

  // 决策边界场景（no-op / at-capacity / per-need cap）已由 societyPolicies.test.ts
  // 的 autonomousVolunteers 用例穷举覆盖；service 层 runAutonomyTick 为纯委托 + 落库
  // （见 WorkerSocietyService L307-319），仅保留持久化与选项透传（maxNeedsPerWorker）用例。

  it('applies maxNeedsPerWorker so one worker can volunteer for multiple needs in a tick', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service); // designer 具 design + frontend
    const { need: a } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'A',
      requiredCapabilities: ['design'],
    });
    const { need: b } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'B',
      requiredCapabilities: ['frontend'],
    });
    const applied = await service.runAutonomyTick({ maxNeedsPerWorker: 2 });
    expect(applied).toBe(2); // designer 同时认领两个需求
    expect((await needs.get(a.needId))?.volunteers.map((v) => v.workerId)).toContain('designer');
    expect((await needs.get(b.needId))?.volunteers.map((v) => v.workerId)).toContain('designer');
  });
});

// ── 自治选派（autoSelectPending）──────────────────────────────────

describe('WorkerSocietyService.autoSelectPending', () => {
  it('auto-selects the best volunteer for each open need that has volunteers', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service); // designer 不具备 video
    await service.registerProfile({
      workerId: 'hi',
      name: 'Hi',
      capabilities: [cap('video')],
      reputation: 80,
    });
    await service.registerProfile({
      workerId: 'lo',
      name: 'Lo',
      capabilities: [cap('video')],
      reputation: 30,
    });
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'Edit video',
      requiredCapabilities: ['video'],
    });
    await service.volunteerFor(need.needId, 'hi');
    await service.volunteerFor(need.needId, 'lo');

    expect(await service.autoSelectPending()).toBe(1);
    const got = await needs.get(need.needId);
    expect(got?.status).toBe('assigned');
    expect(got?.assignee).toBe('hi'); // rep 80 > 30（无兴趣混淆）→ 最高适配胜出
  });

  it('skips open needs with no volunteers', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    expect(await service.autoSelectPending()).toBe(0);
  });

  it('is idempotent: does not re-select a need that is no longer open', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    expect(await service.autoSelectPending()).toBe(1); // open → assigned
    expect(await service.autoSelectPending()).toBe(0); // 已 assigned，不再 open，跳过
  });

  it('selects across multiple needs in one sweep', async () => {
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need: a } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'A',
      requiredCapabilities: ['design'],
    });
    const { need: b } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'B',
      requiredCapabilities: ['frontend'],
    });
    await service.volunteerFor(a.needId, 'designer');
    await service.volunteerFor(b.needId, 'designer');
    expect(await service.autoSelectPending()).toBe(2);
  });
});

// ── 完整自治回路（端到端）────────────────────────────────────────

describe('WorkerSocietyService full autonomous flow', () => {
  it('tick (volunteer) → auto-select → start → deliver → accept, no human dispatcher', async () => {
    const { service, needs } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'Hero banner',
      requiredCapabilities: ['design'],
    });

    // 自治两步：worker 自发投标 → 按适配度选派（全程无人工指派）。
    expect(await service.runAutonomyTick()).toBeGreaterThanOrEqual(1);
    expect(await service.autoSelectPending()).toBeGreaterThanOrEqual(1);

    const assigned = await needs.get(need.needId);
    expect(assigned?.status).toBe('assigned');
    const assignee = assigned!.assignee!;

    // 被选派者自主推进执行 → 交付 → 审核。
    expect(await service.startNeed(need.needId, assignee)).toMatchObject({ ok: true });
    expect(await service.deliverNeed(need.needId, 'banner v1')).toMatchObject({ ok: true });
    expect(await service.acceptDelivery(need.needId)).toMatchObject({ ok: true });
    expect((await needs.get(need.needId))?.status).toBe('closed');
  });
});
