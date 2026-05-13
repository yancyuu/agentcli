import * as Lark from '@larksuiteoapi/node-sdk';
import { getAppDataPath, getTeamsBasePath } from '@main/utils/pathDecoder';
import { CANONICAL_LEAD_MEMBER_NAME, isLeadMember } from '@shared/utils/leadDetection';
import { createLogger } from '@shared/utils/logger';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { atomicWriteAsync } from './atomicWrite';
import { withFileLock } from './fileLock';
import { TeamConfigReader } from './TeamConfigReader';
import { TeamInboxWriter } from './TeamInboxWriter';

import type {
  GlobalLeadChannelSnapshot,
  LeadChannelConfig,
  LeadChannelDefinition,
  LeadChannelSnapshot,
  LeadChannelStatus,
  SaveLeadChannelConfigRequest,
} from '@shared/types';

const logger = createLogger('Service:LeadChannelListener');

const DEFAULT_CONFIG: LeadChannelConfig = {
  channels: [],
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
  },
};

const CHANNEL_EVENT_LEDGER_MAX_ENTRIES = 2000;
const CHANNEL_EVENT_PROCESSING_STALE_MS = 10 * 60 * 1000;
const FEISHU_REPLY_DEDUPE_TTL_MS = 2 * 60 * 1000;
const GLOBAL_CHANNEL_STATUS_OWNER = '__global__';

interface LeadChannelEventLedgerEntry {
  eventKey: string;
  status: 'processing' | 'handled';
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
  channelId: string;
  messageId: string;
}

interface RecentFeishuTarget {
  provider: 'feishu';
  channelId: string;
  channelName?: string;
  chatId: string;
  senderId?: string;
  observedAt: string;
}

export interface LeadChannelInboundMessage {
  channelId: string;
  channelName: string;
  provider: 'feishu';
  chatId: string;
  senderId: string;
  messageId?: string;
  text: string;
  from: string;
}

interface FeishuMessageEventRow {
  message?: {
    content?: string;
    message_type?: string;
    chat_id?: string;
    message_id?: string;
    create_time?: string;
  };
  sender?: {
    sender_id?: Record<string, string>;
    sender_type?: string;
  };
}

function deduplicateId(base: string, seen: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (seen.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}

function cloneDefaultConfig(): LeadChannelConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as LeadChannelConfig;
}

function createStoppedStatus(
  message: string | null = null,
  channel?: Pick<LeadChannelDefinition, 'id' | 'name'>
): LeadChannelStatus {
  return {
    running: false,
    state: 'stopped',
    message,
    startedAt: null,
    lastEventAt: null,
    channelId: channel?.id,
    channelName: channel?.name,
  };
}

function getLeadChannelConfigPath(teamName: string): string {
  return path.join(getTeamsBasePath(), teamName, 'lead-channel.json');
}

function getLeadChannelEventLedgerPath(teamName: string): string {
  return path.join(getTeamsBasePath(), teamName, 'lead-channel-events.json');
}

function getGlobalLeadChannelConfigPath(): string {
  return path.join(getAppDataPath(), 'lead-channels.json');
}

function normalizeConfig(input: unknown): LeadChannelConfig {
  const parsed = input && typeof input === 'object' ? (input as Partial<LeadChannelConfig>) : {};
  const feishu =
    parsed.feishu && typeof parsed.feishu === 'object'
      ? (parsed.feishu as Partial<LeadChannelConfig['feishu']>)
      : {};
  const legacyFeishu = {
    enabled: feishu.enabled === true,
    appId: typeof feishu.appId === 'string' ? feishu.appId.trim() : '',
    appSecret: typeof feishu.appSecret === 'string' ? feishu.appSecret.trim() : '',
  };
  const seenChannelIds = new Set<string>();
  const channels: LeadChannelDefinition[] = Array.isArray(parsed.channels)
    ? parsed.channels
        .map((channel): LeadChannelDefinition | null => {
          if (!channel || typeof channel !== 'object') return null;
          const row = channel as Partial<LeadChannelConfig['channels'][number]>;
          const provider = row.provider === 'webhook' ? 'webhook' : 'feishu';
          const rawId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : provider;
          const id = deduplicateId(rawId, seenChannelIds);
          const name =
            typeof row.name === 'string' && row.name.trim()
              ? row.name.trim()
              : provider === 'feishu'
                ? '飞书长连接'
                : '通用 Webhook';
          return {
            id,
            name,
            provider,
            enabled: row.enabled !== false,
            boundTeam:
              typeof row.boundTeam === 'string' && row.boundTeam.trim()
                ? row.boundTeam.trim()
                : undefined,
            feishu: row.feishu ? normalizeConfig({ feishu: row.feishu }).feishu : undefined,
          };
        })
        .filter((channel): channel is LeadChannelDefinition => channel !== null)
    : [];
  if (channels.length === 0 && (legacyFeishu.appId || legacyFeishu.appSecret)) {
    const legacyId = seenChannelIds.has('feishu-default')
      ? `feishu-default-${seenChannelIds.size + 1}`
      : 'feishu-default';
    seenChannelIds.add(legacyId);
    channels.push({
      id: legacyId,
      name: '飞书长连接',
      provider: 'feishu',
      enabled: legacyFeishu.enabled !== false,
      feishu: legacyFeishu,
    });
  }
  return { channels, feishu: legacyFeishu };
}

