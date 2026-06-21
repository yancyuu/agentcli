import { describe, expect, it } from 'vitest';

import {
  isExternalPlatformName,
  isExternalPlatformSessionKey,
  parseExternalPlatformSessionKey,
} from './externalPlatformSessionKey';

describe('parseExternalPlatformSessionKey', () => {
  it('classifies every cc-connect IM platform as external-platform', () => {
    // The allowlist must match cc-connect's real platform set, not a feishu-only
    // subset. dingtalk / line / qq previously fell through to 'unknown' and were
    // silently dropped by the usage reporter.
    for (const platform of [
      'feishu',
      'lark',
      'weixin',
      'wechat',
      'telegram',
      'discord',
      'slack',
      'dingtalk',
      'line',
      'qq',
    ]) {
      expect(parseExternalPlatformSessionKey(`${platform}:oc_c:ou_u`).kind).toBe(
        'external-platform'
      );
      expect(isExternalPlatformName(platform)).toBe(true);
    }
  });

  it('parses feishu chatId/userId by their id prefixes', () => {
    const parts = parseExternalPlatformSessionKey('feishu:oc_chat1:ou_user1');
    expect(parts).toMatchObject({
      platform: 'feishu',
      chatId: 'oc_chat1',
      userId: 'ou_user1',
      kind: 'external-platform',
    });
  });

  it('falls back to positional ids for numeric-id platforms (telegram/discord/qq/line)', () => {
    for (const [key, chatId, userId] of [
      ['telegram:12345:67890', '12345', '67890'],
      ['discord:999:888', '999', '888'],
      ['qq:111:222', '111', '222'],
      ['line:333:444', '333', '444'],
    ] as const) {
      const parts = parseExternalPlatformSessionKey(key);
      expect(parts.kind).toBe('external-platform');
      expect(parts.chatId).toBe(chatId);
      expect(parts.userId).toBe(userId);
    }
  });

  it('classifies hermit as hermit-local and unknown platforms as unknown', () => {
    expect(parseExternalPlatformSessionKey('hermit:abc').kind).toBe('hermit-local');
    expect(parseExternalPlatformSessionKey('random:abc:def').kind).toBe('unknown');
    expect(isExternalPlatformSessionKey('random:abc:def')).toBe(false);
  });
});
