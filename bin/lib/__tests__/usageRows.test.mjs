import { describe, expect, it } from 'vitest';

import { localServerRows } from '../usageRows.mjs';

describe('usageRows', () => {
  it('renders local, server, and pending rows with aligned session/message/token dimensions', () => {
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
      ['本地', '会话 1.8K · 消息 196.1K · Token 9836.3M', 'info'],
      ['服务端', '会话 384 · 消息 64.5K · Token 5706.2M', 'info'],
      ['待上报', '会话 1.4K · 消息 131.6K · Token 4130.1M', 'warn'],
    ]);
  });

  it('still supports legacy top-level server counters', () => {
    expect(
      localServerRows(
        { sessions: 10, messages: 20, totalTokens: 30 },
        { ok: true, sessions: 4, messages: 5, totalTokens: 6 }
      )
    ).toEqual([
      ['本地', '会话 10 · 消息 20 · Token 30', 'info'],
      ['服务端', '会话 4 · 消息 5 · Token 6', 'info'],
      ['待上报', '会话 6 · 消息 15 · Token 24', 'warn'],
    ]);
  });
});
