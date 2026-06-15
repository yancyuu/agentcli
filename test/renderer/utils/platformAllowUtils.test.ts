import { describe, expect, it } from 'vitest';

import {
  buildFeishuLarkAllowUpdatePayload,
  getFeishuLarkAllowValue,
  getPlatformAllowValue,
  omitEmptyAllowMap,
  readStringRecord,
  withFeishuLarkAllowValue,
  withPlatformAllowValue,
} from '@renderer/components/team/dialogs/platformAllowUtils';

describe('platformAllowUtils', () => {
  it('reads lark-only values for Feishu/Lark fields', () => {
    expect(getFeishuLarkAllowValue({ lark: 'ou_lark' })).toBe('ou_lark');
  });

  it('preserves unrelated platform keys when updating Feishu/Lark values', () => {
    expect(withFeishuLarkAllowValue({ telegram: '123', lark: 'ou_old' }, 'ou_new')).toEqual({
      telegram: '123',
      lark: 'ou_new',
    });
  });

  it('omits empty maps instead of sending overwrite payloads', () => {
    expect(omitEmptyAllowMap(withFeishuLarkAllowValue({}, ''))).toBeUndefined();
    expect(buildFeishuLarkAllowUpdatePayload({}, '')).toBeUndefined();
  });

  it('emits explicit delete markers when existing Feishu/Lark fields are blanked', () => {
    expect(buildFeishuLarkAllowUpdatePayload({ feishu: 'ou_old' }, '')).toEqual({
      feishu: '',
      lark: '',
    });
    expect(buildFeishuLarkAllowUpdatePayload({ telegram: '123', lark: 'ou_old' }, '')).toEqual({
      telegram: '123',
      feishu: '',
      lark: '',
    });
  });

  it('prefers lark when both Feishu/Lark aliases exist', () => {
    expect(getFeishuLarkAllowValue({ feishu: 'ou_legacy', lark: 'ou_current' })).toBe(
      'ou_current'
    );
    expect(withFeishuLarkAllowValue({ feishu: 'ou_legacy', lark: 'ou_current' }, 'ou_new')).toEqual({
      lark: 'ou_new',
    });
  });

  it('keeps unrelated keys when Feishu/Lark fields are blank', () => {
    expect(withFeishuLarkAllowValue({ telegram: '123', feishu: 'ou_old' }, '')).toEqual({
      telegram: '123',
    });
  });

  it('reads generic platform allow aliases for Feishu/Lark and WeChat/Weixin', () => {
    expect(getPlatformAllowValue({ lark: 'ou_lark' }, 'feishu')).toBe('ou_lark');
    expect(getPlatformAllowValue({ feishu: 'ou_feishu' }, 'lark')).toBe('ou_feishu');
    expect(getPlatformAllowValue({ wechat: 'wx_user' }, 'weixin')).toBe('wx_user');
    expect(getPlatformAllowValue({ weixin: 'wx_user' }, 'wechat')).toBe('wx_user');
  });

  it('updates platform allow aliases without creating duplicate sibling keys', () => {
    expect(withPlatformAllowValue({ telegram: '123', lark: 'old' }, 'feishu', 'new')).toEqual({
      telegram: '123',
      lark: 'new',
    });
    expect(withPlatformAllowValue({ telegram: '123', wechat: 'old' }, 'weixin', '')).toEqual({
      telegram: '123',
    });
  });

  it('normalizes string records and drops empty values', () => {
    expect(readStringRecord({ feishu: '  ou_1  ', empty: ' ', bad: 1 })).toEqual({
      feishu: 'ou_1',
    });
  });
});
