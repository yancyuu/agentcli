import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureUsageTelemetry,
  getTelemetryRuntimeStatus,
  getTelemetryStatus,
  scanTelemetryOnce,
} from '@main/services/session-intelligence/UsageTelemetryService';
import { setClaudeBasePathOverride } from '@main/utils/pathDecoder';
import type { TaskBusConfig } from '@shared/types/team';

let tmpDir: string;
let claudeBase: string;

const cfg: TaskBusConfig = {
  enabled: true,
  redis: { host: '127.0.0.1', port: 6379 },
  telemetry: { enabled: true, platform: 'claudecode' },
};

function writeSession(projectDir: string, fileName = 'session.jsonl'): void {
  const projectJsonlDir = path.join(claudeBase, 'projects', '-Users-example-project-alpha');
  fs.mkdirSync(projectJsonlDir, { recursive: true });
  const lines = [
    {
      cwd: projectDir,
      timestamp: '2026-06-18T00:00:00.000Z',
      message: { role: 'user', content: 'hello' },
    },
    {
      cwd: projectDir,
      timestamp: '2026-06-18T00:01:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      },
    },
  ];
  fs.writeFileSync(path.join(projectJsonlDir, fileName), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-usage-telemetry-service-'));
  claudeBase = path.join(tmpDir, '.claude');
  fs.mkdirSync(path.join(claudeBase, 'projects'), { recursive: true });
  setClaudeBasePathOverride(claudeBase);
  configureUsageTelemetry();
});

