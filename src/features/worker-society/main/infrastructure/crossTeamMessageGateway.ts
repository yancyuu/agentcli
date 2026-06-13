/**
 * Worker Society — 基础设施层：cross-team 协议格式化的持久化消息网关。
 *
 * 把应用层 MessageGateway 落地为「调用 hermit 接口」的具象实现：
 *   - 用 hermit 的 formatCrossTeamText 给消息打上 cross-team 前缀，使其与既有
 *     cross-team 消息总线（parseCrossTeamPrefix）完全兼容——worker 间社交消息可被
 *     hermit 现有渲染/中继逻辑识别。
 *   - 以 append-only JSONL（messages.jsonl）持久化，供前端活动流 / /api/society/feed 读取。
 *   - 注入 ClockPort 保证可测与确定性。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { formatCrossTeamText } from '@shared/constants/crossTeam';
import type { ClockPort, MessageGateway, SocialMessageOut } from '../../core/application/ports';

/** 一条已持久化的社交消息记录（含 cross-team 格式化文本）。 */
export interface SocialMessageRecord {
  id: string;
  fromWorker: string;
  toWorker: string;
  text: string;
  /** 经 formatCrossTeamText 格式化的文本，可被 parseCrossTeamPrefix 回解析。 */
  formatted: string;
  needId?: string;
  deliveredAt: string;
}

export class CrossTeamMessageGateway implements MessageGateway {
  private readonly file: string;
  constructor(
    rootDir: string,
    private readonly clock: ClockPort
  ) {
    this.file = join(rootDir, 'messages.jsonl');
  }

  async send(msg: SocialMessageOut): Promise<{ delivered: boolean }> {
    await mkdir(dirname(this.file), { recursive: true });
    const record: SocialMessageRecord = {
      id: `msg-${randomId()}`,
      fromWorker: msg.fromWorker,
      toWorker: msg.toWorker,
      text: msg.text,
      formatted: formatCrossTeamText(msg.fromWorker, 0, msg.text),
      needId: msg.needId,
      deliveredAt: this.clock.now(),
    };
    await appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    return { delivered: true };
  }

  /** 读取全部持久化消息（按发送顺序）。文件缺失时返回空。 */
  async all(): Promise<SocialMessageRecord[]> {
    try {
      const raw = await readFile(this.file, 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as SocialMessageRecord);
    } catch {
      return [];
    }
  }

  /** 读取最近的 N 条消息（供前端活动流）。 */
  async recent(limit: number): Promise<SocialMessageRecord[]> {
    const all = await this.all();
    return all.slice(-limit);
  }
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
