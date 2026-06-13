import { describe, expect, it } from 'vitest';

import {
  applyReputationDelta,
  autonomousVolunteers,
  canVolunteer,
  capabilityMatchScore,
  computeFitScore,
  DEFAULT_FIT_WEIGHTS,
  DEFAULT_REPUTATION,
  discoverWorkers,
  interestOverlap,
  isAtCapacity,
  recordCollaboration,
  requestRevision,
  reputationDeltaForOutcome,
  selectAssignee,
  transitionNeed,
  volunteerFor,
} from './societyPolicies';
import type {
  AgentCapability,
  PublishedNeed,
  Relationship,
  WorkerProfile,
} from '../models/society';

const NOW = '2026-06-13T10:00:00.000Z';
const LATER = '2026-06-13T11:00:00.000Z';

function cap(skill: string): AgentCapability {
  return { skill, description: `${skill} capability` };
}

function profile(overrides: Partial<WorkerProfile> = {}): WorkerProfile {
  return {
    workerId: 'w-a',
    name: 'Worker A',
    kind: 'composite',
    capabilities: [cap('design')],
    interests: [],
    maxConcurrent: 3,
    activeTaskCount: 0,
    reputation: DEFAULT_REPUTATION,
    status: 'online',
    ...overrides,
  };
}

function openNeed(overrides: Partial<PublishedNeed> = {}): PublishedNeed {
  return {
    needId: 'need-1',
    postedBy: 'user',
    subject: 'Design a hero banner',
    requiredCapabilities: ['design'],
    priority: 5,
    status: 'open',
    volunteers: [],
    createdAt: NOW,
    revisionCount: 0,
    ...overrides,
  };
}

// ── 能力 / 兴趣 ─────────────────────────────────────────────────────

describe('capabilityMatchScore', () => {
  it('returns 1 when no capabilities are required', () => {
    expect(capabilityMatchScore([], profile())).toBe(1);
  });
  it('returns 1 when worker has all required skills', () => {
    const w = profile({ capabilities: [cap('design'), cap('frontend')] });
    expect(capabilityMatchScore(['design', 'frontend'], w)).toBe(1);
  });
  it('returns fractional coverage for partial match', () => {
    const w = profile({ capabilities: [cap('design')] });
    expect(capabilityMatchScore(['design', 'frontend', 'backend'], w)).toBeCloseTo(1 / 3);
  });
  it('returns 0 when worker has none of the required skills', () => {
    const w = profile({ capabilities: [cap('devops')] });
    expect(capabilityMatchScore(['design'], w)).toBe(0);
  });
  it('is case-insensitive', () => {
    const w = profile({ capabilities: [cap('Design')] });
    expect(capabilityMatchScore(['DESIGN'], w)).toBe(1);
  });
});

describe('interestOverlap', () => {
  it('returns 0 when nothing required', () => {
    expect(interestOverlap([], ['design'])).toBe(0);
  });
  it('returns fraction of required skills the worker is interested in', () => {
    expect(interestOverlap(['design', 'frontend'], ['design'])).toBe(0.5);
  });
});

// ── 容量 / 自荐门槛 ────────────────────────────────────────────────

describe('isAtCapacity', () => {
  it('false when below max', () => {
    expect(isAtCapacity(profile({ maxConcurrent: 3, activeTaskCount: 2 }))).toBe(false);
  });
  it('true at max', () => {
    expect(isAtCapacity(profile({ maxConcurrent: 3, activeTaskCount: 3 }))).toBe(true);
  });
  it('true above max', () => {
    expect(isAtCapacity(profile({ maxConcurrent: 1, activeTaskCount: 5 }))).toBe(true);
  });
});