afterEach(() => {
  vi.restoreAllMocks();
  setClaudeBasePathOverride(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const uploadCfg: TaskBusConfig = {
  ...cfg,
  telemetry: { enabled: true, platform: 'claudecode', conversationUploadEnabled: true },
};

function writeAuthStore(): void {
  fs.mkdirSync(path.join(tmpDir, 'auth'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'auth/openhermit.json'), JSON.stringify({
    token: { accessToken: 'test-token', expiresAt: '2999-01-01T00:00:00.000Z' },
  }));
}

describe('UsageTelemetryService local scanning', () => {
  it('scans local Claude JSONL sessions without upload status or remote events', async () => {
    writeSession('/Users/example/project-alpha');

    const status = await scanTelemetryOnce(cfg);

    expect(status).toMatchObject({
      connected: false,
      sessions: 1,
      messages: 2,
      tokensIn: 10,
      tokensOut: 20,
      cacheRead: 30,
      cacheCreation: 40,
      totalTokens: 100,
      unresolvedUsage: { sessions: 0, messages: 0, tokensTotal: 0 },
    });
    expect(status?.projects).toEqual([
      {
        cwd: '/Users/example/project-alpha',
        sessions: 1,
        messages: 2,
        tokensIn: 10,
        tokensOut: 20,
        tokensTotal: 100,
      },
    ]);
    expect(status?.localUsers).toEqual([
      expect.objectContaining({
        kind: 'local',
        workDir: '/Users/example/project-alpha',
        sessions: 1,
        messages: 2,
        tokensTotal: 100,
      }),
    ]);
    expect(status).not.toHaveProperty('externalUsers');
    expect(status).not.toHaveProperty('conversationUpload');
    expect(getTelemetryRuntimeStatus()).toMatchObject({ running: false, phase: 'done' });
  });

  it('canonicalizes cwd variants before project and local row emission', async () => {
    const projectDir = path.join(tmpDir, 'project-alpha');
    fs.mkdirSync(projectDir, { recursive: true });
    const canonicalProjectDir = fs.realpathSync.native(projectDir);
    writeSession(projectDir, 'session-a.jsonl');
    writeSession(path.join(projectDir, '.'), 'session-b.jsonl');

    const status = await scanTelemetryOnce(cfg);

    expect(status?.projects).toEqual([
      {
        cwd: canonicalProjectDir,
        sessions: 2,
        messages: 4,
        tokensIn: 20,
        tokensOut: 40,
        tokensTotal: 200,
      },
    ]);
    expect(status?.localUsers).toHaveLength(2);
    expect(status?.localUsers?.map((row) => row.workDir)).toEqual([canonicalProjectDir, canonicalProjectDir]);
  });

  function mockUploadFlow(result: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/hermit/me')) {
        return new Response(JSON.stringify({ ok: true, authenticated: true, status: 'ok' }), { status: 200 });
      }
      if (url.includes('/api/v1/hermit/uploads/')) {
        return new Response(JSON.stringify({ status: 'success', accepted: 2, duplicated: 0, rejected: 0, failed: 0, ...result }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, uploadId: 'upload-test', receiptId: 'receipt-test', status: 'queued', received: 2, acceptedForProcessing: 2, duplicatedAtReceive: 0, rejectedAtReceive: 0, statusUrl: '/api/v1/hermit/uploads/upload-test' }), { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('does not trust a local cursor as the source of uploaded truth', async () => {
    process.env.HERMIT_HOME = tmpDir;
    writeAuthStore();
    await fs.promises.mkdir(path.join(tmpDir, 'telemetry'), { recursive: true });
    writeSession('/Users/example/project-alpha');
    const cursorPath = path.join(tmpDir, 'telemetry', 'conversation-message-upload-cursor.json');
    await fs.promises.writeFile(cursorPath, JSON.stringify({
      schemaVersion: 2,
      ackPolicy: 'server-counts-v1',
      uploadedEventIds: ['evt-forged'],
    }));

    const fetchMock = mockUploadFlow({ accepted: 2, duplicated: 0, rejected: 0 });

    const status = await scanTelemetryOnce(uploadCfg);

    expect(status?.conversationUpload).toMatchObject({
      totalDiscovered: 2,
      skippedAlreadyUploaded: 0,
      pending: 2,
      attempted: 2,
      accepted: 2,
      duplicated: 0,
      rejected: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('advances only the local scan cursor after server-confirmed upload', async () => {
    process.env.HERMIT_HOME = tmpDir;
    writeAuthStore();
    writeSession('/Users/example/project-alpha');
    const scanCursorPath = path.join(tmpDir, 'telemetry', 'conversation-message-scan-cursor.json');

    const fetchMock = mockUploadFlow({ accepted: 2, duplicated: 0, rejected: 0 });

    const firstStatus = await scanTelemetryOnce(uploadCfg);
    const scanCursor = JSON.parse(fs.readFileSync(scanCursorPath, 'utf-8'));
    const secondStatus = await scanTelemetryOnce(uploadCfg);

    expect(firstStatus?.conversationUpload).toMatchObject({ pending: 2, attempted: 2, accepted: 2, duplicated: 0 });
    expect(scanCursor).toMatchObject({ schemaVersion: 1, purpose: 'local-jsonl-scan-position' });
    expect(Object.values(scanCursor.files)).toEqual([
      expect.objectContaining({ offset: expect.any(Number), size: expect.any(Number) }),
    ]);
    expect(secondStatus?.conversationUpload).toMatchObject({ pending: 0, attempted: 0, accepted: 0, duplicated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces sanitized upload HTTP failure details and keeps scan cursor unchanged', async () => {
    process.env.HERMIT_HOME = tmpDir;
    writeAuthStore();
    writeSession('/Users/example/project-alpha');
    const scanCursorPath = path.join(tmpDir, 'telemetry', 'conversation-message-scan-cursor.json');

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/hermit/me')) {
        return new Response(JSON.stringify({ ok: true, authenticated: true, status: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'db timeout', accessToken: 'secret-token-should-not-print' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await scanTelemetryOnce(uploadCfg);
    const log = await fs.promises.readFile(path.join(tmpDir, 'logs/conversation-upload.log'), 'utf-8');

    expect(status?.conversationUpload).toMatchObject({ pending: 2, attempted: 2, accepted: 0, duplicated: 0 });
    expect(status?.conversationUpload?.lastError).toContain('HTTP 500');
    expect(status?.conversationUpload?.lastError).toContain('db timeout');
    expect(status?.conversationUpload?.lastError).not.toContain('secret-token-should-not-print');
    expect(log).toContain('upload-batch-failed');
    expect(log).toContain('HTTP 500');
    expect(log).not.toContain('secret-token-should-not-print');
    expect(fs.existsSync(scanCursorPath)).toBe(false);
  });
});