function getFeishuEventRow(event: unknown): FeishuMessageEventRow {
  const root = event && typeof event === 'object' ? (event as Record<string, unknown>) : {};
  const nested = root.event;
  if (nested && typeof nested === 'object') {
    const nestedRow = nested as FeishuMessageEventRow;
    if (nestedRow.message || nestedRow.sender) {
      return nestedRow;
    }
  }
  return root as FeishuMessageEventRow;
}

function extractFeishuText(event: unknown): string {
  const row = getFeishuEventRow(event);
  const rawContent = row.message?.content;
  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
    return `[飞书事件] 收到 ${row.message?.message_type ?? '未知'} 类型消息。`;
  }
  try {
    const parsed = JSON.parse(rawContent) as { text?: unknown };
    if (typeof parsed.text === 'string' && parsed.text.trim()) {
      return parsed.text.trim();
    }
  } catch {
    // Fall through to raw payload.
  }
  return rawContent;
}

function assertFeishuApiResponseOk(response: unknown, action: string): string | null {
  if (!response || typeof response !== 'object') {
    return null;
  }
  const row = response as {
    code?: unknown;
    msg?: unknown;
    data?: { message_id?: unknown };
  };
  if (typeof row.code === 'number' && row.code !== 0) {
    const message =
      typeof row.msg === 'string' && row.msg.trim() ? row.msg.trim() : 'unknown error';
    throw new Error(`${action} failed: code=${row.code}, msg=${message}`);
  }
  return typeof row.data?.message_id === 'string' ? row.data.message_id : null;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function getStringAtPath(value: unknown, pathParts: string[]): string | null {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null;
}

function buildFeishuInboundMessageId(input: {
  channelId: string;
  event: unknown;
  chatId: string;
  senderId: string;
  text: string;
}): string {
  const directMessageId =
    getStringAtPath(input.event, ['message', 'message_id']) ??
    getStringAtPath(input.event, ['event', 'message', 'message_id']);
  if (directMessageId) {
    return `${input.channelId}:${directMessageId}`;
  }

  const eventId =
    getStringAtPath(input.event, ['event_id']) ??
    getStringAtPath(input.event, ['header', 'event_id']);
  if (eventId) {
    return `${input.channelId}:event:${eventId}`;
  }

  const createTime =
    getStringAtPath(input.event, ['message', 'create_time']) ??
    getStringAtPath(input.event, ['event', 'message', 'create_time']);
  const timeBucket = createTime || String(Math.floor(Date.now() / (5 * 60 * 1000)));
  return `${input.channelId}:fallback:${shortHash(
    [input.chatId, input.senderId, timeBucket, input.text].join('\n')
  )}`;
}

function buildFeishuLeadMessageText(input: {
  channelName: string;
  channelId: string;
  chatId: string;
  senderId: string;
  text: string;
}): string {
  return [
    '【飞书消息】负责人请处理这条来自飞书的外部消息。',
    `渠道：${input.channelName} (${input.channelId})`,
    `飞书会话：${input.chatId}`,
    `飞书用户ID：${input.senderId}`,
    `发送者：${input.senderId}`,
    '',
    input.text,
  ].join('\n');
}

export class LeadChannelListenerService {
  private readonly inboxWriter = new TeamInboxWriter();
  private readonly configReader = new TeamConfigReader();
  private readonly wsClientByChannel = new Map<string, InstanceType<typeof Lark.WSClient>>();
  private readonly apiClientByChannel = new Map<string, InstanceType<typeof Lark.Client>>();
  private readonly channelConfigSignatureByKey = new Map<string, string>();
  private readonly senderNameCache = new Map<string, { name: string; fetchedAt: number }>();
  private static readonly SENDER_CACHE_TTL = 30 * 60 * 1000; // 30 min
  private readonly channelBindings = new Map<string, Set<string>>();
  private readonly statusByTeamChannel = new Map<string, Map<string, LeadChannelStatus>>();
  private readonly connectingHintTimerByTeamChannel = new Map<string, NodeJS.Timeout>();
  private readonly recentFeishuTargetByTeam = new Map<string, RecentFeishuTarget>();
  private readonly feishuReplyDedupe = new Map<string, number>();
  private inboundMessageHandler:
    | ((teamName: string, message: LeadChannelInboundMessage) => boolean | Promise<boolean>)
    | null = null;

  setInboundMessageHandler(
    handler:
      | ((teamName: string, message: LeadChannelInboundMessage) => boolean | Promise<boolean>)
      | null
  ): void {
    this.inboundMessageHandler = handler;
  }

  async getSnapshot(teamName: string): Promise<LeadChannelSnapshot> {
    return {
      config: await this.readConfig(teamName),
      status: this.getStatus(teamName),
      statusesByChannel: this.getStatusesByChannel(teamName),
    };
  }

  async getGlobalSnapshot(): Promise<GlobalLeadChannelSnapshot> {
    return {
      config: await this.readGlobalConfig(),
      statusesByChannel: this.getStatusesByChannel(GLOBAL_CHANNEL_STATUS_OWNER),
    };
  }

  async saveGlobalConfig(
    request: SaveLeadChannelConfigRequest
  ): Promise<GlobalLeadChannelSnapshot> {
    const config = normalizeConfig(request);
    await this.stopRemovedOrReconfiguredFeishuChannels(config);
    const configPath = getGlobalLeadChannelConfigPath();
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await atomicWriteAsync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return this.getGlobalSnapshot();
  }

  async saveConfig(
    teamName: string,
    request: SaveLeadChannelConfigRequest
  ): Promise<LeadChannelSnapshot> {
    const config = normalizeConfig(request);
    const configPath = getLeadChannelConfigPath(teamName);
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await atomicWriteAsync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return this.getSnapshot(teamName);
  }

  async autoStartEnabledFeishuChannels(): Promise<{
    started: string[];
    failed: { channelId: string; message: string }[];
  }> {
    const globalConfig = await this.readGlobalConfig();
    const started: string[] = [];
    const failed: { channelId: string; message: string }[] = [];

    for (const channel of globalConfig.channels) {
      if (channel.provider !== 'feishu' || channel.enabled === false) {
        continue;
      }
      const statusOwner = channel.boundTeam ?? GLOBAL_CHANNEL_STATUS_OWNER;
      try {
        await this.startFeishu(channel.id);
        started.push(channel.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ channelId: channel.id, message });
        this.clearConnectingHint(statusOwner, channel.id);
        this.setStatus(statusOwner, channel.id, {
          running: false,
          state: 'error',
          message: `自动连接失败：${message}`,
          startedAt: null,
          lastEventAt: null,
          channelId: channel.id,
          channelName: channel.name,
        });
        logger.warn(`[${statusOwner}/${channel.id}] Feishu auto-start failed: ${message}`);
      }
    }

    return { started, failed };
  }

  async startFeishu(channelId: string): Promise<LeadChannelSnapshot | null> {
    const globalConfig = await this.readGlobalConfig();
    const channel = globalConfig.channels.find(
      (c) => c.id === channelId && c.provider === 'feishu'
    );
    if (!channel) {
      throw new Error(`未找到飞书渠道实例 "${channelId}"。`);
    }
    const boundTeam = channel.boundTeam;
    const statusOwner = boundTeam ?? GLOBAL_CHANNEL_STATUS_OWNER;
    const feishuConfig = channel.feishu ?? globalConfig.feishu;
    const appId = feishuConfig.appId.trim();
    const appSecret = feishuConfig.appSecret.trim();
    if (!appId || !appSecret) {
      throw new Error(`飞书渠道实例 "${channelId}" 缺少 App ID 或 App Secret。`);
    }

    const key = this.getChannelKey(channelId);
    const configSignature = this.buildFeishuChannelConfigSignature(channel, appId, appSecret);
    if (this.wsClientByChannel.has(key)) {
      if (this.channelConfigSignatureByKey.get(key) === configSignature) {
        return boundTeam ? this.getSnapshot(boundTeam) : null;
      }
      this.closeFeishuChannelRuntime(key);
    }

    this.clearConnectingHint(statusOwner, channel.id);
    this.setStatus(statusOwner, channel.id, {
      running: true,
      state: 'connecting',
      message: `正在连接 ${channel.name}...`,
      startedAt: new Date().toISOString(),
      lastEventAt: null,
      channelId: channel.id,
      channelName: channel.name,
    });
    this.scheduleConnectingHint(statusOwner, channel);

    const wsClient = new Lark.WSClient({
      appId,
      appSecret,
      loggerLevel: Lark.LoggerLevel.info,
      autoReconnect: true,
      source: 'hermit',
      onReady: () => {
        this.clearConnectingHint(statusOwner, channel.id);
        this.patchStatus(statusOwner, channel.id, {
          running: true,
          state: 'connected',
          message: `${channel.name} 已连接。`,
        });
      },
      onReconnecting: () => {
        this.patchStatus(statusOwner, channel.id, {
          running: true,
          state: 'reconnecting',
          message: `${channel.name} 重连中...`,
        });
      },
      onReconnected: () => {
        this.clearConnectingHint(statusOwner, channel.id);
        this.patchStatus(statusOwner, channel.id, {
          running: true,
          state: 'connected',
          message: `${channel.name} 已重新连接。`,
        });
      },
      onError: (error) => {
        this.clearConnectingHint(statusOwner, channel.id);
        this.patchStatus(statusOwner, channel.id, {
          running: false,
          state: 'error',
          message: error.message,
        });
        logger.error(`[${statusOwner}/${channel.id}] Feishu WS error:`, error);
      },
    });
    const apiClient = new Lark.Client({ appId, appSecret });

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        const event = getFeishuEventRow(data);
        const senderType = event.sender?.sender_type;
        if (senderType === 'app') {
          return;
        }
        const text = extractFeishuText(data);
        const chatId = event.message?.chat_id ?? 'unknown-chat';
        const senderId =
          event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id ?? 'unknown-sender';
        const messageId = buildFeishuInboundMessageId({
          channelId: channel.id,
          event: data,
          chatId,
          senderId,
          text,
        });
        const leadMessageText = buildFeishuLeadMessageText({
          channelName: channel.name,
          channelId: channel.id,
          chatId,
          senderId,
          text,
        });
        const inboundMessage: LeadChannelInboundMessage = {
          channelId: channel.id,
          channelName: channel.name,
          provider: 'feishu',
          chatId,
          senderId,
          messageId,
          text: leadMessageText,
          from: `${channel.name}:${senderId}`,
        };
        const eventClaim = await this.claimInboundEvent(statusOwner, channel.id, inboundMessage);
        if (!eventClaim.shouldProcess) {
          this.patchStatus(statusOwner, channel.id, {
            running: true,
            state: 'connected',
            message: `${channel.name} 已忽略飞书重复消息。`,
            lastEventAt: new Date().toISOString(),
          });
          return;
        }
        const targetTeam = boundTeam ?? (await this.resolveMentionedTeamName(text));
        if (!targetTeam) {
          await apiClient.im.message
            .create({
              params: { receive_id_type: 'chat_id' },
              data: {
                receive_id: chatId,
                content: JSON.stringify({
                  text: '请在消息开头 @ 一个团队，或使用 /team 团队名，例如：@内容生成小分队 请处理这个需求。',
                }),
                msg_type: 'text',
              },
            })
            .catch((error: unknown) => {
              logger.warn(
                `[${statusOwner}/${channel.id}] Failed to send team routing hint: ${String(error)}`
              );
            });
          if (eventClaim.eventKey) {
            await this.markInboundEventHandled(statusOwner, eventClaim.eventKey);
          }
          this.patchStatus(statusOwner, channel.id, {
            running: true,
            state: 'connected',
            message: `${channel.name} 已接收消息，等待用户 @ 团队。`,
            lastEventAt: new Date().toISOString(),
          });
          return;
        }
        this.rememberRecentFeishuTarget(targetTeam, {
          provider: 'feishu',
          channelId: channel.id,
          channelName: channel.name,
          chatId,
          senderId,
          observedAt: new Date().toISOString(),
        });
        const deliveredDirect =
          (await Promise.resolve(this.inboundMessageHandler?.(targetTeam, inboundMessage)).catch(
            (error: unknown) => {
              logger.warn(
                `[${targetTeam}/${channel.id}] Direct channel delivery failed: ${String(error)}`
              );
              return false;
            }
          )) === true;
        const leadName = await this.resolveLeadName(targetTeam);
        if (!deliveredDirect) {
          await this.inboxWriter.sendMessage(targetTeam, {
            member: leadName,
            to: leadName,
            from: 'user',
            text: leadMessageText,
            messageId: inboundMessage.messageId,
            source: 'inbox',
            externalChannel: {
              provider: 'feishu',
              channelId: channel.id,
              channelName: channel.name,
              chatId,
              senderId,
            },
          });
        }
        if (eventClaim.eventKey) {
          await this.markInboundEventHandled(statusOwner, eventClaim.eventKey);
        }
        this.patchStatus(statusOwner, channel.id, {
          running: true,
          state: 'connected',
          message: deliveredDirect
            ? `${channel.name} 已接收消息并直达负责人。`
            : `${channel.name} 已接收消息并转入负责人。`,
          lastEventAt: new Date().toISOString(),
        });
      },
    });

    this.wsClientByChannel.set(key, wsClient);
    this.apiClientByChannel.set(key, apiClient);
    this.channelConfigSignatureByKey.set(key, configSignature);
    await wsClient.start({ eventDispatcher });
    return boundTeam ? this.getSnapshot(boundTeam) : null;
  }

  async sendFeishuReply(
    channelId: string,
    chatId: string,
    text: string,
    options: { dedupeKey?: string } = {}
  ): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      logger.warn(`[${channelId}] skipped empty Feishu reply to chat ${chatId}`);
      return;
    }
    const dedupeKey =
      options.dedupeKey?.trim() || `${channelId}:${chatId}:text:${shortHash(normalizedText)}`;
    if (this.isRecentDuplicateFeishuReply(dedupeKey)) {
      logger.warn(`[${channelId}] skipped duplicate Feishu reply key=${dedupeKey}`);
      return;
    }

    const client = await this.getFeishuApiClient(channelId);
    const globalConfig = await this.readGlobalConfig();
    const channel = globalConfig.channels.find((c) => c.id === channelId);
    const boundTeam = channel?.boundTeam;
    const statusOwner = boundTeam ?? GLOBAL_CHANNEL_STATUS_OWNER;
    let messageId: string | null = null;
    try {
      const response = await client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text: normalizedText }),
          msg_type: 'text',
        },
      });
      messageId = assertFeishuApiResponseOk(response, 'send Feishu reply');
    } catch (error) {
      this.feishuReplyDedupe.delete(dedupeKey);
      throw error;
    }
    logger.info(
      `[${statusOwner}/${channelId}] Feishu reply sent to chat ${chatId}${
        messageId ? ` (messageId=${messageId})` : ''
      }`
    );
    this.patchStatus(statusOwner, channelId, {
      running: true,
      state: 'connected',
      message: '负责人回复已发送到飞书。',
      lastEventAt: new Date().toISOString(),
    });
  }

  async sendToRecentFeishuTarget(teamName: string, text: string): Promise<boolean> {
    const target = this.recentFeishuTargetByTeam.get(teamName);
    if (!target) {
      return false;
    }
    await this.sendFeishuReply(target.channelId, target.chatId, text);
    return true;
  }

  private rememberRecentFeishuTarget(teamName: string, target: RecentFeishuTarget): void {
    this.recentFeishuTargetByTeam.set(teamName, target);
  }

  private async stopRemovedOrReconfiguredFeishuChannels(
    nextConfig: LeadChannelConfig
  ): Promise<void> {
    const nextChannelsByKey = new Map(
      nextConfig.channels
        .filter((channel) => channel.provider === 'feishu' && channel.enabled !== false)
        .map((channel) => [this.getChannelKey(channel.id), channel] as const)
    );
    for (const key of Array.from(this.wsClientByChannel.keys())) {
      const nextChannel = nextChannelsByKey.get(key);
      if (!nextChannel) {
        this.closeFeishuChannelRuntime(key);
        this.clearConnectingHint(GLOBAL_CHANNEL_STATUS_OWNER, key);
        continue;
      }
      const feishuConfig = nextChannel.feishu ?? nextConfig.feishu;
      const appId = feishuConfig.appId.trim();
      const appSecret = feishuConfig.appSecret.trim();
      const nextSignature =
        appId && appSecret
          ? this.buildFeishuChannelConfigSignature(nextChannel, appId, appSecret)
          : '';
      if (nextSignature && this.channelConfigSignatureByKey.get(key) === nextSignature) {
        continue;
      }
      this.closeFeishuChannelRuntime(key);
      this.clearConnectingHint(GLOBAL_CHANNEL_STATUS_OWNER, key);
    }
  }

  private isRecentDuplicateFeishuReply(dedupeKey: string): boolean {
    const now = Date.now();
    for (const [key, timestamp] of this.feishuReplyDedupe.entries()) {
      if (now - timestamp > FEISHU_REPLY_DEDUPE_TTL_MS) {
        this.feishuReplyDedupe.delete(key);
      }
    }

    const existing = this.feishuReplyDedupe.get(dedupeKey);
    if (existing && now - existing <= FEISHU_REPLY_DEDUPE_TTL_MS) {
      return true;
    }

    this.feishuReplyDedupe.set(dedupeKey, now);
    return false;
  }

  async stopFeishu(channelId?: string): Promise<LeadChannelSnapshot | null> {
    const globalConfig = await this.readGlobalConfig();
    if (!channelId) {
      for (const [key, wsClient] of this.wsClientByChannel.entries()) {
        wsClient.close({ force: true });
        this.wsClientByChannel.delete(key);
        this.apiClientByChannel.delete(key);
        this.channelConfigSignatureByKey.delete(key);
        const id = key;
        const channel = globalConfig.channels.find((c) => c.id === id);
        const statusOwner = channel?.boundTeam ?? GLOBAL_CHANNEL_STATUS_OWNER;
        this.clearConnectingHint(statusOwner, id);
        this.setStatus(
          statusOwner,
          id,
          createStoppedStatus('飞书长连接已停止。', { id, name: id })
        );
      }
      return null;
    }

    const key = this.getChannelKey(channelId);
    const wsClient = this.wsClientByChannel.get(key);
    if (wsClient) {
      wsClient.close({ force: true });
      this.wsClientByChannel.delete(key);
    }
    this.apiClientByChannel.delete(key);
    this.channelConfigSignatureByKey.delete(key);
    const channel = globalConfig.channels.find((c) => c.id === channelId);
    const boundTeam = channel?.boundTeam;
    const statusOwner = boundTeam ?? GLOBAL_CHANNEL_STATUS_OWNER;
    this.clearConnectingHint(statusOwner, channelId);
    this.setStatus(
      statusOwner,
      channelId,
      createStoppedStatus('飞书长连接已停止。', {
        id: channelId,
        name: channel?.name ?? channelId,
      })
    );
    if (boundTeam) {
      return this.getSnapshot(boundTeam);
    }
    return null;
  }

  private async readConfig(teamName: string): Promise<LeadChannelConfig> {
    try {
      const raw = await fs.promises.readFile(getLeadChannelConfigPath(teamName), 'utf8');
      return normalizeConfig(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return cloneDefaultConfig();
      }
      throw error;
    }
  }

  private async readGlobalConfig(): Promise<LeadChannelConfig> {
    try {
      const raw = await fs.promises.readFile(getGlobalLeadChannelConfigPath(), 'utf8');
      return normalizeConfig(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return cloneDefaultConfig();
      }
      throw error;
    }
  }

  private getStatus(teamName: string): LeadChannelStatus {
    const statuses = Object.values(this.getStatusesByChannel(teamName));
    return (
      statuses.find((status) => status.running) ??
      statuses.find((status) => status.state === 'error') ??
      createStoppedStatus()
    );
  }

  private getStatusesByChannel(teamName: string): Record<string, LeadChannelStatus> {
    return Object.fromEntries(this.statusByTeamChannel.get(teamName)?.entries() ?? []);
  }

  private setStatus(teamName: string, channelId: string, status: LeadChannelStatus): void {
    const statuses = this.statusByTeamChannel.get(teamName) ?? new Map<string, LeadChannelStatus>();
    statuses.set(channelId, status);
    this.statusByTeamChannel.set(teamName, statuses);
  }

  private patchStatus(
    teamName: string,
    channelId: string,
    patch: Partial<LeadChannelStatus>
  ): void {
    const current =
      this.statusByTeamChannel.get(teamName)?.get(channelId) ??
      createStoppedStatus(null, { id: channelId, name: channelId });
    this.setStatus(teamName, channelId, { ...current, ...patch });
  }

  private getChannelKey(channelId: string): string {
    return channelId;
  }

  private buildFeishuChannelConfigSignature(
    channel: LeadChannelDefinition,
    appId: string,
    appSecret: string
  ): string {
    return shortHash(
      JSON.stringify({
        id: channel.id,
        provider: channel.provider,
        appId,
        appSecret,
        boundTeam: channel.boundTeam ?? null,
        enabled: channel.enabled !== false,
      })
    );
  }

  private closeFeishuChannelRuntime(key: string): void {
    const wsClient = this.wsClientByChannel.get(key);
    wsClient?.close({ force: true });
    this.wsClientByChannel.delete(key);
    this.apiClientByChannel.delete(key);
    this.channelConfigSignatureByKey.delete(key);
  }

  private async resolveLeadName(teamName: string): Promise<string> {
    const config = await this.configReader.getConfig(teamName).catch(() => null);
    return (
      config?.members?.find((member) => isLeadMember(member))?.name?.trim() ||
      CANONICAL_LEAD_MEMBER_NAME
    );
  }

  private async resolveMentionedTeamName(text: string): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const explicitTeam = /^\/team\s+([^\s]+)\s*/i.exec(trimmed)?.[1]?.trim();
    const atMention = /@([\p{L}\p{N}._-]+)/u.exec(trimmed)?.[1]?.trim();
    const requested = explicitTeam || atMention;
    if (!requested) return null;

    const teams = await this.configReader.listTeams().catch(() => []);
    const normalizedRequested = requested.toLowerCase();
    const matched = teams.find(
      (team) =>
        team.teamName.toLowerCase() === normalizedRequested ||
        team.displayName?.trim().toLowerCase() === normalizedRequested
    );
    return matched?.teamName ?? null;
  }

  private async getFeishuApiClient(channelId: string): Promise<InstanceType<typeof Lark.Client>> {
    const key = this.getChannelKey(channelId);
    const existing = this.apiClientByChannel.get(key);
    if (existing) return existing;

    const globalConfig = await this.readGlobalConfig();
    const channel = globalConfig.channels.find(
      (item) => item.id === channelId && item.provider === 'feishu'
    );
    const feishuConfig = channel?.feishu ?? globalConfig.feishu;
    const appId = feishuConfig.appId.trim();
    const appSecret = feishuConfig.appSecret.trim();
    if (!appId || !appSecret) {
      throw new Error('无法发送飞书回复：渠道配置缺少 App ID 或 App Secret。');
    }
    const client = new Lark.Client({ appId, appSecret });
    this.apiClientByChannel.set(key, client);
    return client;
  }

  private async claimInboundEvent(
    teamName: string,
    channelId: string,
    message: LeadChannelInboundMessage
  ): Promise<{ eventKey: string | null; shouldProcess: boolean }> {
    const messageId = message.messageId?.trim();
    if (!messageId) {
      return { eventKey: null, shouldProcess: true };
    }

    const eventKey = `${channelId}:${messageId}`;
    const ledgerPath = getLeadChannelEventLedgerPath(teamName);
    const now = new Date();
    const nowIso = now.toISOString();
    let shouldProcess = true;

    await withFileLock(ledgerPath, async () => {
      const ledger = await this.readInboundEventLedger(ledgerPath);
      const existing = ledger.find((entry) => entry.eventKey === eventKey);
      if (existing) {
        existing.lastSeenAt = nowIso;
        const updatedAtMs = Date.parse(existing.updatedAt);
        const isStaleProcessing =
          existing.status === 'processing' &&
          Number.isFinite(updatedAtMs) &&
          now.getTime() - updatedAtMs > CHANNEL_EVENT_PROCESSING_STALE_MS;
        if (existing.status === 'handled' || !isStaleProcessing) {
          shouldProcess = false;
        } else {
          existing.status = 'processing';
          existing.updatedAt = nowIso;
        }
      } else {
        ledger.push({
          eventKey,
          status: 'processing',
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          updatedAt: nowIso,
          channelId,
          messageId,
        });
      }
      await this.writeInboundEventLedger(ledgerPath, ledger);
    });

    return { eventKey, shouldProcess };
  }

  private async markInboundEventHandled(teamName: string, eventKey: string): Promise<void> {
    const ledgerPath = getLeadChannelEventLedgerPath(teamName);
    const nowIso = new Date().toISOString();
    await withFileLock(ledgerPath, async () => {
      const ledger = await this.readInboundEventLedger(ledgerPath);
      const existing = ledger.find((entry) => entry.eventKey === eventKey);
      if (existing) {
        existing.status = 'handled';
        existing.updatedAt = nowIso;
        existing.lastSeenAt = nowIso;
      }
      await this.writeInboundEventLedger(ledgerPath, ledger);
    });
  }

  private async readInboundEventLedger(ledgerPath: string): Promise<LeadChannelEventLedgerEntry[]> {
    try {
      const raw = await fs.promises.readFile(ledgerPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is LeadChannelEventLedgerEntry => {
        if (!entry || typeof entry !== 'object') return false;
        const row = entry as Partial<LeadChannelEventLedgerEntry>;
        return (
          typeof row.eventKey === 'string' &&
          (row.status === 'processing' || row.status === 'handled') &&
          typeof row.firstSeenAt === 'string' &&
          typeof row.lastSeenAt === 'string' &&
          typeof row.updatedAt === 'string' &&
          typeof row.channelId === 'string' &&
          typeof row.messageId === 'string'
        );
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeInboundEventLedger(
    ledgerPath: string,
    ledger: LeadChannelEventLedgerEntry[]
  ): Promise<void> {
    const trimmed = ledger
      .slice()
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(-CHANNEL_EVENT_LEDGER_MAX_ENTRIES);
    await fs.promises.mkdir(path.dirname(ledgerPath), { recursive: true });
    await atomicWriteAsync(ledgerPath, `${JSON.stringify(trimmed, null, 2)}\n`);
  }

  private scheduleConnectingHint(
    teamName: string,
    channel: Pick<LeadChannelDefinition, 'id' | 'name'>
  ): void {
    const key = this.getChannelKey(channel.id);
    const timer = setTimeout(() => {
      const status = this.statusByTeamChannel.get(teamName)?.get(channel.id);
      if (!status || (status.state !== 'connecting' && status.state !== 'reconnecting')) return;
      this.patchStatus(teamName, channel.id, {
        message: `${channel.name} 仍在等待飞书 ready 回调。若持续超过 30 秒，请检查飞书后台长连接开关、App ID/Secret 和事件订阅。`,
      });
    }, 12_000);
    this.connectingHintTimerByTeamChannel.set(key, timer);
  }

  private async resolveFeishuSenderName(
    apiClient: InstanceType<typeof Lark.Client>,
    senderId: string
  ): Promise<string | null> {
    const cached = this.senderNameCache.get(senderId);
    if (cached && Date.now() - cached.fetchedAt < LeadChannelListenerService.SENDER_CACHE_TTL) {
      return cached.name;
    }
    try {
      const resp = await apiClient.contact.user.get({ path: { user_id: senderId } });
      const name = (resp as { data?: { user?: { name?: string } } })?.data?.user?.name ?? null;
      if (name) {
        this.senderNameCache.set(senderId, { name, fetchedAt: Date.now() });
      }
      return name;
    } catch {
      return null;
    }
  }

  private clearConnectingHint(teamName: string, channelId: string): void {
    const key = this.getChannelKey(channelId);
    const timer = this.connectingHintTimerByTeamChannel.get(key);
    if (timer) {
      clearTimeout(timer);
      this.connectingHintTimerByTeamChannel.delete(key);
    }
  }
}

let singleton: LeadChannelListenerService | null = null;

export function getLeadChannelListenerService(): LeadChannelListenerService {
  singleton ??= new LeadChannelListenerService();
  return singleton;
}
