/**
 * societyMcp 测试 —— MCP 工具适配层（TDD 先行）。
 *
 * 验证 executeSocietyMcpTool 把 agent 的 MCP 调用（snake_case 参数、逗号分隔能力）
 * 正确映射到 WorkerSocietyService，并覆盖全自治流程 + 未知工具返回 null（便于 server.ts 回退）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SocietyComponents } from '../../composition/societyComposition';
import { createWorkerSociety } from '../../composition/societyComposition';
import { SOCIETY_MCP_TOOLS, executeSocietyMcpTool } from './societyMcp';

function json(res: { text: string }[]): unknown {
  return JSON.parse(res[0].text);
}

describe('executeSocietyMcpTool', () => {
  let root: string;
  let c: SocietyComponents;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-mcp-'));
    c = createWorkerSociety(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exposes a namespaced tool list (society_*)', () => {
    const names = SOCIETY_MCP_TOOLS.map((t) => t.name);
    expect(names.every((n) => n.startsWith('society_'))).toBe(true);
    expect(names).toContain('society_publish_need');
    expect(names).toContain('society_volunteer');
    expect(names).toContain('society_message_worker');
    expect(names).toContain('society_run_autonomy_tick');
    expect(names).toContain('society_auto_select');
  });

  it('returns null for an unknown tool (lets server.ts fall through)', async () => {
    expect(await executeSocietyMcpTool('not_a_tool', {}, c)).toBeNull();
  });

  it('registers a worker from comma-separated capabilities', async () => {
    const res = await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'dev', name: 'Dev', capabilities: 'code, design' },
      c
    );
    const p = json(res!) as { workerId: string; capabilities: { skill: string }[] };
    expect(p.workerId).toBe('dev');
    expect(p.capabilities.map((x) => x.skill)).toEqual(['code', 'design']);
  });

  it('discovers workers filtered by capability', async () => {
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'a', name: 'A', capabilities: 'code' },
      c
    );
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'b', name: 'B', capabilities: 'design' },
      c
    );
    const res = await executeSocietyMcpTool(
      'society_discover_workers',
      { capabilities: 'code' },
      c
    );
    expect((json(res!) as { workerId: string }[]).map((w) => w.workerId)).toEqual(['a']);
  });

  it('runs the full self-organization flow via MCP tools and closes the need', async () => {
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'poster', name: 'Poster', capabilities: 'pm' },
      c
    );
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'dev', name: 'Dev', capabilities: 'code' },
      c
    );
    const need = json(
      (await executeSocietyMcpTool(
        'society_publish_need',
        { posted_by: 'poster', subject: 'X', required_capabilities: 'code' },
        c
      ))!
    ) as { needId: string; status: string };
    expect(need.status).toBe('open');

    expect(
      (
        json(
          (await executeSocietyMcpTool(
            'society_volunteer',
            { need_id: need.needId, worker_id: 'dev' },
            c
          ))!
        ) as { ok: boolean }
      ).ok
    ).toBe(true);
    expect(
      (
        json(
          (await executeSocietyMcpTool('society_select_assignee', { need_id: need.needId }, c))!
        ) as { assignee: string }
      ).assignee
    ).toBe('dev');
    expect(
      (
        json(
          (await executeSocietyMcpTool(
            'society_start_need',
            { need_id: need.needId, worker_id: 'dev' },
            c
          ))!
        ) as { ok: boolean }
      ).ok
    ).toBe(true);
    expect(
      (
        json(
          (await executeSocietyMcpTool(
            'society_deliver_need',
            { need_id: need.needId, result: 'v1' },
            c
          ))!
        ) as { ok: boolean }
      ).ok
    ).toBe(true);
    expect(
      (
        json(
          (await executeSocietyMcpTool('society_accept_delivery', { need_id: need.needId }, c))!
        ) as { ok: boolean }
      ).ok
    ).toBe(true);

    // 全流程结束后，need 经 store 确认为 closed（声誉/关系也已更新落盘）。
    const closed = await c.needs.get(need.needId);
    expect(closed?.status).toBe('closed');
  });

  it('runs an autonomy tick via MCP, making a matching worker self-volunteer', async () => {
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'poster', name: 'Poster', capabilities: 'pm' },
      c
    );
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'dev', name: 'Dev', capabilities: 'code' },
      c
    );
    const need = json(
      (await executeSocietyMcpTool(
        'society_publish_need',
        { posted_by: 'poster', subject: 'X', required_capabilities: 'code' },
        c
      ))!
    ) as { needId: string };

    const out = json((await executeSocietyMcpTool('society_run_autonomy_tick', {}, c))!) as {
      applied: number;
    };
    expect(out.applied).toBeGreaterThanOrEqual(1);

    const need2 = await c.needs.get(need.needId);
    expect(need2?.volunteers.map((v) => v.workerId)).toContain('dev');
  });

  it('auto-selects the best pending volunteer via MCP', async () => {
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'poster', name: 'Poster', capabilities: 'pm' },
      c
    );
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'dev', name: 'Dev', capabilities: 'code' },
      c
    );
    const need = json(
      (await executeSocietyMcpTool(
        'society_publish_need',
        { posted_by: 'poster', subject: 'X', required_capabilities: 'code' },
        c
      ))!
    ) as { needId: string };
    await executeSocietyMcpTool('society_volunteer', { need_id: need.needId, worker_id: 'dev' }, c);

    const out = json((await executeSocietyMcpTool('society_auto_select', {}, c))!) as {
      selected: number;
    };
    expect(out.selected).toBeGreaterThanOrEqual(1);
    expect((await c.needs.get(need.needId))?.status).toBe('assigned');
  });

  it('delivers a worker-to-worker social message', async () => {
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'a', name: 'A', capabilities: 'x' },
      c
    );
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'b', name: 'B', capabilities: 'x' },
      c
    );
    const res = await executeSocietyMcpTool(
      'society_message_worker',
      { from_worker: 'a', to_worker: 'b', text: 'hi' },
      c
    );
    expect((json(res!) as { ok: boolean }).ok).toBe(true);
  });

  it('returns the social feed', async () => {
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'a', name: 'A', capabilities: 'x' },
      c
    );
    await executeSocietyMcpTool(
      'society_register_worker',
      { worker_id: 'b', name: 'B', capabilities: 'x' },
      c
    );
    await executeSocietyMcpTool(
      'society_message_worker',
      { from_worker: 'a', to_worker: 'b', text: 'hi' },
      c
    );
    const res = await executeSocietyMcpTool('society_get_feed', { limit: '5' }, c);
    expect((json(res!) as { text: string }[]).length).toBeGreaterThan(0);
  });
});
