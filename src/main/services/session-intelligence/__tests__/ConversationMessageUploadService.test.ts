import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setClaudeBasePathOverride } from '@main/utils/pathDecoder';
import { uploadConversationMessages, withUploadLock } from '../ConversationMessageUploadService';

describe('ConversationMessageUploadService', () => {
  let tmpDir: string;
  let hermitHome: string;
  let claudeBase: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hermit-upload-test-'));
    hermitHome = path.join(tmpDir, '.hermit');
    claudeBase = path.join(tmpDir, '.claude');
    process.env.HERMIT_HOME = hermitHome;
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL = 'http://monitor.test';
    // Default: disable the periodic first-run date filter so the existing fixtures
    // (hard-coded old timestamps, no cursor) still upload. The date-filter test
    // re-enables it explicitly.
    process.env.OPENHERMIT_UPLOAD_SINCE_HOURS = '0';
    await mkdir(path.join(hermitHome, 'auth'), { recursive: true });
    await writeFile(
      path.join(hermitHome, 'auth', 'openhermit.json'),
      JSON.stringify({ token: { accessToken: 'token', expiresAt: '2999-01-01T00:00:00.000Z' } })
    );
    setClaudeBasePathOverride(claudeBase);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setClaudeBasePathOverride(null);
    delete process.env.HERMIT_HOME;
    delete process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL;
    delete process.env.CODEX_HOME;
    delete process.env.HERMIT_USAGE_FOREGROUND_SCAN;
    delete process.env.HERMIT_USAGE_FULL_RESCAN;
    delete process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS;
    delete process.env.OPENHERMIT_UPLOAD_SINCE_HOURS;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('bounds the first periodic scan to recent messages when no cursor exists (no full-history backfill)', async () => {
    // Regression for the 776s hang: a channel that has never reported used to
    // scan ALL history on its first cycle. The periodic worker now skips messages
    // older than the since-window; only a manual full rescan re-uploads history.
    process.env.OPENHERMIT_UPLOAD_SINCE_HOURS = '24';
    delete process.env.HERMIT_USAGE_FOREGROUND_SCAN; // periodic daemon, not foreground
    delete process.env.HERMIT_USAGE_FULL_RESCAN;
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    const recentIso = (hoursAgo: number) =>
      new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const oldIso = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(); // 3 days ago → filtered
    const line = (uuid: string, ts: string) =>
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-1',
        uuid,
        cwd: '/tmp/project',
        timestamp: ts,
        message: { role: 'user', content: `msg-${uuid}`, model: 'claude-test-model' },
      })}\n`;
    await writeFile(
      path.join(projectDir, 'session-1.jsonl'),
      `${line('old-1', oldIso)}${line('new-1', recentIso(1))}${line('new-2', recentIso(2))}`
    );

    const posted: { eventId?: string }[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          feishu_authorized: true,
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        posted.push(...(body.messages ?? []));
        return Response.json({
          ok: true,
          receiptId: 'r1',
          uploadId: 'u1',
          received: posted.length,
          acceptedForProcessing: posted.length,
          status: 'queued',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    // 3 fixtures, but the 3-day-old one is outside the 24h window → only 2 uploaded.
    expect(posted.length).toBe(2);
    // Identify messages by eventId (not content text — Lane A strips the body).
    const eventIds = posted.map((m: { eventId?: string }) => m.eventId);
    expect(eventIds).toContain('claudecode:session-1:new-1');
    expect(eventIds).toContain('claudecode:session-1:new-2');
    expect(eventIds).not.toContain('claudecode:session-1:old-1');
  });

  it('strips conversation text from uploads — usage-only reporting (Lane A)', async () => {
    // Regression: message content text must never leave the machine. The wire
    // contract keeps `content` (server-required) but it carries a fixed placeholder;
    // usage + metadata (eventId, model, project hash) are still uploaded so token
    // attribution and eventId dedup are unchanged.
    process.env.OPENHERMIT_UPLOAD_SINCE_HOURS = '0';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-novault');
    await mkdir(projectDir, { recursive: true });
    const secret = 'SUPER_SECRET_PROMPT_TEXT_42';
    await writeFile(
      path.join(projectDir, 'session-novault.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-novault',
        uuid: 'message-novault',
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: secret, model: 'claude-test-model' },
      })}\n`
    );

    const posted: { eventId?: string; message?: { content?: string } }[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        posted.push(...body.messages);
        return Response.json({
          ok: true,
          uploadId: 'u-novault',
          status: 'queued',
          received: body.messages.length,
          acceptedForProcessing: body.messages.length,
          rejectedAtReceive: 0,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    expect(posted).toHaveLength(1);
    // The secret prompt text must NOT appear anywhere in the uploaded body.
    expect(JSON.stringify(posted)).not.toContain(secret);
    // The message itself IS uploaded (by eventId), with the placeholder content.
    expect(posted[0].eventId).toBe('claudecode:session-novault:message-novault');
    expect(posted[0].message?.content).toBe('[usage only]');
  });

  it('uses server usage status as cursor source and does not send client uploadId', async () => {
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'session-1.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-1',
        uuid: 'message-1',
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: 'hello', model: 'claude-test-model' },
      })}\n`
    );

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          feishu_authorized: true,
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: url.includes('client=codex') ? 'codex' : 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        expect(body).not.toHaveProperty('uploadId');
        expect(body).not.toHaveProperty('upload_id');
        expect(body.clientCursor).toMatchObject({
          schemaVersion: 1,
          purpose: 'local-jsonl-scan-position',
          messageCount: 1,
        });
        expect(body.messages).toHaveLength(1);
        expect(body.schemaVersion).toBe(1);
        expect(body.scene).toBe('coding');
        expect(body).not.toHaveProperty('platform');
        expect(body).toMatchObject({ reporter: 'agentcli', client: { tool: 'claudecode' } });
        // 新协议 ReportClient 仅允许 {tool}（additionalProperties:false）：锁死 wire 上
        // client 只携带 tool，禁止 version/instanceId 等附加字段触发 422。
        expect(Object.keys(body.client)).toEqual(['tool']);
        expect(body.messages[0]).toMatchObject({
          kind: 'conversation_message',
          eventId: 'claudecode:session-1:message-1',
          conversation: { conversationId: 'session-1', sessionRef: 'claudecode:session-1' },
          message: { messageRef: 'message-1', modelName: 'claude-test-model' },
        });
        expect(body.messages[0].message).not.toHaveProperty('model');
        // 模拟线上服务端契约：ReportUploadConversation 为 additionalProperties:false，
        // 仅允许 conversationId / sessionRef / startedAt。出现 claudeSessionRef 等额外字段
        // 时服务端返回 422 extra_forbidden（loc: messages[].conversation.claudeSessionRef），
        // 上报整体失败、lastError 被置位——与 ~/.hermit/logs/conversation-upload.log 一致。
        const allowedConversationKeys = new Set(['conversationId', 'sessionRef', 'startedAt']);
        const forbiddenConversationKeys = body.messages.flatMap(
          (m: { conversation?: Record<string, unknown> }) =>
            Object.keys(m.conversation ?? {}).filter((k) => !allowedConversationKeys.has(k))
        );
        if (forbiddenConversationKeys.length) {
          return Response.json(
            {
              detail: {
                code: 'schema_validation_failed',
                errorCount: forbiddenConversationKeys.length,
                errors: forbiddenConversationKeys.map((key: string) => ({
                  type: 'extra_forbidden',
                  loc: ['body', 'messages', 0, 'conversation', key],
                  msg: 'Extra inputs are not permitted',
                })),
              },
            },
            { status: 422 }
          );
        }
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_server_generated',
            receiptId: 'receipt-1',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
            detailUrl: '/api/v1/report/uploads/upl_server_generated',
          },
          { status: 202 }
        );
      }
      // No per-batch status polling: the /uploads/:id endpoint is never fetched.
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    expect(result.lastError).toBeUndefined();
    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.uploadIds).toEqual(['upl_server_generated']);
    await expect(
      readFile(path.join(hermitHome, 'telemetry', 'conversation-message-scan-cursor.json'), 'utf-8')
    ).rejects.toThrow();
  });

  it('full rescan scans all history while still uploading in batches', async () => {
    process.env.HERMIT_USAGE_FULL_RESCAN = '1';
    process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS = '0';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-full-rescan');
    await mkdir(projectDir, { recursive: true });
    const lines = Array.from({ length: 5 }, (_, index) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'session-full-rescan',
        uuid: `message-${index + 1}`,
        cwd: '/tmp/project',
        timestamp: `2026-06-24T08:2${index}:00.000Z`,
        message: {
          role: 'user',
          content: `full rescan ${index + 1}`,
          model: 'claude-test-model',
          usage: { totalTokens: 10 },
        },
      })
    );
    await writeFile(path.join(projectDir, 'session-full-rescan.jsonl'), `${lines.join('\n')}\n`);

    const batchSizes: number[] = [];
    const eventIds: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'success',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: {
                schemaVersion: 1,
                purpose: 'local-jsonl-scan-position',
                generatedAt: '2026-06-24T08:30:00.000Z',
                files: [
                  {
                    fileKey: 'already-at-end',
                    pathHash: 'old',
                    fromOffset: 0,
                    toOffset: 999999,
                    size: 999999,
                    mtimeMs: 1,
                  },
                ],
                fileCount: 1,
                messageCount: 999,
              },
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        batchSizes.push(body.messages.length);
        eventIds.push(...body.messages.map((message: { eventId: string }) => message.eventId));
        return Response.json(
          {
            ok: true,
            uploadId: `upl_full_${batchSizes.length}`,
            status: 'queued',
            received: body.messages.length,
            acceptedForProcessing: body.messages.length,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
        conversations: { batchSize: 2, uploadBatchSize: 2 },
      },
    });

    expect(batchSizes).toEqual([2, 2, 1]);
    expect(eventIds).toHaveLength(5);
    expect(result.attempted).toBe(5);
    expect(result.pending).toBe(0);
    expect(result.pendingTokens).toBe(0);
  });
  it('full rescan across multiple windows keeps uploaded <= discovered (no 617/117)', async () => {
    process.env.HERMIT_USAGE_FULL_RESCAN = '1';
    process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS = '0';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-multi-window');
    await mkdir(projectDir, { recursive: true });
    const lines = Array.from({ length: 5 }, (_, index) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'session-multi-window',
        uuid: `message-${index + 1}`,
        cwd: '/tmp/project',
        timestamp: `2026-06-24T08:2${index}:00.000Z`,
        message: {
          role: 'user',
          content: `multi window ${index + 1}`,
          model: 'claude-test-model',
          usage: { totalTokens: 10 },
        },
      })
    );
    await writeFile(path.join(projectDir, 'session-multi-window.jsonl'), `${lines.join('\n')}\n`);

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        return Response.json(
          {
            ok: true,
            uploadId: `upl_mw_${body.messages[0]?.messageRef}`,
            status: 'queued',
            received: body.messages.length,
            acceptedForProcessing: body.messages.length,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
        // windowSize=2 forces 3 windows for 5 messages; uploadedAfterBatch is
        // cumulative while totalMessages must track cumulative discovered too.
        conversations: { batchSize: 2, uploadBatchSize: 2, fullRescanWindowSize: 2 },
      },
    });

    // Regression guard for the 消息 617/117 bug: cumulative uploaded must never
    // exceed cumulative discovered, and pending must never go negative.
    expect(result.attempted).toBe(5);
    expect(result.totalDiscovered).toBeGreaterThanOrEqual(result.accepted);
    expect(result.pending).toBeGreaterThanOrEqual(0);
  });

  it('sends an Idempotency-Key header equal to the sha256 of the exact request body', async () => {
    const { createHash } = await import('node:crypto');
    const projectDir = path.join(claudeBase, 'projects', '-tmp-idem');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'session-idem.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-idem',
        uuid: 'message-idem',
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: 'idempotency check', model: 'claude-test-model' },
      })}\n`
    );

    const posted: { headers: Record<string, string>; body: string }[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          feishu_authorized: true,
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        posted.push({
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: String(init?.body),
        });
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_idem',
            receiptId: 'r-1',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    expect(result.lastError).toBeUndefined();
    expect(posted).toHaveLength(1);
    const key = posted[0].headers['Idempotency-Key'];
    expect(typeof key).toBe('string');
    expect(key).toHaveLength(64); // sha256 hex
    // The key is the body's own fingerprint: identical body ⟺ identical key, so the
    // doc's same-key+different-body 409 can never fire from this client.
    expect(key).toBe(createHash('sha256').update(posted[0].body).digest('hex'));
  });

  it('skips uploading when server reports in-flight batches for the channel', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: url.includes('client=codex') ? 'codex' : 'claudecode',
              scene: 'coding',
              status: 'processing',
              inFlight: { count: 1, uploadIds: ['upl_inflight'] },
              currentCursor: null,
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    expect(result.attempted).toBe(0);
    expect(result.uploadIds).toEqual(['upl_inflight']);
    expect(result.lastError).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/report/messages'),
      expect.anything()
    );
  });

  it('drains past in-flight on a foreground scan (--scan-once) instead of skipping', async () => {
    // Regression: 扫描一次 / `usage report` run as --scan-once children with
    // HERMIT_USAGE_FOREGROUND_SCAN=1. A pending backlog must actually upload,
    // not skip forever while the server finishes a prior batch.
    process.env.HERMIT_USAGE_FOREGROUND_SCAN = '1';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'session-1.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-1',
        uuid: 'message-1',
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: 'hello' },
      })}\n`
    );

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: url.includes('client=codex') ? 'codex' : 'claudecode',
              scene: 'coding',
              status: 'processing',
              inFlight: { count: 1, uploadIds: ['upl_inflight'] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_new',
            receiptId: 'receipt-1',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    // It pushed through the in-flight state and uploaded — the backlog drains.
    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/report/messages'),
      expect.anything()
    );
  });

  it('proceeds to upload (relying on server eventId dedup) when a prior upload has no committed cursor', async () => {
    // The client never skips on a missing cursor: a prior upload without a
    // committed cursor just means the server-side cursor commit hasn't landed yet
    // (or this is the channel's first upload). The client re-scans and re-posts;
    // the server dedupes by eventId, so already-uploaded messages come back as
    // duplicates (not double-counted). Skipping here would stall the channel
    // forever while a backlog sits — the documented behavior at the upload site.
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'session-no-cursor.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-no-cursor',
        uuid: 'message-no-cursor',
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: 'hello' },
      })}\n`
    );

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'success',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
              lastUploadId: 'upl_prior_without_cursor',
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        // Server-side dedup: a re-sent eventId comes back as a duplicate, not a
        // double-count. The client still POSTs it (attempted), relying on the server.
        const received = body.messages.length;
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_dedup',
            status: 'queued',
            received,
            acceptedForProcessing: 0,
            duplicatedAtReceive: received,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    // It PROCEEDED (did not skip) and POSTed to the unified endpoint; the server
    // accepted the dedup without an intake error.
    expect(result.attempted).toBe(1);
    expect(result.lastError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/report/messages'),
      expect.anything()
    );
  });

  it('refreshes an expired token before uploading (worker path no longer bails to 等待登录)', async () => {
    // Overwrite the far-future token from beforeEach with an EXPIRED one + a
    // refresh token. getValidBearerToken must proactively refresh, or the worker
    // reads an expired token and skips the upload entirely — the regression this
    // test guards.
    await writeFile(
      path.join(hermitHome, 'auth', 'openhermit.json'),
      JSON.stringify({
        token: {
          accessToken: 'expired',
          expiresAt: '2000-01-01T00:00:00.000Z',
          refreshToken: 'rt',
        },
      })
    );
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'session-refresh.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'session-refresh',
        uuid: 'msg-refresh',
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: 'hello' },
      })}\n`
    );

    let refreshed = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshed = true;
        return Response.json({
          access_token: 'fresh',
          access_expires_in: 3600,
          scope: 'upload:read upload:write',
        });
      }
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_refresh',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
            detailUrl: '/api/v1/report/uploads/upl_refresh',
          },
          { status: 202 }
        );
      }
      // No per-batch status polling: the /uploads/:id endpoint is never fetched.
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    expect(refreshed).toBe(true);
    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.uploadIds).toEqual(['upl_refresh']);
    expect(result.lastError).toBeUndefined();
  });

  it('sends all batches off the receipt without per-batch status polling — no UI freeze', async () => {
    // Regression guard for the "首次上报卡死" bug: the removed per-batch
    // terminal-status poll (up to 10 x 1.5s = ~15s/batch) made a 199-batch first
    // backfill take an hour and froze the interactive menu. Upload must POST every
    // batch off the receipt alone and NEVER hit the /uploads/:id status endpoint —
    // /report/usage/status is the server-authoritative fact source for committed cursor
    // and aggregate counts.
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BATCH_SIZE = '2'; // 3 messages => 2 batches
    process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS = '0';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    const lines = [1, 2, 3].map((i) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'session-fast',
        uuid: `m${i}`,
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: `hello ${i}` },
      })
    );
    await writeFile(path.join(projectDir, 'session-fast.jsonl'), `${lines.join('\n')}\n`);

    let uploadPosts = 0;
    let statusPolls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        uploadPosts += 1;
        const count = JSON.parse(String(init?.body)).messages.length;
        // Receipt is non-terminal ('queued') — on the confirm path this would
        // trigger polling; the fast path must NOT poll.
        return Response.json(
          {
            ok: true,
            uploadId: `upl_fast_${uploadPosts}`,
            status: 'queued',
            received: count,
            acceptedForProcessing: count,
            rejectedAtReceive: 0,
            detailUrl: `/api/v1/report/uploads/upl_fast_${uploadPosts}`,
          },
          { status: 202 }
        );
      }
      if (url.includes('/api/v1/report/uploads/')) {
        statusPolls += 1;
        return Response.json({ ok: true, status: 'success', accepted: 2, cursorCommitted: true });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
      },
    });

    expect(uploadPosts).toBe(2); // both batches sent
    expect(statusPolls).toBe(0); // NO per-batch polling — this is the freeze fix
    expect(result.attempted).toBe(3);
    expect(result.lastError).toBeUndefined(); // non-terminal receipt must NOT abort the run
    expect(result.pending).toBe(0); // batches count as sent; no misleading "N 待上报"
    expect(result.pendingTokens).toBe(0); // token backlog drains to 0 on a fully-successful upload too
    delete process.env.OPENHERMIT_CONVERSATION_UPLOAD_BATCH_SIZE;
  });

  it('uploads Codex token_count records from new payload.info usage shape', async () => {
    const codexHome = path.join(tmpDir, '.codex');
    process.env.CODEX_HOME = codexHome;
    const sessionDir = path.join(codexHome, 'sessions', '2026', '07', '02');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, 'rollout-session-1.jsonl'),
      `${JSON.stringify({
        timestamp: '2026-07-02T00:16:00.000Z',
        type: 'session_meta',
        payload: {
          type: 'session_meta',
          session_id: 'rollout-session-1',
          cwd: '/tmp/codex-project',
          model_provider: 'glm',
        },
      })}\n${JSON.stringify({
        timestamp: '2026-07-02T00:16:30.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          turn_id: 'turn-1',
          cwd: '/tmp/codex-project',
          model: 'glm-5.2',
          info: {
            total_token_usage: {
              input_tokens: 20,
              cached_input_tokens: 5,
              output_tokens: 7,
              reasoning_output_tokens: 3,
              total_tokens: 35,
            },
            last_token_usage: {
              input_tokens: 11,
              cached_input_tokens: 2,
              output_tokens: 4,
              reasoning_output_tokens: 1,
              total_tokens: 18,
            },
          },
        },
      })}\n`
    );

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        expect(url).toContain('client=codex');
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'codex',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          reporter: 'agentcli',
          client: { tool: 'codex' },
          scene: 'coding',
        });
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0]).toMatchObject({
          eventId: 'codex:rollout-session-1:turn-1',
          project: { name: 'codex-project' },
          conversation: {
            conversationId: 'rollout-session-1',
            sessionRef: 'codex:rollout-session-1',
          },
          message: {
            messageRef: 'turn-1',
            modelName: 'glm-5.2',
            usage: {
              inputTokens: 11,
              cacheReadTokens: 2,
              outputTokens: 5,
              cacheCreationTokens: 0,
              totalTokens: 18,
            },
          },
        });
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_codex',
            receiptId: 'r-codex',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'codex',
        conversationUploadEnabled: true,
        uploadProviders: ['codex'],
      },
    });

    expect(result.lastError).toBeUndefined();
    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
  });

  it('withUploadLock releases the lock when the locked function throws', async () => {
    const lockPath = path.join(hermitHome, 'telemetry', 'conversation-message-upload.lock');
    await expect(
      withUploadLock(hermitHome, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(readFile(lockPath, 'utf-8')).rejects.toThrow();
  });

  it('withUploadLock releases the lock on success and returns the result', async () => {
    const lockPath = path.join(hermitHome, 'telemetry', 'conversation-message-upload.lock');
    const result = await withUploadLock(hermitHome, async () => 42);
    expect(result).toBe(42);
    await expect(readFile(lockPath, 'utf-8')).rejects.toThrow();
  });

  it('withUploadLock returns null when the lock is held by a live process', async () => {
    // Skip the wait-retry so the test is fast (the default waits up to 60s).
    process.env.HERMIT_UPLOAD_LOCK_WAIT_MS = '0';
    const lockPath = path.join(hermitHome, 'telemetry', 'conversation-message-upload.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
    );
    const result = await withUploadLock(hermitHome, async () => 'should-not-run');
    expect(result).toBeNull();
    delete process.env.HERMIT_UPLOAD_LOCK_WAIT_MS;
  });

  it('aborts the whole run after 2 consecutive transport failures (server down)', async () => {
    // fullRescan window = uploadBatchSize*2 = 2 messages → 2 batches in window 1.
    // Both batches hit a transport failure (safeFetch → HTTP 599). The second
    // consecutive network failure must abort the ENTIRE run — not pay
    // UPLOAD_TIMEOUT_MS × remaining batches — so the 3rd message is never sent.
    process.env.HERMIT_USAGE_FULL_RESCAN = '1';
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BATCH_SIZE = '1';
    process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS = '0';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-netfail');
    await mkdir(projectDir, { recursive: true });
    const lines = Array.from({ length: 3 }, (_, i) =>
      JSON.stringify({
        type: 'user',
        sessionId: 's-netfail',
        uuid: `m-${i + 1}`,
        cwd: '/tmp/project',
        timestamp: `2026-06-24T08:20:0${i}.000Z`,
        message: { role: 'user', content: `net ${i + 1}`, model: 'claude-test-model' },
      })
    );
    await writeFile(path.join(projectDir, 'session-netfail.jsonl'), `${lines.join('\n')}\n`);

    let messagesCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        messagesCalls += 1;
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNRESET', message: 'socket hang up' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
        conversations: { uploadBatchSize: 1 },
      },
    });

    expect(messagesCalls).toBe(2);
    expect(result.lastError ?? '').toMatch(/服务端不可用/);
  });

  it('does NOT abort on business errors (422) — stays on the 3-strike path', async () => {
    // A 422 is a per-batch schema rejection, not a down server. It must NOT
    // trigger the network-failure abort; it falls through to the existing
    // MAX_CONSECUTIVE_FAILURES path. lastError carries the 422, never "服务端不可用".
    process.env.HERMIT_USAGE_FULL_RESCAN = '1';
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BATCH_SIZE = '1';
    process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS = '0';
    const projectDir = path.join(claudeBase, 'projects', '-tmp-bizfail');
    await mkdir(projectDir, { recursive: true });
    const lines = Array.from({ length: 3 }, (_, i) =>
      JSON.stringify({
        type: 'user',
        sessionId: 's-bizfail',
        uuid: `b-${i + 1}`,
        cwd: '/tmp/project',
        timestamp: `2026-06-24T08:21:0${i}.000Z`,
        message: { role: 'user', content: `biz ${i + 1}`, model: 'claude-test-model' },
      })
    );
    await writeFile(path.join(projectDir, 'session-bizfail.jsonl'), `${lines.join('\n')}\n`);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        return Response.json(
          { detail: { code: 'schema_validation_failed', msg: 'bad' } },
          { status: 422 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
        conversations: { uploadBatchSize: 1 },
      },
    });

    expect(result.lastError ?? '').toMatch(/422/);
    expect(result.lastError ?? '').not.toMatch(/服务端不可用/);
  });

  it('proactively refreshes the access token before each upload batch when within the expiry buffer', async () => {
    // Regression for "抱着抱着报权限错": a long multi-batch run outlasts the
    // access-token TTL. The token is captured once at the start, so without a
    // per-batch refresh the next POST ships an expired token → a permission
    // error mid-run. With the fix, getValidBearerToken runs before EVERY batch
    // and refreshes whenever the token is within EXPIRY_BUFFER_MS (90s).
    await writeFile(
      path.join(hermitHome, 'auth', 'openhermit.json'),
      JSON.stringify({
        token: {
          accessToken: 'near-expiry',
          refreshToken: 'rt',
          // 60s out ⇒ inside the 90s proactive-refresh buffer, same shape as a
          // token that will die mid-run if not refreshed.
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
    );
    // 3 messages, uploadBatchSize 2 ⇒ 2 batches.
    const projectDir = path.join(claudeBase, 'projects', '-tmp-refresh');
    await mkdir(projectDir, { recursive: true });
    const lines = [0, 1, 2].map((i) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'session-refresh',
        uuid: `msg-${i}`,
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: `m${i}`, model: 'claude-test-model' },
      })
    );
    await writeFile(path.join(projectDir, 'session-refresh.jsonl'), `${lines.join('\n')}\n`);

    let refreshCalls = 0;
    let messagesCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        return Response.json({
          access_token: `refreshed-${refreshCalls}`,
          token_type: 'Bearer',
          // Still within the 90s buffer ⇒ the next batch's getValidBearerToken
          // refreshes again, isolating the per-batch wiring from start-of-run.
          access_expires_in: 60,
          scope: 'upload:read upload:write report:read',
        });
      }
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        messagesCalls += 1;
        return Response.json(
          {
            ok: true,
            uploadId: `upl_${messagesCalls}`,
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
          },
          { status: 202 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
        conversations: { uploadBatchSize: 2 },
      },
    });

    // Both batches shipped...
    expect(messagesCalls).toBe(2);
    // ...and refresh fired once per batch PLUS the start-of-run getValidBearerToken
    // (≥ 3). Without the per-batch refresh, refreshCalls would be 1 (start only) and
    // a token expiring mid-run would surface as a permission error.
    expect(refreshCalls).toBeGreaterThanOrEqual(3);
    expect(result.lastError).toBeUndefined();
  });

  it('logs the transport-error cause (ECONNRESET) on failed batches, not a bare HTTP 599', async () => {
    // Regression for "只给个599，鬼知道哪里报错": safeFetch turns a transport
    // failure into a synthetic 599 with the cause in statusText. The diagnostic
    // + upload-response log must carry that statusText (fetch failed (ECONNRESET))
    // so the cause reaches lastError AND the persistent log — not a meaningless
    // "HTTP 599" that tells nobody what broke.
    const projectDir = path.join(claudeBase, 'projects', '-tmp-cause');
    await mkdir(projectDir, { recursive: true });
    const lines = [0, 1].map((i) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'session-cause',
        uuid: `msg-${i}`,
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: `m${i}`, model: 'claude-test-model' },
      })
    );
    await writeFile(path.join(projectDir, 'session-cause.jsonl'), `${lines.join('\n')}\n`);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/report/usage/status')) {
        return Response.json({
          channels: [
            {
              reporter: 'agentcli',
              client: 'claudecode',
              scene: 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNRESET', message: 'socket hang up' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await uploadConversationMessages({
      telemetry: {
        enabled: true,
        platform: 'claudecode',
        conversationUploadEnabled: true,
        uploadProviders: ['claudecode'],
        conversations: { uploadBatchSize: 1 },
      },
    });

    // The cause propagates to lastError via the diagnostic (now including
    // statusText), not a bare "HTTP 599".
    expect(result.lastError ?? '').toMatch(/ECONNRESET/);

    // The persistent upload log captures the cause per failed batch too.
    const logPath = path.join(hermitHome, 'logs', 'conversation-upload.log');
    const logText = await readFile(logPath, 'utf-8');
    const responseEntries = logText
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as { message?: string; status?: number; statusText?: string };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { message: string; status: number; statusText: string } =>
        Boolean(entry && entry.message === 'upload-response')
      );
    expect(responseEntries.length).toBeGreaterThan(0);
    for (const entry of responseEntries) {
      expect(entry.status).toBe(599);
      expect(entry.statusText).toMatch(/ECONNRESET/);
    }
  });
});
