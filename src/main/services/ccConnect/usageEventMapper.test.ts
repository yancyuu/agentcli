import { describe, expect, it } from 'vitest';

import type { CcBridgeUsageMessage } from '@shared/types/ccConnect';

import { mapUsageEventToReportInput } from './usageEventMapper';

function feishuUsage(over: Partial<CcBridgeUsageMessage> = {}): CcBridgeUsageMessage {
  return {
    type: 'usage',
    session_key: 'feishu:oc_chat1:ou_user1',
    platform: 'feishu',
    agent_type: 'claudecode',
    input_tokens: 932,
    output_tokens: 587,
    cache_read_input_tokens: 126016,
    cache_creation_input_tokens: 3,
    ts: 1_718_900_000,
    ...over,
  };
}

describe('mapUsageEventToReportInput', () => {
  it('maps token counts, runtime, occurredAt and sessionKey from a usage event', () => {
    const input = mapUsageEventToReportInput(feishuUsage());
    expect(input).not.toBeNull();
    expect(input!.sessionKey).toBe('feishu:oc_chat1:ou_user1');
    expect(input!.runtime).toBe('claudecode');
    expect(input!.metrics).toEqual({
      inputTokens: 932,
      outputTokens: 587,
      cacheReadTokens: 126016,
      cacheCreationTokens: 3,
      totalTokens: 932 + 587 + 126016 + 3,
    });
    // ts is unix seconds → ISO
    expect(input!.occurredAt).toBe(new Date(1_718_900_000 * 1000).toISOString());
  });

  it('returns null when the event has no usable tokens', () => {
    const empty = feishuUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(mapUsageEventToReportInput(empty)).toBeNull();
  });

  it('omits runtime/occurredAt gracefully when absent', () => {
    const input = mapUsageEventToReportInput(feishuUsage({ agent_type: undefined, ts: undefined }));
    expect(input).not.toBeNull();
    expect(input!.runtime).toBeUndefined();
    expect(input!.occurredAt).toBeUndefined();
  });

  it('maps turn_id to turnId so reportTurn dedups by a stable per-turn key', () => {
    const input = mapUsageEventToReportInput(feishuUsage({ turn_id: 'om_msg_123' }));
    expect(input).not.toBeNull();
    expect(input!.turnId).toBe('om_msg_123');
  });

  it('omits turnId when the event carries no turn_id', () => {
    const input = mapUsageEventToReportInput(feishuUsage());
    expect(input).not.toBeNull();
    expect(input!.turnId).toBeUndefined();
  });

  it('maps usage event sender identity when the bridge provides it', () => {
    const input = mapUsageEventToReportInput(
      feishuUsage({ user_id: 'ou_sender', user_name: '张三', chat_name: '产品群' })
    );
    expect(input).not.toBeNull();
    expect(input!.teamName).toBe('');
    expect(input!.userId).toBe('ou_sender');
    expect(input!.userName).toBe('张三');
    expect(input!.chatName).toBe('产品群');
    expect(input!.chatId).toBeUndefined();
  });
});
