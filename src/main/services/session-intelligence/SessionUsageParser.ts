/**
 * SessionUsageParser - reads Claude Code JSONL session files and extracts
 * metadata-only usage metrics (tokens, message counts, tool calls).
 *
 * Modeled after CCPal's parse_jsonl() / build_index() from
 * https://github.com/lujinian1982/ccpal
 */

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import { getProjectDirNameCandidates, getProjectsBasePath } from '@main/utils/pathDecoder';

export interface SessionEntry {
  relPath: string;
  projectPath: string;
  title: string;
  messageCount: number;
  toolCalls: Record<string, number>;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    total: number;
  };
  startTime: string;
  endTime: string;
  fileSize: number;
  mtime: number;
  isWorktree: boolean;
}

export interface UsageAggregate {
  sessions: number;
  messages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    total: number;
  };
  activeDays: number;
  daily: Record<string, DailyMetrics>;
  hourly: number[];
  projects: ProjectMetricsEntry[];
  events7d: EventEntry[];
  workSecondsByDay: Record<string, number>;
}

export interface DailyMetrics {
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  tokensTotal: number;
  workSeconds: number;
}

export interface ProjectMetricsEntry {
  cwd: string;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
}

export interface EventEntry {
  ts: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  tokensTotal: number;
}

export interface ParseResult {
  sessions: SessionEntry[];
  aggregate: UsageAggregate;
}

const SEG_GAP_MS = 10 * 60 * 1000; // 10 minutes gap threshold
const RECENT_DAYS = 7;

function extractFirstUserText(content: unknown): string {
  if (typeof content === 'string') {
    return content.slice(0, 200).trim();
  }
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      return b.text.slice(0, 200).trim();
    }
  }
  return '';
}

function smartTitle(text: string, maxLen = 90): string {
  if (!text) return '';
  let t = text;
  if (t.startsWith('@') && t.includes(' ')) {
    t = t.slice(t.indexOf(' ') + 1).trim();
  }
  let cut = t.length;
  for (const sep of ['\n', '。', '?', '！', '；']) {
    const i = t.indexOf(sep);
    if (5 < i && i < maxLen && i < cut) cut = i;
  }
  return t.slice(0, cut < t.length ? cut : maxLen).trim();
}

function extractToolCalls(content: unknown, counts: Record<string, number>): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.name === 'string') {
      counts[b.name] = (counts[b.name] ?? 0) + 1;
    }
  }
}

function normalizeCwd(cwd: string): { normalized: string; isWorktree: boolean } {
  if (!cwd) return { normalized: cwd, isWorktree: false };
  const parts = cwd.split('/');
  const idx = parts.indexOf('.claude');
  const isWorktree = idx >= 0 && idx + 1 < parts.length && parts[idx + 1] === 'worktrees';
  const normalized = isWorktree ? parts.slice(0, idx).join('/') : cwd;
  return { normalized, isWorktree };
}

interface ParsedSession {
  title: string;
  projectPath: string;
  isWorktree: boolean;
  messageCount: number;
  toolCalls: Record<string, number>;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    total: number;
  };
  startTime: string;
  endTime: string;
  dailyTokens: Record<string, DailyMetrics>;
  hourly: number[];
  events: EventEntry[];
}

