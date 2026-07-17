/**
 * Worker Society — 输入适配器：Fastify REST 路由（/api/society/*）。
 *
 * 把 WorkerSocietyService 的 use case 暴露为 HTTP 接口，供前端 / 外部调用。
 * 命令（发布、自荐、选派、交付…）走 service；纯查询（列表/详情/feed）直接读 store/gateway。
 *
 * 路由风格对齐 server.ts 既有约定（app.get/post，try/catch 返回兜底，body 用 Record 解析）。
 */
import type {
  PublishNeedCommand,
  RegisterProfileCommand,
} from '../../../core/application/WorkerSocietyService';
import type { AgentCapability } from '../../../core/domain/models/society';
import type { SocietyComponents } from '../../composition/societyComposition';
import type { FastifyInstance } from 'fastify';

export function registerSocietyRoutes(app: FastifyInstance, c: SocietyComponents): void {
  // ── workers（发现 / 档案）──────────────────────────────────────────────
  app.get('/api/society/workers', async () => {
    try {
      return await c.service.discoverWorkers();
    } catch {
      return [];
    }
  });

  app.get('/api/society/workers/:workerId', async (request, reply) => {
    const { workerId } = request.params as { workerId: string };
    const profile = await c.service.getProfile(workerId);
    if (!profile) return reply.code(404).send({ error: 'worker_not_found' });
    return profile;
  });

  app.post('/api/society/workers/register', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const workerId = String(body.workerId ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!workerId || !name) {
      return reply.code(400).send({ error: 'workerId and name required' });
    }
    const cmd: RegisterProfileCommand = {
      workerId,
      name,
      kind: body.kind as RegisterProfileCommand['kind'],
      harness: body.harness as string | undefined,
      capabilities: body.capabilities as AgentCapability[] | undefined,
      interests: body.interests as string[] | undefined,
      maxConcurrent: body.maxConcurrent as number | undefined,
      reputation: body.reputation as number | undefined,
      description: body.description as string | undefined,
    };
    return await c.service.registerProfile(cmd);
  });

  // ── needs（广场公告板）─────────────────────────────────────────────────
  app.get('/api/society/needs/open', async () => {
    try {
      return await c.needs.listOpen();
    } catch {
      return [];
    }
  });

  // 画布/实时视图用：仍在生命周期内的需求（选派后/执行中/待审核也保留）。
  app.get('/api/society/needs/active', async () => {
    try {
      return await c.needs.listActive();
    } catch {
      return [];
    }
  });

  app.get('/api/society/needs', async () => {
    try {
      return await c.needs.list();
    } catch {
      return [];
    }
  });

  app.get('/api/society/needs/:needId', async (request) => {
    const { needId } = request.params as { needId: string };
    return (await c.needs.get(needId)) ?? null;
  });

  app.post('/api/society/needs', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const postedBy = String(body.postedBy ?? '').trim();
    const subject = String(body.subject ?? '').trim();
    if (!postedBy || !subject) {
      return reply.code(400).send({ error: 'postedBy and subject required' });
    }
    const cmd: PublishNeedCommand = {
      postedBy,
      subject,
      description: body.description as string | undefined,
      requiredCapabilities: Array.isArray(body.requiredCapabilities)
        ? (body.requiredCapabilities as string[])
        : [],
      priority: body.priority as number | undefined,
      deadline: body.deadline as string | undefined,
    };
    const { need } = await c.service.publishNeed(cmd);
    return need;
  });

  app.post('/api/society/needs/:needId/volunteer', async (request) => {
    const { needId } = request.params as { needId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return await c.service.volunteerFor(
      needId,
      String(body.workerId ?? '').trim(),
      body.note as string | undefined
    );
  });

  app.post('/api/society/needs/:needId/select', async (request) => {
    const { needId } = request.params as { needId: string };
    return await c.service.selectAssignee(needId);
  });

  app.post('/api/society/needs/:needId/start', async (request) => {
    const { needId } = request.params as { needId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return await c.service.startNeed(needId, String(body.workerId ?? '').trim());
  });

  app.post('/api/society/needs/:needId/deliver', async (request) => {
    const { needId } = request.params as { needId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    return await c.service.deliverNeed(needId, String(body.result ?? '').trim());
  });

  app.post('/api/society/needs/:needId/accept', async (request) => {
    const { needId } = request.params as { needId: string };
    return await c.service.acceptDelivery(needId);
  });

  app.post('/api/society/needs/:needId/revision', async (request) => {
    const { needId } = request.params as { needId: string };
    return await c.service.requestRevision(needId);
  });

  app.post('/api/society/needs/:needId/cancel', async (request) => {
    const { needId } = request.params as { needId: string };
    return await c.service.cancelNeed(needId);
  });

  // ── 自治驱动（去中心化：让 worker 主动自荐，反派单）─────────────────────
  app.post('/api/society/autonomy/tick', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const numOrUndef = (k: string): number | undefined =>
      typeof body[k] === 'number' ? body[k] : undefined;
    const applied = await c.service.runAutonomyTick({
      maxVolunteersPerNeed: numOrUndef('maxVolunteersPerNeed'),
      maxNeedsPerWorker: numOrUndef('maxNeedsPerWorker'),
    });
    return { ok: true, applied };
  });

  app.post('/api/society/autonomy/auto-select', async () => {
    const selected = await c.service.autoSelectPending();
    return { ok: true, selected };
  });

  // ── 社交：关系 / 消息 / 活动流 ─────────────────────────────────────────
  app.get('/api/society/relationships', async () => {
    try {
      return await c.relationships.list();
    } catch {
      return [];
    }
  });

  app.post('/api/society/messages', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fromWorker = String(body.fromWorker ?? '').trim();
    const toWorker = String(body.toWorker ?? '').trim();
    const text = String(body.text ?? '').trim();
    if (!fromWorker || !toWorker || !text) {
      return reply.code(400).send({ error: 'fromWorker, toWorker and text required' });
    }
    return await c.service.sendSocialMessage(fromWorker, toWorker, text);
  });

  app.get('/api/society/feed', async () => {
    try {
      return await c.gateway.recent(50);
    } catch {
      return [];
    }
  });
}
