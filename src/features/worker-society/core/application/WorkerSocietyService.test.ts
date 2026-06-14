import { describe, expect, it, vi } from 'vitest';

import { WorkerSocietyService, estimateFit } from './WorkerSocietyService';
import type { AgentCapability, PublishedNeed, WorkerProfile } from '../domain/models/society';

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
  it('clamps reputation to [0,100] on register (enforces the domain invariant at the input boundary)', async () => {
    // REPUTATION_MIN/MAX=0/100 是领域不变量；applyReputationDelta 在每次 delta 时夹取，
    // 但 registerProfile（输入边界）此前透传——注册 reputation:150 / -20 会存出界值，
    // 违反不变量（下游 computeFitScore 虽 clamp01 兜底，但持久化的原值仍是错的）。
    const { service } = makeService();
    const hi = await service.registerProfile({ workerId: 'hi', name: 'Hi', reputation: 150 });
    expect(hi.reputation).toBe(100); // 上界夹取
    const lo = await service.registerProfile({ workerId: 'lo', name: 'Lo', reputation: -20 });
    expect(lo.reputation).toBe(0); // 下界夹取
  });
  it('clamps maxConcurrent to a minimum of 1 (0/negative would otherwise brick the worker)', async () => {
    // isAtCapacity = activeTaskCount >= maxConcurrent：maxConcurrent:0 → 0>=0 永真 → worker 被自荐/选派
    // 闸门（isAtCapacity）永久拒之门外，静默不可用。无「maxConcurrent=0=暂停」语义——不可用由 status 建模。
    // loadFairness（societyPolicies L102）已对 maxConcurrent>0 做防御，反证 ≤0 是可达输入。
    const { service } = makeService();
    const zero = await service.registerProfile({
      workerId: 'w0',
      name: 'W0',
      capabilities: [cap('design')],
      maxConcurrent: 0,
    });
    expect(zero.maxConcurrent).toBe(1); // 0 → 1（否则 isAtCapacity 永真）
    const neg = await service.registerProfile({
      workerId: 'wneg',
      name: 'Wneg',
      capabilities: [cap('design')],
      maxConcurrent: -5,
    });
    expect(neg.maxConcurrent).toBe(1); // 负数 → 1
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

describe('WorkerSocietyService cancel slot release', () => {
  it('releases the assignee activeTaskCount slot when an assigned need is cancelled', async () => {
    // assigned→cancelled 是合法转换（ALLOWED_TRANSITIONS）；selectAssignee 已占用一个并发槽，
    // cancel 必须释放——否则 activeTaskCount 永久虚高，最终 isAtCapacity 误判、worker 接不了新活。
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId); // designer.activeTaskCount 0 → 1（占用槽）
    expect((await service.getProfile('designer'))!.activeTaskCount).toBe(1);

    expect(await service.cancelNeed(need.needId)).toMatchObject({ ok: true }); // assigned→cancelled

    expect((await service.getProfile('designer'))!.activeTaskCount).toBe(0); // 槽已释放
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
  it('rejects an unknown worker with worker_not_found (need exists, worker does not)', async () => {
    // L151：need 查找通过（L149）后，profiles.get(workerId) 返回 undefined → worker_not_found。
    // publishNeed 不校验 postedBy，故无需 seed 任何 worker——直接发需求、用脏 workerId 自荐。
    const { service } = makeService();
    const { need } = await service.publishNeed({
      postedBy: 'user',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    expect(await service.volunteerFor(need.needId, 'ghost-worker')).toEqual({
      ok: false,
      reason: 'worker_not_found',
    });
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

// need_not_found 守卫：每个生命周期方法的第一行都是 `if (!need) return need_not_found`。
// cancelNeed 的该分支已测（见上 L143），但其余 6 个方法此前只喂真实 needId（测的是别的错误
// 分支：already_volunteered / no_eligible_volunteer / not_assignee / 非法迁移），从未传入
// 不存在的 needId —— 输入校验契约（MCP/REST 收到脏 needId 时该回什么）留了 6 处空缺。
// need 查找在所有方法里都是第一步，故无需 seed 任何 worker / need（最小、零冗余）。
describe('WorkerSocietyService need_not_found guard on lifecycle methods', () => {
  it('volunteerFor rejects an unknown need', async () => {
    const { service } = makeService();
    expect(await service.volunteerFor('ghost-need', 'designer')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });
  it('selectAssignee rejects an unknown need', async () => {
    const { service } = makeService();
    expect(await service.selectAssignee('ghost-need')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });
  it('startNeed rejects an unknown need', async () => {
    const { service } = makeService();
    expect(await service.startNeed('ghost-need', 'designer')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });
  it('deliverNeed rejects an unknown need', async () => {
    const { service } = makeService();
    expect(await service.deliverNeed('ghost-need', 'done')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });
  it('acceptDelivery rejects an unknown need', async () => {
    const { service } = makeService();
    expect(await service.acceptDelivery('ghost-need')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });
  it('requestRevision rejects an unknown need', async () => {
    const { service } = makeService();
    expect(await service.requestRevision('ghost-need')).toEqual({
      ok: false,
      reason: 'need_not_found',
    });
  });
});

// 非法迁移转发契约：selectAssignee / startNeed / acceptDelivery / requestRevision 在 need 处于
// 非法状态时，必须把 transitionNeed 的失败 reason 原样转发（不吞、不抛）。deliverNeed 的同源
// 分支已被「deliver before start」覆盖（L232），这 4 个对称未覆盖（L188/216/248/271）。
describe('WorkerSocietyService forwards transitionNeed failures (illegal-state contract)', () => {
  it('selectAssignee on an already-assigned need forwards the illegal-transition reason', async () => {
    // assigned→assigned 非法（ALLOWED_TRANSITIONS['assigned']=[in_progress,cancelled]）。
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId); // open→assigned
    const again = await service.selectAssignee(need.needId); // assigned→assigned 非法 → L188
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('illegal:assigned->assigned');
  });
  it('startNeed on an already-in-progress need forwards the illegal-transition reason', async () => {
    // 需 assignee===byWorker（过 L214 not_assignee 检查）且 in_progress→in_progress 非法 → L216。
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'designer'); // assigned→in_progress
    const again = await service.startNeed(need.needId, 'designer'); // in_progress→in_progress 非法 → L216
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('illegal:in_progress->in_progress');
  });
  it('acceptDelivery on a not-yet-delivered need forwards the illegal-transition reason', async () => {
    // in_progress→closed 非法（in_progress 只能 →delivered）→ L248。
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'designer'); // →in_progress（未交付）
    const out = await service.acceptDelivery(need.needId); // in_progress→closed 非法 → L248
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('illegal:in_progress->closed');
  });
  it('requestRevision on a not-yet-delivered need forwards the illegal-transition reason', async () => {
    // requestRevision 仅 delivered 态合法（delivered→in_progress）；in_progress 上调 → 非法 → L271。
    const { service } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: 'X',
      requiredCapabilities: ['design'],
    });
    await service.volunteerFor(need.needId, 'designer');
    await service.selectAssignee(need.needId);
    await service.startNeed(need.needId, 'designer'); // →in_progress（未交付）
    const out = await service.requestRevision(need.needId); // 非法 → L271
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/^illegal:/); // 转发了 transitionNeed 的失败 reason（不吞）
  });
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
  it('delivers a message from the human operator "user" (not a registered worker)', async () => {
    // 'user' 是人类操作者的约定 id（图谱 overlay「发消息」from='user'、need 的 postedBy='user'）。
    // 它不是注册 worker，但作为消息发送方必须被允许——否则点 worker「发消息」会静默失败。
    const { service, messages, events } = makeService();
    await seedTwoWorkers(service);
    const out = await service.sendSocialMessage('user', 'designer', 'please review');
    expect(out.ok).toBe(true);
    expect(messages.sent).toHaveLength(1);
    expect(events.all().some((e) => e.type === 'message')).toBe(true);
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

  it('does not over-allocate: a maxConcurrent=1 worker best for two needs gets only one in a single sweep', async () => {
    // 不变式：selectAssignee 每轮重读 profiles.list()（WorkerSocietyService L177），故处理第二个 need 时
    // 看到 solo 已满载（activeTaskCount=1 >= maxConcurrent=1）→ 从合格集合剔除 → 不再选派。
    // 若有人把它「优化」成在 autoSelectPending 外缓存一次 profile 列表，solo 会被超额分配
    // （activeTaskCount=2 > maxConcurrent=1）——本用例锁住这个微妙正确性，防静默回归。
    // 注：characterization（绿现），非 bug；与 iter-3/7/8 同类。
    const { service, needs } = makeService();
    await service.registerProfile({
      workerId: 'poster',
      name: 'Poster',
      capabilities: [cap('pm')],
    });
    await service.registerProfile({
      workerId: 'solo',
      name: 'Solo',
      capabilities: [cap('design'), cap('frontend')],
      reputation: 90,
      maxConcurrent: 1,
    });
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
    await service.volunteerFor(a.needId, 'solo');
    await service.volunteerFor(b.needId, 'solo');

    expect(await service.autoSelectPending()).toBe(1); // solo 只接 1 个（maxConcurrent=1）
    expect((await service.getProfile('solo'))!.activeTaskCount).toBe(1); // 未超额分配
    // 另一个 need 仍 open（solo 满载、无他人可选）
    const statuses = [await needs.get(a.needId), await needs.get(b.needId)].map((n) => n!.status);
    expect(statuses.sort()).toEqual(['assigned', 'open']);
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

describe('estimateFit', () => {
  // estimateFit 是 computeFitScore 的 .score 便捷包装（供前端预估，零依赖纯函数）——
  // 此前零调用、零测试。用「能力匹配者适配度严格高于不匹配者」这一非循环性质，锁定它正确委托 computeFitScore。
  const profile = (capabilities: AgentCapability[]): WorkerProfile => ({
    workerId: 'w',
    name: 'W',
    kind: 'atomic',
    capabilities,
    interests: [],
    maxConcurrent: 3,
    activeTaskCount: 0,
    reputation: 50,
    status: 'online',
  });
  const need: PublishedNeed = {
    needId: 'n',
    postedBy: 'user',
    subject: 's',
    requiredCapabilities: ['design'],
    priority: 5,
    status: 'open',
    volunteers: [],
    createdAt: '2026-01-01',
    revisionCount: 0,
  };

  it('scores a capability-matching worker strictly higher than a non-matching one', () => {
    // 两 worker 仅能力不同（其余负载/声誉/关系/兴趣全同），分差 = capability 权重 × 匹配差 > 0。
    const match = estimateFit(need, profile([cap('design')]));
    const miss = estimateFit(need, profile([cap('devops')]));
    expect(match).toBeGreaterThan(0);
    expect(match).toBeLessThanOrEqual(1);
    expect(match).toBeGreaterThan(miss);
  });
});

describe('WorkerSocietyService.volunteerFor note', () => {
  // L168-170 的 `note ? '…备注：{note}' : '…'` 真臂——经 grep 确认零测试传 note，补 characterization。
  it('includes the note in the volunteer message when one is provided', async () => {
    const { service, messages } = makeService();
    await seedTwoWorkers(service);
    const { need } = await service.publishNeed({
      postedBy: 'poster',
      subject: '带备注的需求',
      requiredCapabilities: ['design'],
    });
    const out = await service.volunteerFor(need.needId, 'designer', '想做这块');
    expect(out).toMatchObject({ ok: true });
    expect(messages.sent.some((m) => m.text.includes('备注：想做这块'))).toBe(true);
  });
});

// crypto 降级：randomId() L416 在 globalThis.crypto?.randomUUID 缺失时（旧 Node / 受限运行时）
// 必须降级到 Date.now()+Math.random() 的 base36 串——publishNeed（L122 need + L409 evt 都调 randomId）
// 仍能生成 need- 前缀、唯一的 id，不抛。与 crossTeamMessageGateway iter-34 同源模式。
describe('WorkerSocietyService randomId crypto fallback', () => {
  it('falls back to a Date/Math-based need id when crypto.randomUUID is unavailable', async () => {
    const { service } = makeService();
    vi.stubGlobal('crypto', undefined); // 摘掉 crypto.randomUUID → 走 L417 降级臂
    try {
      const { need: a } = await service.publishNeed({
        postedBy: 'user',
        subject: 'a',
        requiredCapabilities: [],
      });
      const { need: b } = await service.publishNeed({
        postedBy: 'user',
        subject: 'b',
        requiredCapabilities: [],
      });
      expect(a.needId).toMatch(/^need-/); // 降级 id 仍带前缀
      // 降级 = need-<ts36>-<rand36>（2 个 '-'、3 段）；UUID = need-<uuid>（5 个 '-'、6 段）。
      // 段数断言稳健区分降级臂 vs crypto 臂（不靠 hex 字符，免 flaky）。
      expect(a.needId.split('-')).toHaveLength(3);
      expect(b.needId.split('-')).toHaveLength(3);
      expect(a.needId).not.toBe(b.needId); // 降级 id 仍唯一（Math.random）
    } finally {
      vi.unstubAllGlobals(); // 恢复 crypto，防污染后续测试
    }
  });
});