describe('canVolunteer', () => {
  it('true for open need, capable, idle worker', () => {
    expect(canVolunteer(openNeed(), profile())).toBe(true);
  });
  it('false when need is not open', () => {
    expect(canVolunteer(openNeed({ status: 'assigned' }), profile())).toBe(false);
  });
  it('false when worker is at capacity', () => {
    expect(canVolunteer(openNeed(), profile({ activeTaskCount: 3, maxConcurrent: 3 }))).toBe(false);
  });
  it('false when worker is the poster (no self-assign)', () => {
    expect(canVolunteer(openNeed({ postedBy: 'w-a' }), profile())).toBe(false);
  });
  it('false when worker lacks all required capabilities', () => {
    expect(canVolunteer(openNeed({ requiredCapabilities: ['backend'] }), profile())).toBe(false);
  });
});

// ── 适配度 ──────────────────────────────────────────────────────────

describe('computeFitScore', () => {
  it('weights sum to 1', () => {
    const sum = Object.values(DEFAULT_FIT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
  it('idle capable worker scores higher than loaded one', () => {
    const idle = profile({ activeTaskCount: 0 });
    const loaded = profile({ workerId: 'w-b', activeTaskCount: 3 });
    const need = openNeed();
    expect(computeFitScore(need, idle).score).toBeGreaterThan(computeFitScore(need, loaded).score);
  });
  it('higher reputation yields higher score', () => {
    const lo = profile({ reputation: 10 });
    const hi = profile({ workerId: 'w-hi', reputation: 95 });
    const need = openNeed();
    expect(computeFitScore(need, hi).score).toBeGreaterThan(computeFitScore(need, lo).score);
  });
  it('relationship bonus increases score toward the poster', () => {
    const rels: Relationship[] = [
      {
        fromWorker: 'w-a',
        toWorker: 'user',
        collaborations: 4,
        successes: 4,
        trust: 1,
        lastInteractedAt: NOW,
      },
    ];
    const withRel = computeFitScore(openNeed({ postedBy: 'user' }), profile(), rels);
    const noRel = computeFitScore(openNeed({ postedBy: 'user' }), profile(), []);
    expect(withRel.score).toBeGreaterThan(noRel.score);
    expect(withRel.relationshipBonus).toBe(1);
  });
  it('interest overlap adds to the score', () => {
    const bored = profile();
    const keen = profile({ workerId: 'w-keen', interests: ['design'] });
    const need = openNeed();
    expect(computeFitScore(need, keen).score).toBeGreaterThan(computeFitScore(need, bored).score);
  });
  it('breakdown factors are in [0,1] and score in [0,1]', () => {
    const b = computeFitScore(openNeed(), profile());
    for (const f of [
      b.capability,
      b.loadFairness,
      b.reputation,
      b.relationshipBonus,
      b.interest,
      b.score,
    ]) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

// ── 选择执行者 ─────────────────────────────────────────────────────

describe('selectAssignee', () => {
  function workers(...list: WorkerProfile[]): Map<string, WorkerProfile> {
    return new Map(list.map((w) => [w.workerId, w]));
  }

  it('returns null when no volunteers', () => {
    expect(selectAssignee(openNeed(), workers(profile()))).toBeNull();
  });
  it('returns null when the only volunteer is at capacity', () => {
    const w = profile({ activeTaskCount: 3, maxConcurrent: 3 });
    const need = openNeed({
      volunteers: [{ workerId: 'w-a', needId: 'need-1', fitScore: 0.9, volunteeredAt: NOW }],
    });
    expect(selectAssignee(need, workers(w))).toBeNull();
  });
  it('picks the volunteer with the highest fit score', () => {
    const lo = profile({ workerId: 'w-lo', reputation: 10 });
    const hi = profile({ workerId: 'w-hi', reputation: 95 });
    const need = openNeed({
      volunteers: [
        { workerId: 'w-lo', needId: 'need-1', fitScore: 0.3, volunteeredAt: NOW },
        { workerId: 'w-hi', needId: 'need-1', fitScore: 0.8, volunteeredAt: NOW },
      ],
    });
    expect(selectAssignee(need, workers(lo, hi))?.workerId).toBe('w-hi');
  });
  it('ties break by reputation, then by lower load, then by workerId', () => {
    const a = profile({ workerId: 'w-a', reputation: 80, activeTaskCount: 1 });
    const b = profile({ workerId: 'w-b', reputation: 80, activeTaskCount: 0 });
    const need = openNeed({
      volunteers: [
        { workerId: 'w-a', needId: 'need-1', fitScore: 0.5, volunteeredAt: NOW },
        { workerId: 'w-b', needId: 'need-1', fitScore: 0.5, volunteeredAt: NOW },
      ],
    });
    // equal fit & reputation → lower load wins (w-b)
    expect(selectAssignee(need, workers(a, b))?.workerId).toBe('w-b');
  });
});

// ── 发现 ────────────────────────────────────────────────────────────

describe('discoverWorkers', () => {
  const designer = profile({ workerId: 'designer', capabilities: [cap('design')], reputation: 70 });
  const dev = profile({
    workerId: 'dev',
    capabilities: [cap('backend')],
    reputation: 90,
    status: 'online',
  });
  const offline = profile({
    workerId: 'ghost',
    capabilities: [cap('design')],
    reputation: 99,
    status: 'offline',
  });

  it('filters by capability (OR semantics)', () => {
    const res = discoverWorkers([designer, dev], { anyCapability: ['design'] });
    expect(res.map((w) => w.workerId)).toEqual(['designer']);
  });
  it('excludes offline workers by default', () => {
    const res = discoverWorkers([designer, offline], { anyCapability: ['design'] });
    expect(res.map((w) => w.workerId)).toEqual(['designer']);
  });
  it('includes offline when onlineOnly=false', () => {
    const res = discoverWorkers([designer, offline], {
      anyCapability: ['design'],
      onlineOnly: false,
    });
    expect(res.map((w) => w.workerId)).toContain('ghost');
  });
  it('ranks by reputation desc then load asc', () => {
    const busyHi = profile({
      workerId: 'busy',
      capabilities: [cap('design')],
      reputation: 80,
      activeTaskCount: 3,
    });
    const idleMid = profile({
      workerId: 'idle',
      capabilities: [cap('design')],
      reputation: 80,
      activeTaskCount: 0,
    });
    const res = discoverWorkers([busyHi, idleMid], { anyCapability: ['design'] });
    expect(res.map((w) => w.workerId)).toEqual(['idle', 'busy']);
  });
  it('respects limit', () => {
    const res = discoverWorkers([designer, dev], { limit: 1 });
    expect(res).toHaveLength(1);
  });
  it('empty capability query returns all online workers', () => {
    const res = discoverWorkers([designer, dev, offline]);
    expect(res.map((w) => w.workerId).sort()).toEqual(['designer', 'dev']);
  });
});

// ── 自荐守卫 ───────────────────────────────────────────────────────

describe('volunteerFor', () => {
  it('appends a volunteer with a snapshot fitScore', () => {
    const out = volunteerFor(openNeed(), profile(), NOW);
    expect(out.ok).toBe(true);
    expect(out.volunteer?.workerId).toBe('w-a');
    expect(out.volunteer?.fitScore).toBeGreaterThan(0);
    expect(out.need.volunteers).toHaveLength(1);
    expect(out.need.volunteers[0].volunteeredAt).toBe(NOW);
  });
  it('does not mutate the original need', () => {
    const need = openNeed();
    volunteerFor(need, profile(), NOW);
    expect(need.volunteers).toHaveLength(0);
  });
  it('rejects self-assign', () => {
    const out = volunteerFor(openNeed({ postedBy: 'w-a' }), profile(), NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('self_assign');
  });
  it('rejects at-capacity worker', () => {
    const out = volunteerFor(openNeed(), profile({ activeTaskCount: 3, maxConcurrent: 3 }), NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('at_capacity');
  });
  it('rejects duplicate volunteer', () => {
    const need = openNeed({
      volunteers: [{ workerId: 'w-a', needId: 'need-1', fitScore: 0.5, volunteeredAt: NOW }],
    });
    const out = volunteerFor(need, profile(), NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('already_volunteered');
  });
  it('rejects when worker has no matching capability', () => {
    const out = volunteerFor(openNeed({ requiredCapabilities: ['backend'] }), profile(), NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_capability');
  });
  it('rejects when need is not open', () => {
    const out = volunteerFor(openNeed({ status: 'assigned' }), profile(), NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_open');
  });
});

// ── Need 状态机 ────────────────────────────────────────────────────

describe('transitionNeed', () => {
  it('open -> assigned sets assignee and assignedAt', () => {
    const out = transitionNeed(openNeed(), 'assigned', NOW, { assignee: 'w-a' });
    expect(out.ok).toBe(true);
    expect(out.need.assignee).toBe('w-a');
    expect(out.need.assignedAt).toBe(NOW);
  });
  it('assigned requires an assignee', () => {
    const out = transitionNeed(openNeed(), 'assigned', NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('missing_assignee');
  });
  it('assigned -> in_progress sets startedAt', () => {
    const started = transitionNeed(
      openNeed({ status: 'assigned', assignee: 'w-a' }),
      'in_progress',
      NOW
    );
    expect(started.ok).toBe(true);
    expect(started.need.startedAt).toBe(NOW);
  });
  it('in_progress -> delivered captures result and deliveredAt', () => {
    const ip = openNeed({ status: 'in_progress', assignee: 'w-a' });
    const out = transitionNeed(ip, 'delivered', LATER, { result: 'banner v1' });
    expect(out.ok).toBe(true);
    expect(out.need.result).toBe('banner v1');
    expect(out.need.deliveredAt).toBe(LATER);
  });
  it('delivered -> closed sets closedAt', () => {
    const del = openNeed({ status: 'delivered', result: 'done' });
    const out = transitionNeed(del, 'closed', LATER);
    expect(out.ok).toBe(true);
    expect(out.need.closedAt).toBe(LATER);
    expect(out.need.status).toBe('closed');
  });
  it('rejects illegal transitions and leaves need unchanged', () => {
    const need = openNeed({ status: 'delivered' });
    const out = transitionNeed(need, 'assigned', NOW);
    expect(out.ok).toBe(false);
    expect(out.need).toBe(need);
    expect(out.reason).toContain('illegal');
  });
  it('rejects open -> delivered (must go through assigned/in_progress)', () => {
    expect(transitionNeed(openNeed(), 'delivered', NOW).ok).toBe(false);
  });
});

describe('requestRevision', () => {
  it('moves delivered -> in_progress and bumps revisionCount', () => {
    const out = requestRevision(openNeed({ status: 'delivered' }), NOW);
    expect(out.ok).toBe(true);
    expect(out.need.status).toBe('in_progress');
    expect(out.need.revisionCount).toBe(1);
  });
  it('flags when revision limit exceeded', () => {
    const out = requestRevision(openNeed({ status: 'delivered', revisionCount: 3 }), NOW);
    expect(out.ok).toBe(true);
    expect(out.reason).toBe('revision_limit_exceeded');
  });
  it('rejects revision from non-delivered state', () => {
    expect(requestRevision(openNeed({ status: 'open' }), NOW).ok).toBe(false);
  });
});

// ── 关系 ────────────────────────────────────────────────────────────

describe('recordCollaboration', () => {
  it('creates a new directed relationship on first collaboration', () => {
    const rels = recordCollaboration([], 'w-a', 'w-b', true, NOW);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({
      fromWorker: 'w-a',
      toWorker: 'w-b',
      collaborations: 1,
      successes: 1,
      trust: 1,
    });
  });
  it('accumulates and recomputes trust', () => {
    let rels = recordCollaboration([], 'w-a', 'w-b', true, NOW);
    rels = recordCollaboration(rels, 'w-a', 'w-b', false, LATER);
    expect(rels[0].collaborations).toBe(2);
    expect(rels[0].successes).toBe(1);
    expect(rels[0].trust).toBe(0.5);
  });
  it('does not mutate original array', () => {
    const orig = recordCollaboration([], 'w-a', 'w-b', true, NOW);
    const next = recordCollaboration(orig, 'w-a', 'w-b', true, LATER);
    expect(orig[0].collaborations).toBe(1);
    expect(next[0].collaborations).toBe(2);
  });
  it('keeps a->b and b->a independent (directional)', () => {
    let rels = recordCollaboration([], 'w-a', 'w-b', true, NOW);
    rels = recordCollaboration(rels, 'w-b', 'w-a', false, NOW);
    expect(rels).toHaveLength(2);
  });
});

// ── 声誉 ────────────────────────────────────────────────────────────

describe('reputation', () => {
  it('applyReputationDelta clamps to [0,100]', () => {
    expect(applyReputationDelta(profile({ reputation: 99 }), 10).reputation).toBe(100);
    expect(applyReputationDelta(profile({ reputation: 1 }), -10).reputation).toBe(0);
    expect(applyReputationDelta(profile({ reputation: 50 }), 5).reputation).toBe(55);
  });
  it('does not mutate the input profile', () => {
    const w = profile({ reputation: 50 });
    applyReputationDelta(w, 10);
    expect(w.reputation).toBe(50);
  });
  it('success yields positive delta, failure negative', () => {
    expect(reputationDeltaForOutcome(true)).toBeGreaterThan(0);
    expect(reputationDeltaForOutcome(false)).toBeLessThan(0);
  });
});

// ── 自组织驱动（自治大脑）──────────────────────────────────────────

describe('autonomousVolunteers (self-organization driver)', () => {
  it('a matching online worker with capacity self-volunteers for an open need', () => {
    const w = profile({ workerId: 'dev', capabilities: [cap('code')] });
    const need = openNeed({ needId: 'n1', requiredCapabilities: ['code'] });
    const out = autonomousVolunteers([need], [w]);
    expect(out).toEqual([{ needId: 'n1', workerId: 'dev', fitScore: expect.any(Number) }]);
  });

  it('skips workers at capacity, lacking capability, offline, or already volunteered', () => {
    const busy = profile({
      workerId: 'busy',
      capabilities: [cap('code')],
      activeTaskCount: 3,
      maxConcurrent: 3,
    });
    const unskilled = profile({ workerId: 'unskilled', capabilities: [cap('design')] });
    const ghost = profile({ workerId: 'ghost', capabilities: [cap('code')], status: 'offline' });
    const already = profile({ workerId: 'already', capabilities: [cap('code')] });
    const need = openNeed({
      needId: 'n1',
      requiredCapabilities: ['code'],
      volunteers: [{ workerId: 'already', needId: 'n1', fitScore: 0.5, volunteeredAt: NOW }],
    });
    expect(autonomousVolunteers([need], [busy, unskilled, ghost, already])).toEqual([]);
  });

  it('a worker volunteers for at most one need per tick, choosing the higher-fit need', () => {
    // 该 worker 同时匹配两个需求，但 full（能力全覆盖）fit 高于 partial。
    const w = profile({ workerId: 'dev', capabilities: [cap('code'), cap('design')] });
    const fullMatch = openNeed({ needId: 'full', requiredCapabilities: ['code'] });
    const partialMatch = openNeed({
      needId: 'partial',
      requiredCapabilities: ['code', 'design', 'frontend'],
    });
    const out = autonomousVolunteers([partialMatch, fullMatch], [w]);
    expect(out).toHaveLength(1);
    expect(out[0].needId).toBe('full');
    expect(out[0].workerId).toBe('dev');
  });

  it('respects the max-volunteers-per-need cap and fills with the highest-fit workers', () => {
    const a = profile({ workerId: 'a', capabilities: [cap('code')], reputation: 60 });
    const b = profile({ workerId: 'b', capabilities: [cap('code')], reputation: 50 });
    const c = profile({ workerId: 'c', capabilities: [cap('code')], reputation: 40 });
    const need = openNeed({ needId: 'n1', requiredCapabilities: ['code'] });
    const out = autonomousVolunteers([need], [c, b, a], [], { maxVolunteersPerNeed: 2 });
    const chosen = out
      .filter((d) => d.needId === 'n1')
      .map((d) => d.workerId)
      .sort();
    expect(chosen).toEqual(['a', 'b']); // fit 由 reputation 决定 → 取最高的两个
  });

  it('respects pre-existing volunteers against the per-need cap', () => {
    const a = profile({ workerId: 'a', capabilities: [cap('code')], reputation: 60 });
    const need = openNeed({
      needId: 'n1',
      requiredCapabilities: ['code'],
      volunteers: [
        { workerId: 'x', needId: 'n1', fitScore: 0.5, volunteeredAt: NOW },
        { workerId: 'y', needId: 'n1', fitScore: 0.4, volunteeredAt: NOW },
      ],
    });
    // 已有 2 个自荐者，cap=2 → 不再新增。
    expect(autonomousVolunteers([need], [a], [], { maxVolunteersPerNeed: 2 })).toEqual([]);
    // cap=3 → 还能加 1 个。
    const out = autonomousVolunteers([need], [a], [], { maxVolunteersPerNeed: 3 });
    expect(out).toEqual([{ needId: 'n1', workerId: 'a', fitScore: expect.any(Number) }]);
  });

  it('ignores needs that are not open', () => {
    const w = profile({ workerId: 'dev', capabilities: [cap('code')] });
    const assigned = openNeed({ needId: 'n1', requiredCapabilities: ['code'], status: 'assigned' });
    expect(autonomousVolunteers([assigned], [w])).toEqual([]);
  });

  it('does not let a worker volunteer for a need they themselves posted', () => {
    const w = profile({ workerId: 'self', capabilities: [cap('code')] });
    const own = openNeed({ needId: 'n1', postedBy: 'self', requiredCapabilities: ['code'] });
    expect(autonomousVolunteers([own], [w])).toEqual([]);
  });

  it('lets a worker volunteer for multiple needs when maxNeedsPerWorker > 1', () => {
    const w = profile({ workerId: 'dev', capabilities: [cap('code')] });
    const a = openNeed({ needId: 'na', requiredCapabilities: ['code'] });
    const b = openNeed({ needId: 'nb', requiredCapabilities: ['code'] });
    const out = autonomousVolunteers([a, b], [w], [], { maxNeedsPerWorker: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.needId).sort()).toEqual(['na', 'nb']);
    expect(out.every((d) => d.workerId === 'dev')).toBe(true);
  });

  it('returns [] for empty inputs', () => {
    expect(autonomousVolunteers([], [])).toEqual([]);
    expect(autonomousVolunteers([openNeed()], [])).toEqual([]);
  });

  it('prefers a worker with a prior trust relationship to the poster (social feedback loop)', () => {
    // 两个能力/声誉完全相同的 worker，只有 friend 与 poster 有信任关系。
    const stranger = profile({ workerId: 'stranger', capabilities: [cap('code')], reputation: 50 });
    const friend = profile({ workerId: 'friend', capabilities: [cap('code')], reputation: 50 });
    const need = openNeed({ needId: 'n1', postedBy: 'poster', requiredCapabilities: ['code'] });
    const rels: Relationship[] = [
      {
        fromWorker: 'friend',
        toWorker: 'poster',
        collaborations: 2,
        successes: 2,
        trust: 1,
        lastInteractedAt: NOW,
      },
    ];
    // per-need cap=1 → 仅最高适配者入选；friend 因关系加分胜出。
    const out = autonomousVolunteers([need], [stranger, friend], rels, { maxVolunteersPerNeed: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].workerId).toBe('friend');
  });

  it('is deterministic and pure: does not mutate its inputs', () => {
    const w = profile({ workerId: 'dev', capabilities: [cap('code')] });
    const need = openNeed({ needId: 'n1', requiredCapabilities: ['code'] });
    const needsSnap = JSON.parse(JSON.stringify([need]));
    const workersSnap = JSON.parse(JSON.stringify([w]));
    autonomousVolunteers([need], [w]);
    expect([need]).toEqual(needsSnap);
    expect([w]).toEqual(workersSnap);
  });
});
