/**
 * Platform metadata for cc-connect platform binding forms.
 * Mirrors ~/code/cc-connect/web/src/lib/platformMeta.ts
 */

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'password' | 'number' | 'boolean';
  placeholder?: string;
  hint?: string;
  group?: 'basic' | 'advanced';
}

export interface PlatformMeta {
  label: string;
  fields: FieldDef[];
}

export const platformMeta: Record<string, PlatformMeta> = {
  telegram: {
    label: 'Telegram',
    fields: [
      {
        key: 'token',
        label: 'Bot Token',
        required: true,
        type: 'password',
        placeholder: '123456:ABC-DEF...',
      },
      {
        key: 'allow_from',
        label: 'Allow From',
        placeholder: '* (all)',
        group: 'advanced',
        hint: '限制可交互的用户/群，* 表示所有',
      },
      { key: 'group_reply_all', label: '群聊回复全部', type: 'boolean', group: 'advanced' },
      { key: 'share_session_in_channel', label: '共享群会话', type: 'boolean', group: 'advanced' },
    ],
  },
  discord: {
    label: 'Discord',
    fields: [
      { key: 'token', label: 'Bot Token', required: true, type: 'password' },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
      {
        key: 'guild_id',
        label: 'Guild ID',
        placeholder: '',
        group: 'advanced',
        hint: '限定特定服务器',
      },
      { key: 'group_reply_all', label: '群聊回复全部', type: 'boolean', group: 'advanced' },
      {
        key: 'share_session_in_channel',
        label: '共享频道会话',
        type: 'boolean',
        group: 'advanced',
      },
      { key: 'thread_isolation', label: 'Thread 隔离', type: 'boolean', group: 'advanced' },
    ],
  },
  slack: {
    label: 'Slack',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot Token',
        required: true,
        type: 'password',
        placeholder: 'xoxb-...',
      },
      {
        key: 'app_token',
        label: 'App Token',
        required: true,
        type: 'password',
        placeholder: 'xapp-...',
      },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
      {
        key: 'share_session_in_channel',
        label: '共享频道会话',
        type: 'boolean',
        group: 'advanced',
      },
    ],
  },
  dingtalk: {
    label: 'DingTalk',
    fields: [
      { key: 'client_id', label: 'Client ID', required: true },
      { key: 'client_secret', label: 'Client Secret', required: true, type: 'password' },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
      { key: 'share_session_in_channel', label: '共享群会话', type: 'boolean', group: 'advanced' },
    ],
  },
  wecom: {
    label: '企业微信',
    fields: [
      { key: 'corp_id', label: 'Corp ID', required: true },
      { key: 'corp_secret', label: 'Corp Secret', required: true, type: 'password' },
      { key: 'agent_id', label: 'Agent ID', required: true, placeholder: '1000002' },
      { key: 'callback_token', label: 'Callback Token', required: true },
      {
        key: 'callback_aes_key',
        label: 'Callback AES Key',
        required: true,
        hint: '43 位 AES 密钥',
      },
      { key: 'port', label: '端口', required: true, placeholder: '8081' },
      {
        key: 'callback_path',
        label: 'Callback Path',
        placeholder: '/wecom/callback',
        group: 'advanced',
      },
      {
        key: 'api_base_url',
        label: 'API Base URL',
        placeholder: 'https://qyapi.weixin.qq.com',
        group: 'advanced',
      },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
    ],
  },
  qq: {
    label: 'QQ (OneBot v11)',
    fields: [
      { key: 'ws_url', label: 'WebSocket URL', required: true, placeholder: 'ws://127.0.0.1:3001' },
      { key: 'token', label: 'Access Token', type: 'password', group: 'advanced' },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
      { key: 'share_session_in_channel', label: '共享群会话', type: 'boolean', group: 'advanced' },
    ],
  },
  qqbot: {
    label: 'QQ Bot (官方)',
    fields: [
      { key: 'app_id', label: 'App ID', required: true },
      { key: 'app_secret', label: 'App Secret', required: true, type: 'password' },
      { key: 'sandbox', label: '沙盒模式', type: 'boolean', group: 'advanced' },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
      { key: 'share_session_in_channel', label: '共享群会话', type: 'boolean', group: 'advanced' },
    ],
  },
  line: {
    label: 'LINE',
    fields: [
      { key: 'channel_secret', label: 'Channel Secret', required: true, type: 'password' },
      { key: 'channel_token', label: 'Channel Token', required: true, type: 'password' },
      { key: 'port', label: '端口', required: true, placeholder: '8080' },
      { key: 'callback_path', label: 'Callback Path', placeholder: '/callback', group: 'advanced' },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
    ],
  },
  weibo: {
    label: '微博',
    fields: [
      { key: 'app_id', label: 'App ID', required: true, placeholder: '1234567890' },
      { key: 'app_secret', label: 'App Secret', required: true, type: 'password' },
      { key: 'allow_from', label: 'Allow From', placeholder: '* (all)', group: 'advanced' },
    ],
  },
};

// Platforms that support QR code setup (vs manual credential entry)
export const QR_PLATFORMS = ['feishu', 'lark', 'weixin'] as const;

export function isQRPlatform(type: string): boolean {
  return QR_PLATFORMS.includes(type as (typeof QR_PLATFORMS)[number]);
}
