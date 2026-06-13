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

import type { SocietyComponents } from '../../composition/societyComposition';
import { createWorkerSociety } from '../../composition/societyComposition';
import { registerSocietyRoutes } from './societyRoutes';

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
});
