import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setClaudeBasePathOverride } from '@main/utils/pathDecoder';
import { uploadConversationMessages } from '../ConversationMessageUploadService';

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
});