async function parseJsonl(filePath: string): Promise<ParsedSession | null> {
  let messageCount = 0;
  let title = '';
  let rawCwd = '';
  let isWorktree = false;
  const toolCalls: Record<string, number> = {};
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  let startTime = '';
  let endTime = '';
  const dailyTokens: Record<string, DailyMetrics> = {};
  const hourly: number[] = new Array(24).fill(0);
  const events: EventEntry[] = [];

  const rl = createInterface({ input: createReadStream(filePath, 'utf-8'), crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!rawCwd && typeof obj.cwd === 'string') {
      rawCwd = obj.cwd;
      isWorktree = normalizeCwd(rawCwd).isWorktree;
    }

    const msg = obj.message as Record<string, unknown> | undefined;
    let role: string | undefined;
    let content: unknown;
    let usage: Record<string, unknown> | undefined;
    let ts: string | undefined;

    if (msg && typeof msg === 'object') {
      role = msg.role as string | undefined;
      content = msg.content;
      usage = msg.usage as Record<string, unknown> | undefined;
      ts = (obj.timestamp ?? msg.timestamp) as string | undefined;
    } else if (obj.type === 'user' || obj.type === 'assistant') {
      role = obj.type as string;
      content = obj.content;
      usage = obj.usage as Record<string, unknown> | undefined;
      ts = obj.timestamp as string | undefined;
    }

    if (!role || !ts) continue;

    messageCount++;

    if (role === 'user' && !title && content) {
      title = smartTitle(extractFirstUserText(content));
    }

    if (role === 'assistant' && content) {
      extractToolCalls(content, toolCalls);
    }

    if (role === 'assistant' && usage && typeof usage === 'object') {
      const inp = Number(usage.input_tokens ?? 0) || 0;
      const out = Number(usage.output_tokens ?? 0) || 0;
      const cread = Number(usage.cache_read_input_tokens ?? 0) || 0;
      const ccreate = Number(usage.cache_creation_input_tokens ?? 0) || 0;
      const total = inp + out + cread + ccreate;

      tokens.input += inp;
      tokens.output += out;
      tokens.cacheRead += cread;
      tokens.cacheCreation += ccreate;
      tokens.total += total;

      // Daily aggregation
      const day = ts.slice(0, 10);
      if (day.length === 10) {
        const d = (dailyTokens[day] ??= {
          sessions: 0,
          messages: 0,
          tokensIn: 0,
          tokensOut: 0,
          cacheRead: 0,
          cacheCreation: 0,
          tokensTotal: 0,
          workSeconds: 0,
        });
        d.messages++;
        d.tokensIn += inp;
        d.tokensOut += out;
        d.cacheRead += cread;
        d.cacheCreation += ccreate;
        d.tokensTotal += total;
      }

      // Hourly distribution
      const hour = Number(ts.slice(11, 13));
      if (hour >= 0 && hour < 24) {
        hourly[hour]++;
      }

      // Events for work seconds calculation
      const tsUnix = Date.parse(ts) / 1000;
      if (!isNaN(tsUnix)) {
        events.push({
          ts: tsUnix,
          tokensIn: inp,
          tokensOut: out,
          cacheRead: cread,
          cacheCreation: ccreate,
          tokensTotal: total,
        });
      }
    }

    if (!startTime) startTime = ts;
    endTime = ts;
  }

  if (messageCount === 0) return null;

  return {
    title,
    projectPath: normalizeCwd(rawCwd).normalized,
    isWorktree,
    messageCount,
    toolCalls,
    tokens,
    startTime,
    endTime,
    dailyTokens,
    hourly,
    events,
  };
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(full);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield full;
    }
  }
}

function calcWorkSeconds(events: EventEntry[]): Record<string, number> {
  // Group events by day
  const byDay: Record<string, number[]> = {};
  for (const ev of events) {
    const day = new Date(ev.ts * 1000).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(ev.ts);
  }

  const workSeconds: Record<string, number> = {};
  for (const [day, tsList] of Object.entries(byDay)) {
    if (tsList.length === 0) continue;
    tsList.sort((a, b) => a - b);

    let total = 0;
    let segStart = tsList[0];
    let last = tsList[0];

    for (const t of tsList.slice(1)) {
      if (t - last > SEG_GAP_MS / 1000) {
        total += last - segStart;
        segStart = t;
      }
      last = t;
    }
    total += last - segStart;

    // Minimum 60 seconds if there are events but total is 0
    if (total === 0 && tsList.length > 0) {
      total = 60;
    }

    workSeconds[day] = Math.round(total);
  }

  return workSeconds;
}

export interface ProjectUsageStats {
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  totalTokens: number;
  durationMs: number;
}

/**
 * Full-file usage stats for one work directory.
 * Full-file stats are used by the digital worker list to avoid the old first-200-line
 * approximation. Callers decide whether their displayed total includes cache tokens.
 */
