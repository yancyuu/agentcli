/**
 * SocietyGraphAdapter — projects worker-society domain → @claude-teams/agent-graph.
 *
 * The reusable graph engine (packages/agent-graph) already powers the team graph in
 * cyan/space holographic style. This adapter feeds it the *decentralized agora*:
 *   - a synthetic 「广场 / Agora」 hub (kind 'lead') sits at the radial center,
 *   - each worker becomes a member node parented to the agora,
 *   - each active need becomes a task orbiting its assignee (ownership edge),
 *   - each relationship becomes a 'related' edge between two workers,
 *   - each in-flight assignment spawns a particle along the ownership edge.
 *
 * Pure & deterministic: no Math.random, no FS/network/React — fully unit-testable.
 * The cyan palette comes from the engine itself; we do not override colors, so the
 * worker society renders with the same 1:1 holographic theme as the team graph.
 * Worker avatars are injected by the host (SocietyGraph) via resolveAvatarUrl so the
 * adapter itself stays renderer-agnostic (no asset imports here).
 */
import type {
  GraphDataPort,
  GraphEdge,
  GraphLayoutPort,
  GraphNode,
  GraphNodeState,
  GraphParticle,
} from '@claude-teams/agent-graph';

import type {
  NeedStatus,
  PublishedNeed,
  Relationship,
  WorkerProfile,
} from '../core/domain/models/society';

/** Stable society/team name used for node ids and domain refs. */
export const SOCIETY_GRAPH_TEAM = 'worker-society';
const AGORA_ID = `agora:${SOCIETY_GRAPH_TEAM}`;
const AGORA_LABEL = '广场';

/** Engine cyan (matches packages/agent-graph COLORS.active) for in-flight particles. */
const PARTICLE_CYAN = '#66ccff';

/** Needs still worth showing on the graph (closed/expired/cancelled drop out). */
const VISIBLE_NEED_STATUSES: ReadonlySet<NeedStatus> = new Set([
  'open',
  'assigned',
  'in_progress',
  'delivered',
]);

/** Needs whose assignee is actively working — emit a flowing particle. */
const IN_FLIGHT_NEED_STATUSES: ReadonlySet<NeedStatus> = new Set(['assigned', 'in_progress']);

export interface SocietyGraphSnapshot {
  workers: WorkerProfile[];
  /** Active needs (open/assigned/in_progress/delivered). */
  needs: PublishedNeed[];
  relationships: Relationship[];
}

export interface SocietyGraphProjectOptions {
  /** Optional avatar resolver — given a workerId, return a stable avatar URL. */
  resolveAvatarUrl?: (workerId: string) => string | undefined;
}

/** Node id for a worker. */
export function workerNodeId(workerId: string): string {
  return `worker:${workerId}`;
}

/** Node id for a need. */
export function needNodeId(needId: string): string {
  return `need:${needId}`;
}

function workerState(worker: WorkerProfile): GraphNodeState {
  if (worker.status === 'offline') return 'idle';
  if (worker.activeTaskCount > 0) return 'active';
  if (worker.status === 'busy') return 'active';
  return 'idle';
}

function needState(status: NeedStatus): GraphNodeState {
  switch (status) {
    case 'in_progress':
      return 'active';
    case 'delivered':
      return 'complete';
    default:
      return 'waiting';
  }
}

function needTaskStatus(status: NeedStatus): 'pending' | 'in_progress' | 'completed' | 'deleted' {
  switch (status) {
    case 'in_progress':
      return 'in_progress';
    case 'delivered':
      return 'completed';
    default:
      return 'pending';
  }
}

/**
 * Project a worker-society snapshot into a GraphDataPort snapshot for the engine.
 * Returns an empty/dead port when the society has no workers and no needs.
 */
