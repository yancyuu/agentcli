/**
 * SocietyGraphAdapter — projection tests (test-first).
 *
 * Verifies the pure mapping from worker-society domain (workers / active needs /
 * relationships) into the reusable @claude-teams/agent-graph port model, so the
 * cyan/space holographic graph can render the decentralized agora.
 *
 * Determinism: no Math.random, no FS/network — same input ⇒ identical output.
 */
import { describe, expect, it } from 'vitest';

import { projectSocietyGraph } from './societyGraphAdapter';

import type { PublishedNeed, Relationship, WorkerProfile } from '../core/domain/models/society';

const TEAM = 'worker-society';

function worker(over: Partial<WorkerProfile> & { workerId: string }): WorkerProfile {
  return {
    name: over.workerId,
    kind: 'atomic',
    capabilities: [],
    interests: [],
    maxConcurrent: 2,
    activeTaskCount: 0,
    reputation: 50,
    status: 'online',
    ...over,
  };
}

function need(over: Partial<PublishedNeed> & { needId: string }): PublishedNeed {
  return {
    postedBy: 'user',
    subject: over.subject ?? `need-${over.needId}`,
    requiredCapabilities: [],
    priority: 5,
    status: 'open',
    volunteers: [],
    revisionCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const rel = (
  fromWorker: string,
  toWorker: string,
  over: Partial<Relationship> = {}
): Relationship => ({
  fromWorker,
  toWorker,
  collaborations: 3,
  successes: 2,
  trust: 0.6,
  lastInteractedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('projectSocietyGraph', () => {
  it('returns an empty, dead port when there is no society at all', () => {
    const out = projectSocietyGraph({ workers: [], needs: [], relationships: [] });
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.particles).toEqual([]);
    expect(out.teamName).toBe(TEAM);
    expect(out.isAlive).toBe(false);
  });

  it('places a synthetic Agora hub at the center and parents every worker to it', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' }), worker({ workerId: 'bob' })],
      needs: [],
      relationships: [],
    });
    const agora = out.nodes.find((n) => n.kind === 'lead');
    expect(agora).toMatchObject({ kind: 'lead', state: 'active' });
    expect(agora?.id).toBe(`agora:${TEAM}`);

    // both workers are member nodes
    const members = out.nodes.filter((n) => n.kind === 'member');
    expect(members.map((m) => m.id).sort()).toEqual(['worker:alice', 'worker:bob']);

    // each worker has a parent-child edge from the agora
    for (const memberId of ['worker:alice', 'worker:bob']) {
      expect(
        out.edges.some(
          (e) => e.source === `agora:${TEAM}` && e.target === memberId && e.type === 'parent-child'
        )
      ).toBe(true);
    }
    expect(out.isAlive).toBe(true);
  });

  it('maps worker activity to node state: idle when free, active when carrying tasks', () => {
    const out = projectSocietyGraph({
      workers: [
        worker({ workerId: 'idle1', activeTaskCount: 0, status: 'online' }),
        worker({ workerId: 'busy1', activeTaskCount: 1, status: 'online' }),
        worker({ workerId: 'busy2', status: 'busy' }),
        worker({ workerId: 'off1', status: 'offline' }),
      ],
      needs: [],
      relationships: [],
    });
    const state = (id: string) => out.nodes.find((n) => n.id === id)?.state;
    expect(state('worker:idle1')).toBe('idle');
    expect(state('worker:busy1')).toBe('active');
    expect(state('worker:busy2')).toBe('active');
    // offline workers stay visible but idle (not terminated/hidden)
    expect(state('worker:off1')).toBe('idle');
  });

  it('turns an assigned, in-progress need into a task orbiting its assignee with a flowing particle', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [need({ needId: 'n1', status: 'in_progress', assignee: 'alice' })],
      relationships: [],
    });
    const task = out.nodes.find((n) => n.id === 'need:n1');
    expect(task).toMatchObject({
      kind: 'task',
      state: 'active',
      ownerId: 'worker:alice',
      taskStatus: 'in_progress',
    });

    // ownership edge assignee -> task
    const ownEdge = out.edges.find(
      (e) => e.source === 'worker:alice' && e.target === 'need:n1' && e.type === 'ownership'
    );
    expect(ownEdge).toBeTruthy();

    // a particle travels that edge (work in flight)
    const particle = out.particles.find((p) => p.edgeId === ownEdge!.id);
    expect(particle).toMatchObject({ kind: 'task_assign', progress: 0 });
    expect(particle?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('anchors an open, unclaimed need to the agora (not orphaned): waiting task, no owner/particle', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [need({ needId: 'n-open', status: 'open' })],
      relationships: [],
    });
    const task = out.nodes.find((n) => n.id === 'need:n-open');
    expect(task).toMatchObject({ kind: 'task', state: 'waiting', ownerId: null });
    // 无指派人 → 锚定到广场（parent-child），不再是孤立浮点；但仍无 ownership 边、无粒子。
    expect(
      out.edges.find(
        (e) =>
          e.source === `agora:${TEAM}` && e.target === 'need:n-open' && e.type === 'parent-child'
      )
    ).toBeTruthy();
    expect(out.edges.some((e) => e.type === 'ownership' && e.target === 'need:n-open')).toBe(false);
    expect(out.particles.some((p) => p.edgeId.includes('need:n-open'))).toBe(false);
  });

  it("joins a visible need's required capabilities into the task sublabel", () => {
    // L166 真臂：`need.requiredCapabilities.length > 0 ? join(' · ') : undefined`。既有可见 need
    // 测试都用 need() 默认 []（假臂→sublabel undefined），真臂（带能力→拼成 sublabel）未覆盖。
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [
        need({ needId: 'n-cap', status: 'open', requiredCapabilities: ['frontend', 'design'] }),
      ],
      relationships: [],
    });
    expect(out.nodes.find((n) => n.id === 'need:n-cap')?.sublabel).toBe('frontend · design');
  });

  it('maps delivered needs to a complete task state with no in-flight particle', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [need({ needId: 'n-done', status: 'delivered', assignee: 'alice' })],
      relationships: [],
    });
    const task = out.nodes.find((n) => n.id === 'need:n-done');
    expect(task).toMatchObject({
      kind: 'task',
      state: 'complete',
      taskStatus: 'completed',
      ownerId: 'worker:alice',
    });
    expect(out.particles.length).toBe(0);
  });

  it('drops closed / expired / cancelled needs entirely', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [
        need({ needId: 'gone', status: 'closed', assignee: 'alice' }),
        need({ needId: 'stale', status: 'expired' }),
        need({ needId: 'axed', status: 'cancelled' }),
      ],
      relationships: [],
    });
    expect(out.nodes.some((n) => n.id.startsWith('need:'))).toBe(false);
    expect(out.particles.length).toBe(0);
  });

  it('renders a relationship as a single related edge even when both directions exist', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' }), worker({ workerId: 'bob' })],
      needs: [],
      relationships: [
        rel('alice', 'bob', { collaborations: 4 }),
        rel('bob', 'alice', { collaborations: 2 }),
      ],
    });
    const related = out.edges.filter((e) => e.type === 'related');
    expect(related).toHaveLength(1);
    const edge = related[0];
    expect([edge.source, edge.target].sort()).toEqual(['worker:alice', 'worker:bob']);
  });

  it('skips relationships that reference unknown workers', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [],
      relationships: [rel('alice', 'ghost'), rel('ghost1', 'ghost2')],
    });
    expect(out.edges.filter((e) => e.type === 'related')).toHaveLength(0);
  });

  it('skips a self-relationship (fromWorker === toWorker) — no self-loop edge', () => {
    // L198 真臂 `if (r.fromWorker === r.toWorker) continue`：自指关系跳过，不产生自环 related 边。
    // 既有关系测试都用不同 worker（假臂：alice↔bob / alice→ghost），自指真臂未覆盖。
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [],
      relationships: [rel('alice', 'alice')],
    });
    expect(out.edges.filter((e) => e.type === 'related')).toHaveLength(0);
  });

  it('produces a radial layout port whose owner order is the worker node ids', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' }), worker({ workerId: 'bob' })],
      needs: [],
      relationships: [],
    });
    expect(out.layout?.mode).toBe('radial');
    expect(out.layout?.ownerOrder.sort()).toEqual(['worker:alice', 'worker:bob']);
    // every owner in the order has a matching member node
    for (const ownerId of out.layout?.ownerOrder ?? []) {
      expect(out.nodes.some((n) => n.id === ownerId && n.kind === 'member')).toBe(true);
    }
  });

  it('is deterministic: identical input yields identical output', () => {
    const input = {
      workers: [worker({ workerId: 'alice' }), worker({ workerId: 'bob', activeTaskCount: 1 })],
      needs: [need({ needId: 'n1', status: 'in_progress', assignee: 'bob' })],
      relationships: [rel('alice', 'bob')],
    };
    const a = projectSocietyGraph(input);
    const b = projectSocietyGraph(input);
    expect(b).toEqual(a);
  });

  it('attaches a resolved avatar url to worker nodes when a resolver is provided', () => {
    const out = projectSocietyGraph(
      {
        workers: [worker({ workerId: 'alice' }), worker({ workerId: 'bob' })],
        needs: [],
        relationships: [],
      },
      { resolveAvatarUrl: (id) => `img:${id}.png` }
    );
    const avatar = (id: string) => out.nodes.find((n) => n.id === id)?.avatarUrl;
    expect(avatar('worker:alice')).toBe('img:alice.png');
    expect(avatar('worker:bob')).toBe('img:bob.png');
    // lead hub has no avatar (engine draws it)
    expect(out.nodes.find((n) => n.kind === 'lead')?.avatarUrl).toBeUndefined();
  });

  it('omits avatarUrl when no resolver is provided', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [],
      relationships: [],
    });
    expect(out.nodes.find((n) => n.id === 'worker:alice')?.avatarUrl).toBeUndefined();
  });

  it('ignores an unknown-worker assignee — task anchors to the agora, no ownership edge, no particle', () => {
    // A need whose assignee points to a workerId that is not registered
    // (e.g. worker unregistered mid-flight, or a stale assignee ref).
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' })],
      needs: [need({ needId: 'orphan', status: 'in_progress', assignee: 'ghost' })],
      relationships: [],
    });
    const task = out.nodes.find((n) => n.id === 'need:orphan');
    expect(task).toMatchObject({ kind: 'task', state: 'active', ownerId: null });
    // 无有效指派人 → 不产生指向不存在的 worker:ghost 的 ownership 边，改锚定到广场。
    expect(out.edges.some((e) => e.type === 'ownership')).toBe(false);
    expect(
      out.edges.some(
        (e) =>
          e.source === `agora:${TEAM}` && e.target === 'need:orphan' && e.type === 'parent-child'
      )
    ).toBe(true);
    // no particle can travel an ownership edge that does not exist
    expect(out.particles.some((p) => p.id.includes('orphan'))).toBe(false);
  });

  it('only one particle per in-flight need and none for needs lacking an assignee', () => {
    const out = projectSocietyGraph({
      workers: [worker({ workerId: 'alice' }), worker({ workerId: 'bob' })],
      needs: [
        need({ needId: 'a', status: 'in_progress', assignee: 'alice' }),
        need({ needId: 'b', status: 'assigned', assignee: 'bob' }),
        need({ needId: 'c', status: 'open' }),
      ],
      relationships: [],
    });
    expect(out.particles).toHaveLength(2);
    expect(out.particles.every((p) => p.kind === 'task_assign')).toBe(true);
  });
});
