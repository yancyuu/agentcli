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
    process.env.OPENHERMIT_UPLOAD_STATUS_POLL_ATTEMPTS = '0';
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
    delete process.env.OPENHERMIT_UPLOAD_STATUS_POLL_ATTEMPTS;
    await rm(tmpDir, { recursive: true, force: true });
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
        message: { role: 'user', content: 'hello' },
      })}\n`
    );

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/hermit/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          feishu_authorized: true,
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/hermit/usage/status')) {
        return Response.json({
          channels: [
            {
              source: 'openhermit',
              platform: url.includes('platform=codex') ? 'codex' : 'claudecode',
              mode: url.includes('mode=im') ? 'im' : 'plain',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/hermit/conversation-messages')) {
        const body = JSON.parse(String(init?.body));
        expect(body).not.toHaveProperty('uploadId');
        expect(body).not.toHaveProperty('upload_id');
        expect(body.clientCursor).toMatchObject({
          schemaVersion: 1,
          purpose: 'local-jsonl-scan-position',
          messageCount: 1,
        });
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0]).toMatchObject({
          kind: 'conversation_message',
          eventId: 'claudecode:session-1:message-1',
          conversation: { conversationId: 'session-1', sessionRef: 'claudecode:session-1' },
          message: { messageRef: 'message-1' },
        });
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_server_generated',
            receiptId: 'receipt-1',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
            detailUrl: '/api/v1/hermit/uploads/upl_server_generated',
          },
          { status: 202 }
        );
      }
      if (url.endsWith('/api/v1/hermit/uploads/upl_server_generated')) {
        return Response.json({
          ok: true,
          uploadId: 'upl_server_generated',
          receiptId: 'receipt-1',
          status: 'success',
          accepted: 1,
          inserted: 1,
          duplicated: 0,
          rejected: 0,
          failed: 0,
          cursorCommitted: true,
          errors: [],
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

    expect(result.lastError).toBeUndefined();
    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.uploadIds).toEqual(['upl_server_generated']);
    await expect(
      readFile(path.join(hermitHome, 'telemetry', 'conversation-message-scan-cursor.json'), 'utf-8')
    ).rejects.toThrow();
  });

  it('skips uploading when server reports in-flight batches for the channel', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/hermit/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/hermit/usage/status')) {
        return Response.json({
          channels: [
            {
              source: 'openhermit',
              platform: url.includes('platform=codex') ? 'codex' : 'claudecode',
              mode: url.includes('mode=im') ? 'im' : 'plain',
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
    expect(result.uploadIds).toEqual(['upl_inflight', 'upl_inflight']);
    expect(result.lastError).toContain('服务端仍有处理中批次');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/hermit/conversation-messages'),
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
      if (url.endsWith('/api/v1/auth/hermit/refresh')) {
        refreshed = true;
        return Response.json({
          access_token: 'fresh',
          access_expires_in: 3600,
          scope: 'upload:read upload:write',
        });
      }
      if (url.endsWith('/api/v1/auth/hermit/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/hermit/usage/status')) {
        return Response.json({
          channels: [
            {
              source: 'openhermit',
              platform: 'claudecode',
              mode: url.includes('mode=im') ? 'im' : 'plain',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/hermit/conversation-messages')) {
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_refresh',
            status: 'queued',
            received: 1,
            acceptedForProcessing: 1,
            rejectedAtReceive: 0,
            detailUrl: '/api/v1/hermit/uploads/upl_refresh',
          },
          { status: 202 }
        );
      }
      if (url.endsWith('/api/v1/hermit/uploads/upl_refresh')) {
        return Response.json({
          ok: true,
          uploadId: 'upl_refresh',
          status: 'success',
          accepted: 1,
          inserted: 1,
          duplicated: 0,
          rejected: 0,
          failed: 0,
          cursorCommitted: true,
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

    expect(refreshed).toBe(true);
    expect(result.attempted).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.uploadIds).toEqual(['upl_refresh']);
    expect(result.lastError).toBeUndefined();
  });

  it('treats a server-confirmed success as uploaded even when counts diverge (cursor authoritative)', async () => {
    // 3 messages attempted, but the server's accepted + duplicated (2) < attempted.
    // Counts can lag in a multi-server backend (items in-flight on another node);
    // the authoritative signal is the committed cursor (batch success), not the
    // count equality — so this must NOT be flagged as an error / failed upload.
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    const lines = [1, 2, 3].map((i) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'session-diverge',
        uuid: `m${i}`,
        cwd: '/tmp/project',
        timestamp: '2026-06-24T08:20:00.000Z',
        message: { role: 'user', content: `hello ${i}` },
      })
    );
    await writeFile(path.join(projectDir, 'session-diverge.jsonl'), `${lines.join('\n')}\n`);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/auth/hermit/me')) {
        return Response.json({
          authenticated: true,
          status: 'ok',
          scopes: ['upload:read', 'upload:write'],
        });
      }
      if (url.includes('/api/v1/hermit/usage/status')) {
        return Response.json({
          channels: [
            {
              source: 'openhermit',
              platform: 'claudecode',
              mode: 'plain',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/hermit/conversation-messages')) {
        return Response.json(
          {
            ok: true,
            uploadId: 'upl_div',
            status: 'queued',
            received: 3,
            acceptedForProcessing: 3,
            rejectedAtReceive: 0,
            detailUrl: '/api/v1/hermit/uploads/upl_div',
          },
          { status: 202 }
        );
      }
      if (url.endsWith('/api/v1/hermit/uploads/upl_div')) {
        // success, but accepted (2) < attempted (3) — counts diverge.
        return Response.json({
          ok: true,
          uploadId: 'upl_div',
          status: 'success',
          accepted: 2,
          duplicated: 0,
          rejected: 0,
          failed: 0,
          cursorCommitted: true,
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

    expect(result.attempted).toBe(3);
    expect(result.lastUploadStatus).toBe('success');
    expect(result.accepted).toBe(2);
    // Cursor committed (success) even though the count (2) < attempted (3).
    expect(result.lastError).toBeUndefined();
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
});