export function projectSocietyGraph(
  snapshot: SocietyGraphSnapshot,
  options: SocietyGraphProjectOptions = {}
): GraphDataPort {
  const { workers, needs, relationships } = snapshot;
  const { resolveAvatarUrl } = options;

  if (workers.length === 0 && needs.length === 0) {
    return { nodes: [], edges: [], particles: [], teamName: SOCIETY_GRAPH_TEAM, isAlive: false };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const particles: GraphParticle[] = [];

  const knownWorkerIds = new Set(workers.map((w) => w.workerId));

  // ── Agora hub (radial center) ──────────────────────────────────────────────
  nodes.push({
    id: AGORA_ID,
    kind: 'lead',
    label: AGORA_LABEL,
    state: 'active',
    domainRef: { kind: 'lead', teamName: SOCIETY_GRAPH_TEAM, memberName: 'agora' },
  });

  // ── Workers → member nodes, parented to the agora ──────────────────────────
  for (const w of workers) {
    const memberId = workerNodeId(w.workerId);
    nodes.push({
      id: memberId,
      kind: 'member',
      label: w.name,
      state: workerState(w),
      role: w.kind,
      runtimeLabel: w.harness,
      avatarUrl: resolveAvatarUrl?.(w.workerId),
      domainRef: { kind: 'member', teamName: SOCIETY_GRAPH_TEAM, memberName: w.workerId },
    });
    edges.push({
      id: `edge:parent:${AGORA_ID}:${memberId}`,
      source: AGORA_ID,
      target: memberId,
      type: 'parent-child',
    });
  }

  // ── Needs → task nodes orbiting their assignee ─────────────────────────────
  for (const need of needs) {
    if (!VISIBLE_NEED_STATUSES.has(need.status)) continue;
    const assigneeId =
      need.assignee && knownWorkerIds.has(need.assignee) ? workerNodeId(need.assignee) : null;

    nodes.push({
      id: needNodeId(need.needId),
      kind: 'task',
      label: need.subject,
      sublabel:
        need.requiredCapabilities.length > 0 ? need.requiredCapabilities.join(' · ') : undefined,
      state: needState(need.status),
      taskStatus: needTaskStatus(need.status),
      ownerId: assigneeId,
      domainRef: { kind: 'task', teamName: SOCIETY_GRAPH_TEAM, taskId: need.needId },
    });

    if (assigneeId) {
      const ownEdgeId = `edge:own:${assigneeId}:${needNodeId(need.needId)}`;
      edges.push({
        id: ownEdgeId,
        source: assigneeId,
        target: needNodeId(need.needId),
        type: 'ownership',
      });

      // In-flight assignment → a particle flowing along the ownership edge.
      if (IN_FLIGHT_NEED_STATUSES.has(need.status)) {
        particles.push({
          id: `particle:need:${need.needId}`,
          edgeId: ownEdgeId,
          progress: 0,
          kind: 'task_assign',
          color: PARTICLE_CYAN,
        });
      }
    }
  }

  // ── Relationships → 'related' edges (bidirectional-deduped) ────────────────
  const seenRelated = new Set<string>();
  for (const r of relationships) {
    if (r.fromWorker === r.toWorker) continue;
    if (!knownWorkerIds.has(r.fromWorker) || !knownWorkerIds.has(r.toWorker)) continue;
    const [a, b] =
      r.fromWorker <= r.toWorker ? [r.fromWorker, r.toWorker] : [r.toWorker, r.fromWorker];
    const key = `${a}:${b}`;
    if (seenRelated.has(key)) continue;
    seenRelated.add(key);
    edges.push({
      id: `edge:rel:${a}:${b}`,
      source: workerNodeId(a),
      target: workerNodeId(b),
      type: 'related',
    });
  }

  const layout: GraphLayoutPort = {
    version: 'stable-slots-v1',
    mode: 'radial',
    ownerOrder: workers.map((w) => workerNodeId(w.workerId)),
    slotAssignments: {},
  };

  return {
    nodes,
    edges,
    particles,
    teamName: SOCIETY_GRAPH_TEAM,
    isAlive: workers.length > 0,
    layout,
  };
}
