import { describe, expect, it } from 'vitest';

import {
  assistantAgentTypeActions,
  assistantPlatformActions,
  assistantPlatformMeta,
  assistantWecomModeActions,
  isAssistantQrPlatform,
  labelForAssistantAgentType,
  labelForAssistantPlatform,
  mergeAssistantPlatformOptions,
  missingRequiredAssistantFields,
  normalizeAssistantBindProject,
} from '../assistantCreationOptions.mjs';

describe('assistantCreationOptions — shared CLI assistant wizard options', () => {
  it('uses the external runtime choices for the CLI wizard', () => {
    const actions = assistantAgentTypeActions();

    expect(actions.map((action) => action.id)).toContain('claudecode');
    expect(actions.map((action) => action.id)).toContain('codex');
    expect(labelForAssistantAgentType('claudecode')).toBe('Claude Code');
    expect(labelForAssistantAgentType('codex')).toBe('Codex');
  });

  it('uses the external platform choices for the CLI wizard', () => {
    const actions = assistantPlatformActions();

    expect(actions.map((action) => action.id)).toEqual([
      'feishu',
      'weixin',
      'telegram',
      'discord',
      'slack',
      'dingtalk',
      'wecom_im',
      'qq',
      'qqbot',
      'line',
      'weibo',
    ]);
    expect(labelForAssistantPlatform('feishu')).toBe('飞书 / Lark');
    expect(isAssistantQrPlatform('feishu')).toBe(true);
    expect(isAssistantQrPlatform('weixin')).toBe(true);
    expect(isAssistantQrPlatform('telegram')).toBe(false);
  });

  it('keeps Enterprise WeChat sub-modes available to the CLI wizard', () => {
    expect(assistantWecomModeActions().map((action) => action.id)).toEqual(['wecom_ws', 'wecom']);
    expect(labelForAssistantPlatform('wecom_ws')).toBe('企业微信智能机器人');
  });

  it('exposes manual platform fields from the shared external metadata', () => {
    expect(assistantPlatformMeta('telegram')?.fields.map((field) => field.key)).toContain('token');
    expect(assistantPlatformMeta('slack')?.fields.map((field) => field.key)).toEqual([
      'bot_token',
      'app_token',
      'allow_from',
      'allow_chat',
      'session_scope',
      'share_session_in_channel',
    ]);
    expect(assistantPlatformMeta('wecom_ws')?.submitType).toBe('wecom');
    expect(assistantPlatformMeta('wecom_ws')?.defaultOptions).toEqual({ mode: 'websocket' });
  });

  it('merges platform defaults without dropping explicit false or zero', () => {
    const meta = {
      defaultOptions: { enabled: true, retries: 3 },
      fields: [
        { key: 'token', required: true },
        { key: 'enabled', required: false },
      ],
    };
    const options = mergeAssistantPlatformOptions(meta, {
      token: 'secret',
      enabled: false,
      retries: 0,
      optional: '',
    });

    expect(options).toEqual({ enabled: false, retries: 0, token: 'secret' });
    expect(missingRequiredAssistantFields(meta, options)).toEqual([]);
    expect(missingRequiredAssistantFields(meta, { enabled: false })).toEqual(['token']);
  });

  it('normalizes digital worker project ids consistently', () => {
    expect(normalizeAssistantBindProject(' 测试 员工 01 ')).toBe('01');
    expect(normalizeAssistantBindProject('Support Worker')).toBe('support-worker');
    expect(normalizeAssistantBindProject('worker__a')).toBe('worker__a');
  });
});
