/**
 * CrossTeamMessageGateway 测试 —— 消息持久化 + cross-team 协议兼容（TDD 先行）。
 *
 * 关键不变量：
 *   - send 持久化到 messages.jsonl 并返回 delivered。
 *   - formatted 文本可被 hermit 的 parseCrossTeamPrefix 回解析 → 与既有消息总线兼容。
 *   - recent(n) 返回按发送顺序的最后 n 条；跨实例可从磁盘重载（前端活动流所需）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCrossTeamPrefix } from '@shared/constants/crossTeam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeClock } from '../../core/application/fakes';
import { CrossTeamMessageGateway } from './crossTeamMessageGateway';

describe('CrossTeamMessageGateway', () => {
  let root: string;
  let clock: FakeClock;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-msg-'));
    clock = new FakeClock('2026-06-13T10:00:00.000Z');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('send returns delivered:true and records the message', async () => {
    const gw = new CrossTeamMessageGateway(root, clock);
    const res = await gw.send({ fromWorker: 'a', toWorker: 'b', text: 'hi' });
    expect(res.delivered).toBe(true);
    const recent = await gw.recent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ fromWorker: 'a', toWorker: 'b', text: 'hi' });
  });

  it('formats the payload with the hermit cross-team prefix (protocol-compatible)', async () => {
    const gw = new CrossTeamMessageGateway(root, clock);
    await gw.send({ fromWorker: 'alice', toWorker: 'bob', text: 'need a hand?' });
    const [m] = await gw.recent(1);
    const parsed = parseCrossTeamPrefix(m.formatted);
    expect(parsed?.from).toBe('alice');
    expect(parsed?.chainDepth).toBe(0);
    expect(m.formatted).toContain('need a hand?');
  });

  it('preserves needId when present', async () => {
    const gw = new CrossTeamMessageGateway(root, clock);
    await gw.send({ fromWorker: 'a', toWorker: 'b', text: 't', needId: 'need-1' });
    expect((await gw.recent(1))[0].needId).toBe('need-1');
  });

  it('accumulates messages in send order; recent(n) returns the last n', async () => {
    const gw = new CrossTeamMessageGateway(root, clock);
    await gw.send({ fromWorker: 'a', toWorker: 'b', text: '1' });
    await gw.send({ fromWorker: 'a', toWorker: 'b', text: '2' });
    await gw.send({ fromWorker: 'a', toWorker: 'b', text: '3' });
    expect((await gw.recent(2)).map((m) => m.text)).toEqual(['2', '3']);
  });

  it('returns empty before any message is sent', async () => {
    const gw = new CrossTeamMessageGateway(root, clock);
    expect(await gw.recent(10)).toEqual([]);
  });

  it('persists across instances (reload feed from disk)', async () => {
    const a = new CrossTeamMessageGateway(root, clock);
    await a.send({ fromWorker: 'a', toWorker: 'b', text: 'persist me' });
    const b = new CrossTeamMessageGateway(root, clock);
    expect((await b.recent(10)).map((m) => m.text)).toEqual(['persist me']);
  });

  it('stamps deliveredAt from the injected clock', async () => {
    const gw = new CrossTeamMessageGateway(root, clock);
    await gw.send({ fromWorker: 'a', toWorker: 'b', text: 'hi' });
    expect((await gw.recent(1))[0].deliveredAt).toBe('2026-06-13T10:00:00.000Z');
  });
});