export async function scanProjectStats(workDir: string): Promise<ProjectUsageStats | null> {
  if (!workDir) return null;

  const projectsRoot = getProjectsBasePath();
  const jsonlDirs = Array.from(
    new Set(
      getProjectDirNameCandidates(workDir)
        .filter((candidate) => !path.isAbsolute(candidate))
        .map((candidate) => path.join(projectsRoot, candidate))
    )
  );
  const normalizedWorkDir = normalizeCwd(workDir).normalized;
  const stats: ProjectUsageStats = {
    sessions: 0,
    messages: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 0,
    durationMs: 0,
  };
  let earliest = '';
  let latest = '';

  for (const jsonlDir of jsonlDirs) {
    for await (const filePath of walkJsonl(jsonlDir)) {
      const parsed = await parseJsonl(filePath);
      if (!parsed) continue;
      if (parsed.projectPath && parsed.projectPath !== normalizedWorkDir) continue;

      stats.sessions++;
      stats.messages += parsed.messageCount;
      stats.tokensIn += parsed.tokens.input;
      stats.tokensOut += parsed.tokens.output;
      stats.cacheRead += parsed.tokens.cacheRead;
      stats.cacheCreation += parsed.tokens.cacheCreation;
      stats.totalTokens += parsed.tokens.total;
      if (parsed.startTime && (!earliest || parsed.startTime < earliest))
        earliest = parsed.startTime;
      if (parsed.endTime && (!latest || parsed.endTime > latest)) latest = parsed.endTime;
    }
  }

  if (stats.sessions === 0) return null;
  if (earliest && latest) {
    stats.durationMs = Math.max(0, Date.parse(latest) - Date.parse(earliest));
  }
  return stats;
}

export async function scanSessions(): Promise<ParseResult> {
  const sessions: SessionEntry[] = [];
  const aggregate: UsageAggregate = {
    sessions: 0,
    messages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
    activeDays: 0,
    daily: {},
    hourly: new Array(24).fill(0),
    projects: [],
    events7d: [],
    workSecondsByDay: {},
  };

  const activeDaySet = new Set<string>();
  const allEvents: EventEntry[] = [];
  const projectMap: Record<string, ProjectMetricsEntry> = {};
  const projectsRoot = getProjectsBasePath();

  for await (const filePath of walkJsonl(projectsRoot)) {
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }

    const parsed = await parseJsonl(filePath);
    if (!parsed) continue;

    const relPath = path.relative(projectsRoot, filePath);
    sessions.push({
      relPath,
      projectPath: parsed.projectPath,
      title: parsed.title,
      messageCount: parsed.messageCount,
      toolCalls: parsed.toolCalls,
      tokens: parsed.tokens,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      fileSize: fileStat.size,
      mtime: fileStat.mtimeMs,
      isWorktree: parsed.isWorktree,
    });

    aggregate.sessions++;
    aggregate.messages += parsed.messageCount;
    aggregate.tokens.input += parsed.tokens.input;
    aggregate.tokens.output += parsed.tokens.output;
    aggregate.tokens.cacheRead += parsed.tokens.cacheRead;
    aggregate.tokens.cacheCreation += parsed.tokens.cacheCreation;
    aggregate.tokens.total += parsed.tokens.total;

    // Hourly
    for (let h = 0; h < 24; h++) {
      aggregate.hourly[h] += parsed.hourly[h];
    }

    // Events
    allEvents.push(...parsed.events);

    // Daily
    for (const [day, m] of Object.entries(parsed.dailyTokens)) {
      activeDaySet.add(day);
      const d = (aggregate.daily[day] ??= {
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        tokensTotal: 0,
        workSeconds: 0,
      });
      d.sessions++;
      d.messages += m.messages;
      d.tokensIn += m.tokensIn;
      d.tokensOut += m.tokensOut;
      d.cacheRead += m.cacheRead;
      d.cacheCreation += m.cacheCreation;
      d.tokensTotal += m.tokensTotal;
    }

    // Projects
    const proj = parsed.projectPath || '(untracked)';
    if (!projectMap[proj]) {
      projectMap[proj] = {
        cwd: proj,
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        tokensTotal: 0,
      };
    }
    const p = projectMap[proj];
    p.sessions++;
    p.messages += parsed.messageCount;
    p.tokensIn += parsed.tokens.input;
    p.tokensOut += parsed.tokens.output;
    p.tokensTotal += parsed.tokens.total;
  }

  // Work seconds per day
  aggregate.workSecondsByDay = calcWorkSeconds(allEvents);
  for (const [day, secs] of Object.entries(aggregate.workSecondsByDay)) {
    if (aggregate.daily[day]) {
      aggregate.daily[day].workSeconds = secs;
    }
  }

  // 7-day rolling window events
  const cutoff = Date.now() / 1000 - RECENT_DAYS * 86400;
  aggregate.events7d = allEvents.filter((e) => e.ts >= cutoff).sort((a, b) => a.ts - b.ts);

  aggregate.activeDays = activeDaySet.size;

  // Projects sorted by messages descending
  aggregate.projects = Object.values(projectMap).sort((a, b) => b.messages - a.messages);

  sessions.sort((a, b) => b.endTime.localeCompare(a.endTime));

  return { sessions, aggregate };
}
