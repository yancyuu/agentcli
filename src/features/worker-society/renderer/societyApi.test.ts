/**
 * societyApi 测试 —— 前端 fetch 客户端（TDD 先行）。
 *
 * 断言：正确的 baseUrl + /api/society/* 路径、HTTP 方法、body 形状（csv 能力转数组），
 * 以及非 2xx 时把 {error} 透传成异常。用 vi.fn 拦截全局 fetch，零真实网络。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSocietyApi } from './societyApi';

/** 造一个最小 Response 替身。 */
function res(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

describe('societyApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('prefixes baseUrl onto every request', async () => {
    fetchMock.mockResolvedValueOnce(res([]));
    const api = createSocietyApi('http://localhost:7777');
    await api.listWorkers();
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:7777/api/society/workers');
  });

  it('GETs workers and parses the array', async () => {
    fetchMock.mockResolvedValueOnce(res([{ workerId: 'a' }]));
    const api = createSocietyApi();
    const workers = await api.listWorkers();
    expect(workers).toEqual([{ workerId: 'a' }]);
  });

  it('POSTs register and converts comma-separated capabilities into capability objects', async () => {
    fetchMock.mockResolvedValueOnce(res({ workerId: 'dev', capabilities: [] }));
    const api = createSocietyApi();
    await api.registerWorker({ workerId: 'dev', name: 'Dev', capabilities: 'code, design' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ workerId: 'dev', name: 'Dev' });
    expect(body.capabilities).toEqual([
      { skill: 'code', description: 'code' },
      { skill: 'design', description: 'design' },
    ]);
  });

  it('POSTs register with interests split from csv into a string array', async () => {
    // L111 的 `input.interests ? csvToArray(...) : undefined` 真臂：传 interests 时拆成 string[]
    // （注意与 capabilities 的「对象数组」语义不同——interests 是纯 skill 名）。
    // 既有 register 测试不传 interests（走 :undefined 假臂），本用例补真臂。
    fetchMock.mockResolvedValueOnce(res({ workerId: 'dev', interests: [] }));
    const api = createSocietyApi();
    await api.registerWorker({ workerId: 'dev', name: 'Dev', interests: 'design, ui' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.interests).toEqual(['design', 'ui']);
  });

  it('POSTs publishNeed with requiredCapabilities split from csv into an array', async () => {
    fetchMock.mockResolvedValueOnce(res({ needId: 'n1', status: 'open' }));
    const api = createSocietyApi();
    await api.publishNeed({ postedBy: 'u', subject: 'X', requiredCapabilities: 'code,qa' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ postedBy: 'u', subject: 'X' });
    expect(body.requiredCapabilities).toEqual(['code', 'qa']);
  });

  it('POSTs publishNeed with an empty requiredCapabilities array when none are given', async () => {
    // csvToArray L24 的 `(value ?? '')` 空值假臂：publish 不传 requiredCapabilities → csvToArray(undefined) → []。
    // 既有 publish 测试恒传 'code,qa'（真臂），本用例补空值假臂，收尾 societyApi csv 辅助分支。
    fetchMock.mockResolvedValueOnce(res({ needId: 'n1', status: 'open' }));
    const api = createSocietyApi();
    await api.publishNeed({ postedBy: 'u', subject: 'X' }); // 不传 requiredCapabilities
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.requiredCapabilities).toEqual([]);
  });

  it('lists open needs', async () => {
    fetchMock.mockResolvedValueOnce(res([{ needId: 'n1' }]));
    const api = createSocietyApi();
    expect(await api.listOpenNeeds()).toEqual([{ needId: 'n1' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs/open');
  });

  it('lists active needs (lifecycle, vs open-only)', async () => {
    fetchMock.mockResolvedValueOnce(res([{ needId: 'a1', status: 'assigned' }]));
    const api = createSocietyApi();
    expect(await api.listActiveNeeds()).toEqual([{ needId: 'a1', status: 'assigned' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs/active');
  });

  it('lists relationships', async () => {
    fetchMock.mockResolvedValueOnce(res([{ fromWorker: 'a' }]));
    const api = createSocietyApi();
    expect(await api.listRelationships()).toEqual([{ fromWorker: 'a' }]);
  });

  it('GETs the feed (no limit query — server returns recent 50)', async () => {
    fetchMock.mockResolvedValueOnce(res([{ id: 'm1' }]));
    const api = createSocietyApi();
    expect(await api.getFeed()).toEqual([{ id: 'm1' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/feed');
  });

  it('posts volunteer with { workerId } and url-encodes the need id', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.volunteer('need 1', 'dev');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs/need%201/volunteer');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ workerId: 'dev' });
  });

  it('posts accept with no body', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.acceptDelivery('n1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs/n1/accept');
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeUndefined();
  });

  it('sends a social message', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.sendMessage('a', 'b', 'hi');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      fromWorker: 'a',
      toWorker: 'b',
      text: 'hi',
    });
  });

  it('throws the server {error} message on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(res({ error: 'boom' }, 500));
    const api = createSocietyApi();
    await expect(api.listWorkers()).rejects.toThrow('boom');
  });

  it('throws a generic HTTP error when body is empty', async () => {
    const empty = {
      ok: false,
      status: 502,
      text: () => Promise.resolve(''),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(empty);
    const api = createSocietyApi();
    await expect(api.listWorkers()).rejects.toThrow('HTTP 502');
  });

  it('wraps a non-JSON error body (e.g. an HTML gateway page) into an HTTP-prefixed message', async () => {
    // 反代/网关 502 常返回 HTML 错误页（非 JSON）。parseResponse 的 SyntaxError 分支须把它包成
    // `HTTP {status}: {body 前 200 字符}`，而非让原始 SyntaxError 冒泡——否则客户端拿到的是
    // 不可读的 `Unexpected token <` 而非带状态码的可用错误。本用例补齐错误路径三分支的最后一支
    // （空体 / JSON {error} / 非 JSON），characterization（绿现），与 iter-3/7/8/12 同类。
    const html = {
      ok: false,
      status: 502,
      text: () => Promise.resolve('<html><body>502 Bad Gateway</body></html>'),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(html);
    const api = createSocietyApi();
    await expect(api.listWorkers()).rejects.toThrow(/HTTP 502:.*502 Bad Gateway/);
  });

  it('falls back to an HTTP-status message when a non-2xx JSON body has no {error} field', async () => {
    // parseResponse L77 的 `parsed.error ?? \`HTTP ${status}\`` false 臂：服务器/网关返回非 2xx 且
    // JSON 体但无 error 字段（如 502 {"upstream":"timeout"} 或 400 {}）→ 回退 `HTTP {status}`，
    // 不把 body 字段当 message、也不崩。既有 3 个错误用例覆盖「JSON 有 error / 空体 / 非 JSON」，
    // 唯独「JSON 无 error」这一支漏——补齐错误路径四分支的最后一块。
    fetchMock.mockResolvedValueOnce(res({ upstream: 'timeout' }, 502));
    const api = createSocietyApi();
    await expect(api.listWorkers()).rejects.toThrow(/^HTTP 502$/);
  });

  it('returns undefined for a 2xx response with an empty body', async () => {
    // parseResponse L83：2xx 但 body 空/纯空白 → 返回 undefined（而非 JSON.parse('') 崩）。
    // 路由理论上都返 JSON，但客户端须对空体健壮（代理截断、204 No Content、空 200 等）。
    const empty = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(empty);
    const api = createSocietyApi();
    expect(await api.listWorkers()).toBeUndefined();
  });

  it('GETs a single worker by id', async () => {
    fetchMock.mockResolvedValueOnce(res({ workerId: 'dev' }));
    const api = createSocietyApi();
    expect(await api.getWorker('dev')).toEqual({ workerId: 'dev' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/workers/dev');
  });

  it('lists all needs (vs open-only)', async () => {
    fetchMock.mockResolvedValueOnce(res([{ needId: 'n1' }]));
    const api = createSocietyApi();
    expect(await api.listAllNeeds()).toEqual([{ needId: 'n1' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs');
  });

  it('posts select with no body and url-encodes the need id', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.selectAssignee('n 1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs/n%201/select');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('posts start with { workerId }', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.startNeed('n1', 'dev');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ workerId: 'dev' });
  });

  it('posts deliver with { result }', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.deliverNeed('n1', 'v1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ result: 'v1' });
  });

  it('posts cancel with no body', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const api = createSocietyApi();
    await api.cancelNeed('n1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/needs/n1/cancel');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('POSTs an autonomy tick with no body and returns applied count', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true, applied: 2 }));
    const api = createSocietyApi();
    const out = await api.runAutonomyTick();
    expect(out).toEqual({ ok: true, applied: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/autonomy/tick');
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('POSTs auto-select with no body and returns the selected count', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true, selected: 1 }));
    const api = createSocietyApi();
    expect(await api.autoSelectPending()).toEqual({ ok: true, selected: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/society/autonomy/auto-select');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});
