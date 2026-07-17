/**
 * societyRoutes 测试 —— 用 Fastify inject 验证 REST 适配层（TDD 先行）。
 *
 * 覆盖：workers 增查、needs 全生命周期（publish→volunteer→select→start→deliver→accept）、
 * social feed（cross-team 格式化消息）、relationships、以及 400 校验。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkerSociety } from '../../composition/societyComposition';

import { registerSocietyRoutes } from './societyRoutes';

import type { SocietyComponents } from '../../composition/societyComposition';

describe('societyRoutes (Fastify inject)', () => {
  let root: string;
  let app: FastifyInstance;
  let c: SocietyComponents;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-routes-'));
    c = createWorkerSociety(root);
    app = Fastify();
    registerSocietyRoutes(app, c);
  });
  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('GET /api/society/workers starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/society/workers' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('registers a worker and lists it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().workerId).toBe('dev');
    const list = await app.inject({ method: 'GET', url: '/api/society/workers' });
    expect(list.json().map((w: { workerId: string }) => w.workerId)).toEqual(['dev']);
  });

  it('rejects registration missing workerId/name with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: { workerId: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects publishing a need missing postedBy/subject with 400', async () => {
    // register 与 messages 的 400 校验已测；publish 的同源 400 分支（L91-93 的 `||` 两臂）此前漏测，补齐一致性。
    const noPoster = await app.inject({
      method: 'POST',
      url: '/api/society/needs',
      payload: { subject: '搭一个登录页' }, // 缺 postedBy
    });
    expect(noPoster.statusCode).toBe(400);

    const noSubject = await app.inject({
      method: 'POST',
      url: '/api/society/needs',
      payload: { postedBy: 'poster' }, // 缺 subject
    });
    expect(noSubject.statusCode).toBe(400);
  });

  it('coerces a non-array requiredCapabilities to [] when publishing a need', async () => {
    // 路由防御性归一（L98-100 Array.isArray 的 false 臂）：客户端/MCP 若传非数组
    // requiredCapabilities（字符串/null 等），不崩，归一为空能力。已知设计取舍——空能力
    // 意味着该 need 无门槛（任何 worker 都匹配），此处仅固化现状、不改设计。
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: { workerId: 'poster', name: 'Poster', capabilities: [] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/needs',
      payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: 'code,css' }, // 字符串而非数组
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().requiredCapabilities).toEqual([]);
  });

  it('publishes a need and lists it as open', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/needs',
      payload: { postedBy: 'poster', subject: 'build X', requiredCapabilities: ['code'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('open');
    const open = await app.inject({ method: 'GET', url: '/api/society/needs/open' });
    expect(open.json().map((n: { subject: string }) => n.subject)).toContain('build X');
  });

  it('runs volunteer→select→start→deliver→accept via routes, closing the need', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
        reputation: 60,
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/society/needs/${need.needId}/volunteer`,
          payload: { workerId: 'dev' },
        })
      ).json().ok
    ).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/select` })).json()
        .assignee
    ).toBe('dev');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/society/needs/${need.needId}/start`,
          payload: { workerId: 'dev' },
        })
      ).json().ok
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/society/needs/${need.needId}/deliver`,
          payload: { result: 'v1' },
        })
      ).json().ok
    ).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/accept` })).json()
        .ok
    ).toBe(true);

    const got = (
      await app.inject({ method: 'GET', url: `/api/society/needs/${need.needId}` })
    ).json();
    expect(got.status).toBe('closed');
  });

  it('GET /api/society/feed returns cross-team-formatted messages after volunteering', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/volunteer`,
      payload: { workerId: 'dev' },
    });

    const feed = (await app.inject({ method: 'GET', url: '/api/society/feed' })).json();
    expect(feed.length).toBeGreaterThan(0);
    expect(feed[0].formatted).toContain('cross-team');
  });

  it('lists relationships after a completed collaboration', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/volunteer`,
      payload: { workerId: 'dev' },
    });
    await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/select` });
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/start`,
      payload: { workerId: 'dev' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/deliver`,
      payload: { result: 'v1' },
    });
    await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/accept` });

    const rels = (await app.inject({ method: 'GET', url: '/api/society/relationships' })).json();
    expect(rels.length).toBeGreaterThan(0);
  });

  it('cancels an open need and requests revision on a delivered need via routes', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });

    // cancel an open need
    const open = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'toCancel', requiredCapabilities: ['code'] },
      })
    ).json();
    expect(
      (await app.inject({ method: 'POST', url: `/api/society/needs/${open.needId}/cancel` })).json()
        .ok
    ).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: `/api/society/needs/${open.needId}` })).json().status
    ).toBe('cancelled');

    // revision on a delivered need (delivered -> in_progress)
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'toRevise', requiredCapabilities: ['code'] },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/volunteer`,
      payload: { workerId: 'dev' },
    });
    await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/select` });
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/start`,
      payload: { workerId: 'dev' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/deliver`,
      payload: { result: 'v1' },
    });
    const revised = (
      await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/revision` })
    ).json();
    expect(revised.ok).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: `/api/society/needs/${need.needId}` })).json().status
    ).toBe('in_progress');
  });

  it('runs an autonomy tick that makes a matching worker self-volunteer', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();

    const out = (await app.inject({ method: 'POST', url: '/api/society/autonomy/tick' })).json();
    expect(out.applied).toBeGreaterThanOrEqual(1);

    const got = (
      await app.inject({ method: 'GET', url: `/api/society/needs/${need.needId}` })
    ).json();
    expect(got.volunteers.map((v: { workerId: string }) => v.workerId)).toContain('dev');
  });

  it('GET /api/society/workers/:workerId returns the profile, or 404 when unknown', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: { workerId: 'dev', name: 'Dev', capabilities: [] },
    });
    expect((await app.inject({ method: 'GET', url: '/api/society/workers/dev' })).statusCode).toBe(
      200
    );
    const missing = await app.inject({ method: 'GET', url: '/api/society/workers/ghost' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('worker_not_found');
  });

  it('rejects a message missing required fields with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/messages',
      payload: { fromWorker: 'a' }, // 缺 toWorker / text
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/society/needs/active shows assigned needs that /needs/open hides', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/volunteer`,
      payload: { workerId: 'dev' },
    });
    await app.inject({ method: 'POST', url: `/api/society/needs/${need.needId}/select` });

    // 选派后：open 看板里消失，但 active（画布）里仍可见 —— worker 才会停在任务上。
    const open = (await app.inject({ method: 'GET', url: '/api/society/needs/open' })).json();
    const active = (await app.inject({ method: 'GET', url: '/api/society/needs/active' })).json();
    expect(open.map((n: { needId: string }) => n.needId)).not.toContain(need.needId);
    expect(active.map((n: { needId: string }) => n.needId)).toContain(need.needId);
  });

  it('auto-selects pending volunteers via route', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${need.needId}/volunteer`,
      payload: { workerId: 'dev' },
    });

    const out = (
      await app.inject({ method: 'POST', url: '/api/society/autonomy/auto-select' })
    ).json();
    expect(out.selected).toBeGreaterThanOrEqual(1);
    const got = (
      await app.inject({ method: 'GET', url: `/api/society/needs/${need.needId}` })
    ).json();
    expect(got.status).toBe('assigned');
  });

  it('POST /api/society/messages delivers a worker→worker message and it appears in the feed', async () => {
    // 此前只测了 /messages 的 400 校验分支；本用例补「发送成功」主路径（societyRoutes L184）。
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: { workerId: 'a', name: 'Alice', capabilities: [] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: { workerId: 'b', name: 'Bob', capabilities: [] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/messages',
      payload: { fromWorker: 'a', toWorker: 'b', text: 'hi from route' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    // 自由社交消息经 gateway 落 messages.jsonl，/feed 能读回（SocialMessageRecord 保留原始 text）。
    const feed = (await app.inject({ method: 'GET', url: '/api/society/feed' })).json();
    expect(feed.some((m: { text?: string }) => (m.text ?? '').includes('hi from route'))).toBe(
      true
    );
  });

  it('POST /api/society/messages from an unregistered sender returns ok:false (worker_not_found), HTTP 200', async () => {
    // 路由只校验字段非空（→400）；发送方是否注册交由 service 判定 → ok:false，HTTP 仍 200（松类型路由约定）。
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: { workerId: 'b', name: 'Bob', capabilities: [] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/messages',
      payload: { fromWorker: 'ghost', toWorker: 'b', text: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, reason: 'worker_not_found' });
  });

  it('GET /api/society/feed degrades to [] (not 500) when the gateway throws', async () => {
    // 路由的 try/catch→[] 优雅降级（societyRoutes L187-193）：底层 gateway.recent 抛错时
    // 不应 500、而返空数组——前端拿空 feed 不崩。所有 GET 列表路由（/workers、/needs*、
    // /relationships、/feed）同构，本测以 /feed 为代表锁该契约。
    // 注：真实 gateway 自身 readJson 已 catch 兜底（不抛），故需注入一个会抛的 gateway 触发路由层 catch。
    c.gateway = {
      recent: async () => {
        throw new Error('disk gone');
      },
    } as unknown as SocietyComponents['gateway'];
    const res = await app.inject({ method: 'GET', url: '/api/society/feed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST command routes tolerate a missing JSON body (request.body ?? {} → empty fields propagate to the service)', async () => {
    // L110/113/125/126/131/132：volunteer/start/deliver 路由的 `request.body ?? {}` +
    // `String(field ?? '')` 防御性归一——客户端不发 body（代理剥离 / 漏 Content-Type）时
    // request.body 为 undefined，路由归一为空字段并下传 service，绝不崩。这 3 个命令路由无
    // 400 校验，故空字段产生**可观测**的 service 结果（不是 400）：
    //   - 空 workerId 自荐 → worker_not_found（L110 body??{} + L113 workerId??''）
    //   - 空 workerId 开始 → not_assignee（assignee 永远 !== ''；L125 + L126）
    //   - 空 result 交付 → 成功（空结果被允许；L131 + L132）
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev',
        name: 'Dev',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const { needId } = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();

    // need=open：无 body 自荐 → volunteerFor(needId, '') → worker_not_found
    const volNoBody = await app.inject({
      method: 'POST',
      url: `/api/society/needs/${needId}/volunteer`,
    });
    expect(volNoBody.json()).toMatchObject({ ok: false, reason: 'worker_not_found' });

    // 正常自荐 + 选派 → assigned（推进状态）
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${needId}/volunteer`,
      payload: { workerId: 'dev' },
    });
    await app.inject({ method: 'POST', url: `/api/society/needs/${needId}/select` });

    // need=assigned：无 body 开始 → startNeed(needId, '') → assignee 'dev' !== '' → not_assignee
    const startNoBody = await app.inject({
      method: 'POST',
      url: `/api/society/needs/${needId}/start`,
    });
    expect(startNoBody.json()).toMatchObject({ ok: false, reason: 'not_assignee' });

    // 正常开始 → in_progress（推进状态）
    await app.inject({
      method: 'POST',
      url: `/api/society/needs/${needId}/start`,
      payload: { workerId: 'dev' },
    });

    // need=in_progress：无 body 交付 → deliverNeed(needId, '') → 空结果被允许、成功
    const deliverNoBody = await app.inject({
      method: 'POST',
      url: `/api/society/needs/${needId}/deliver`,
    });
    expect(deliverNoBody.json()).toMatchObject({ ok: true });
  });

  it('GET /api/society/needs/:needId returns null for an unknown need (explicit miss, not 404)', async () => {
    // L84 `(await c.needs.get(needId)) ?? null` 右臂：查不到的 need 显式返回 null——前端用 null
    // 区分「不存在」vs「加载中(undefined)」，是查询的显式缺失契约（非 404、非抛错）。
    const res = await app.inject({ method: 'GET', url: '/api/society/needs/ghost-need' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('autonomy/tick honors a numeric maxVolunteersPerNeed cap (L154 true arm)', async () => {
    // L154 `typeof body[k] === 'number' ? (body[k] as number) : undefined` 的 **TRUE 臂**：客户端传
    // 真数字 option → 透传给 runAutonomyTick → 真正按 maxVolunteersPerNeed 限流。既有的无-body tick
    // 测（body={} → undefined）只覆盖 FALSE 臂，TRUE 臂此前从未在路由层被触达（lcov 残留 BRDA:154）。
    // 观测手段：2 个匹配 worker + 1 need，cap=1 时 greedy 只选最高适配者 1 人；若 TRUE 臂失效（始终
    // undefined → 默认 cap 3），两人都会自荐 → length=2，断言即失败。
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'poster',
        name: 'Poster',
        capabilities: [{ skill: 'pm', description: 'pm' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev1',
        name: 'Dev1',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/society/workers/register',
      payload: {
        workerId: 'dev2',
        name: 'Dev2',
        capabilities: [{ skill: 'code', description: 'code' }],
      },
    });
    const need = (
      await app.inject({
        method: 'POST',
        url: '/api/society/needs',
        payload: { postedBy: 'poster', subject: 'X', requiredCapabilities: ['code'] },
      })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/society/autonomy/tick',
      payload: { maxVolunteersPerNeed: 1 }, // 真数字 → TRUE 臂 → cap 生效
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    const got = (
      await app.inject({ method: 'GET', url: `/api/society/needs/${need.needId}` })
    ).json();
    expect(got.volunteers).toHaveLength(1); // cap=1 限流：仅 1 个自荐者（默认 3 则两人都自荐）
  });

  it('validation routes return 400 (not 500) on a bodyless POST (L36/37/88/177/178 ?? arms)', async () => {
    // `(request.body ?? {})` + `String(body.field ?? '')` 的 **true 臂**：客户端 POST 不带 body（漏
    // Content-Type / 空体）→ request.body 为 undefined → `?? {}` 归一为 {} → 各字段 undefined → `?? ''`
    // 归一空串 → 触发 400 校验。既有 400 测都**传了 body**（命中的是 false 臂：字段 present 但为空串），
    // 无-body 归一臂（L36/88/177 的 `?? {}` + L37/178 的 `?? ''`）此前从未触达（lcov 残留 5 臂）。
    // 防回归：若删掉任一 `?? {}` 守卫，无-body POST 会 `undefined.workerId` 抛 TypeError → Fastify 回 500
    // 而非 400，断言即失败。3 路 × 无 body 一并覆盖 5 个 ?? true 臂（与 iter-41 bodyless-command 同主题收尾）。
    const reg = await app.inject({ method: 'POST', url: '/api/society/workers/register' }); // 无 body
    expect(reg.statusCode).toBe(400); // L36 `?? {}` + L37 `workerId ?? ''` true 臂 → 400
    expect(reg.json().error).toBe('workerId and name required');

    const pub = await app.inject({ method: 'POST', url: '/api/society/needs' }); // 无 body
    expect(pub.statusCode).toBe(400); // L88 `?? {}` true 臂 → 400
    expect(pub.json().error).toBe('postedBy and subject required');

    const msg = await app.inject({ method: 'POST', url: '/api/society/messages' }); // 无 body
    expect(msg.statusCode).toBe(400); // L177 `?? {}` + L178 `fromWorker ?? ''` true 臂 → 400
    expect(msg.json().error).toBe('fromWorker, toWorker and text required');
  });
});
