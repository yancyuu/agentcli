import { describe, expect, it } from 'vitest';

import { cursorPendingRows, localServerRows } from '../usageRows.mjs';

describe('usageRows', () => {
  it('renders local and server message/token rows without deriving pending from ledger delta', () => {
    expect(
      localServerRows(
        { sessions: 1810, messages: 196107, totalTokens: 9836330316 },
        {
          ok: true,
          totals: {
            sessions: 384,
            messages: 64511,
            totalTokens: 5706241053,
          },
        }
      )
    ).toEqual([
      ['本地', '消息 196.1K · Token 9836.3M', 'info'],
      ['服务端', '消息 64.5K · Token 5706.2M', 'info'],
    ]);
  });

  it('renders cursor-derived pending rows from upload scan state', () => {
    expect(cursorPendingRows({ pending: 12 })).toEqual([['待上报', '消息 12', 'warn']]);
    expect(cursorPendingRows({ pending: 0 })).toEqual([['待上报', '无', 'info']]);
    expect(cursorPendingRows({ pending: 0, lastError: 'network down' })).toEqual([
      ['待上报', '扫描失败：network down', 'error'],
    ]);
    expect(cursorPendingRows(undefined)).toEqual([]);
  });

  it('renders pending from upload.pending only and never from local/server token deltas', () => {
    const local = { sessions: 1810, messages: 196107, totalTokens: 9836330316 };
    const server = {
      ok: true,
      totals: {
        sessions: 384,
        messages: 64511,
        totalTokens: 5706241053,
      },
    };

    expect([...localServerRows(local, server), ...cursorPendingRows({ pending: 7 })]).toEqual([
      ['本地', '消息 196.1K · Token 9836.3M', 'info'],
      ['服务端', '消息 64.5K · Token 5706.2M', 'info'],
      ['待上报', '消息 7', 'warn'],
    ]);
  });

  it('still supports legacy top-level server counters', () => {
    expect(
      localServerRows(
        { sessions: 10, messages: 20, totalTokens: 30 },
        { ok: true, sessions: 4, messages: 5, totalTokens: 6 }
      )
    ).toEqual([
      ['本地', '消息 20 · Token 30', 'info'],
      ['服务端', '消息 5 · Token 6', 'info'],
    ]);
  });

  it('only renders server zero usage when zero is explicitly reported', () => {
    expect(localServerRows({ messages: 0, totalTokens: 0 }, { ok: true, totals: {} })).toEqual([
      ['本地', '消息 0 · Token 0', 'info'],
    ]);
    expect(localServerRows({ messages: 0, totalTokens: 0 }, { ok: true, totals: { messages: 0 } })).toEqual([
      ['本地', '消息 0 · Token 0', 'info'],
      ['服务端', '消息 0', 'info'],
    ]);
  });

  it('does not invent pending zero when upload pending is missing', () => {
    expect(cursorPendingRows({})).toEqual([]);
    expect(cursorPendingRows({ pending: undefined })).toEqual([]);
  });
});
