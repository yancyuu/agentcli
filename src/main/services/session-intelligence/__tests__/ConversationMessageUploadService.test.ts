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
    delete process.env.HERMIT_USAGE_FOREGROUND_SCAN;
    delete process.env.HERMIT_USAGE_FULL_RESCAN;
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
              reporter: 'openhermit',
              client: url.includes('client=codex') ? 'codex' : 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
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
        expect(body).toMatchObject({ reporter: 'openhermit', client: { tool: 'claudecode' } });
        expect(body.messages[0]).toMatchObject({
          kind: 'conversation_message',
          eventId: 'claudecode:session-1:message-1',
          conversation: { conversationId: 'session-1', sessionRef: 'claudecode:session-1' },
          message: { messageRef: 'message-1', modelName: 'claude-test-model' },
        });
        expect(body.messages[0].message).not.toHaveProperty('model');
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

  it('attributes a Claude session to the IM channel via hermit-bridge composite + builds the IM-contract payload', async () => {
    // hermit-bridge indexes each IM conversation by TWO composite keys sharing the
    // same chat: one keyed by sender (ou_), one by the triggering message (on_).
    // Merging them yields an envelope with BOTH sender id and message id. The
    // legacy `sessions[*].agent_session_id` shape is kept too, exercising back-compat.
    const bridgeSessionsDir = path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
    await mkdir(bridgeSessionsDir, { recursive: true });
    await writeFile(
      path.join(bridgeSessionsDir, 'team-im.json'),
      JSON.stringify({
        user_sessions: {
          'feishu:oc_testchat:ou_testsender': ['im-session-1'],
          'feishu:oc_testchat:on_testmsgid': ['im-session-1'],
        },
        active_session: {
          'feishu:oc_testchat:ou_testsender': 'im-session-1',
          'feishu:oc_testchat:on_testmsgid': 'im-session-1',
        },
        user_meta: {
          'feishu:oc_testchat:ou_testsender': { chat_name: '研发群', user_name: '发送人' },
          'feishu:oc_testchat:on_testmsgid': { chat_name: '研发群' },
        },
        sessions: {
          s1: { id: 's1', agent_session_id: 'im-session-1', past_agent_session_ids: [] },
        },
      })
    );

    // Team that owns the agent workspace — routing.target resolves from the
    // session cwd matching this workDir.
    const teamDir = path.join(hermitHome, 'teams', 'test-team');
    await mkdir(teamDir, { recursive: true });
    await writeFile(
      path.join(teamDir, 'team.json'),
      JSON.stringify({ slug: 'test-team', displayName: '测试团队', workDir: '/tmp/project' })
    );

    // Logged-in tenant for the im.tenantKey field.
    await writeFile(
      path.join(hermitHome, 'auth', 'openhermit.json'),
      JSON.stringify({
        token: { accessToken: 'token', expiresAt: '2999-01-01T00:00:00.000Z' },
        account: { tenantKey: 'tenant-test' },
      })
    );

    // Claude session jsonl whose FILENAME equals agent_session_id, carrying NO
    // obj.im field — attribution relies entirely on the hermit-bridge intersection.
    const projectDir = path.join(claudeBase, 'projects', '-tmp-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'im-session-1.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'im-session-1',
        uuid: 'msg-1',
        cwd: '/tmp/project',
        timestamp: '2026-06-25T08:00:00.000Z',
        message: { role: 'user', content: 'from feishu', model: 'claude-im-model' },
      })}\n`
    );

    const posted = {
      plain: [] as Array<Record<string, any>>,
      im: [] as Array<Record<string, any>>,
    };
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
              reporter: 'openhermit',
              client: 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        // One unified endpoint: scene distinguishes digital_employee (IM) from coding (plain).
        if (body.scene === 'digital_employee') {
          posted.im.push(body);
          return Response.json(
            {
              ok: true,
              uploadId: 'upl-im',
              receiptId: 'r-im',
              status: 'queued',
              received: 1,
              acceptedForProcessing: 1,
              rejectedAtReceive: 0,
            },
            { status: 202 }
          );
        }
        posted.plain.push(body);
        return Response.json(
          {
            ok: true,
            uploadId: 'upl-plain',
            status: 'queued',
            received: 0,
            acceptedForProcessing: 0,
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
    // IM-origin session → routed to the IM endpoint; must NOT leak into plain.
    expect(posted.im).toHaveLength(1);
    expect(posted.plain).toHaveLength(0);

    const imPayload = posted.im[0];
    // Unified contract: scene flags digital_employee; schemaVersion is 1; the
    // client declares client.tool explicitly and MUST NOT send platform.
    expect(imPayload).toMatchObject({
      schemaVersion: 1,
      scene: 'digital_employee',
      reporter: 'openhermit',
      client: { tool: 'claudecode' },
    });
    expect(imPayload).not.toHaveProperty('platform');
    // No top-level project/conversation: every message carries its own context now.
    expect(imPayload).not.toHaveProperty('project');
    expect(imPayload).not.toHaveProperty('conversation');
    expect(imPayload.messages).toHaveLength(1);
    const imMessage = imPayload.messages[0];
    // Unified contract allows per-message project/conversation — IM KEEPS them.
    expect(imMessage).toMatchObject({
      kind: 'im_conversation_message',
      eventId: 'claudecode:im-session-1:msg-1',
      project: { projectRef: expect.any(String) },
      conversation: { conversationId: 'im-session-1', sessionRef: 'claudecode:im-session-1' },
      message: {
        messageRef: 'msg-1',
        modelName: 'claude-im-model',
        role: expect.any(String),
        content: expect.any(String),
      },
      im: {
        provider: 'feishu',
        channel: 'feishu',
        tenantKey: 'tenant-test',
        chat: { id: 'oc_testchat', type: 'group', name: '研发群' },
        sender: { id: 'ou_testsender', idType: 'open_id', name: '发送人' },
        message: { id: 'on_testmsgid' },
      },
      routing: {
        trigger: 'im_message',
        triggerSource: 'feishu',
        matchedBy: 'chat_id',
        routeRef: 'route-test-team',
        target: { type: 'team', teamSlug: 'test-team', teamName: '测试团队' },
      },
    });
    expect(imMessage.message).not.toHaveProperty('model');
    // Regression guard: the legacy `via` placeholder is gone (server 422s it).
    expect(imMessage.im).not.toHaveProperty('via');
    // Schema-aligned IM identifiers (ReportUploadIm): sender identity is senderId
    // (+ sender.id) — there is no userId field; the triggering message id is
    // imMessageId (+ message.id) — messageId is rejected as extra_forbidden.
    expect(imMessage.im).toMatchObject({
      chatId: 'oc_testchat',
      senderId: 'ou_testsender',
      imMessageId: 'on_testmsgid',
    });
    expect(imMessage.im).not.toHaveProperty('userId');
    expect(imMessage.im).not.toHaveProperty('messageId');
    // The owning team rides on the IM message so the service desk can attribute
    // traffic to a digital employee even before capabilities resolve.
    expect(imMessage.team).toMatchObject({
      teamSlug: 'test-team',
      teamName: '测试团队',
    });
    expect(imMessage.team).not.toHaveProperty('displayName');
  });

  it('attaches mcp/skills/cron/workflow capabilities to IM messages for the owning team', async () => {
    // hermit-bridge indexes the IM conversation by sender + triggering message.
    const bridgeSessionsDir = path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
    await mkdir(bridgeSessionsDir, { recursive: true });
    await writeFile(
      path.join(bridgeSessionsDir, 'team-cap.json'),
      JSON.stringify({
        user_sessions: { 'feishu:oc_capchat:ou_capsender': ['im-cap-1'] },
        active_session: { 'feishu:oc_capchat:ou_capsender': 'im-cap-1' },
        user_meta: {
          'feishu:oc_capchat:ou_capsender': { chat_name: '能力群', user_name: '提问人' },
        },
      })
    );

    // Owning team — capability lookup keys off teamName.
    const teamDir = path.join(hermitHome, 'teams', 'cap-team');
    await mkdir(teamDir, { recursive: true });
    await writeFile(
      path.join(teamDir, 'team.json'),
      JSON.stringify({ slug: 'cap-team', displayName: '能力团队', workDir: '/tmp/cap-project' })
    );

    // Install a capability pack for 能力团队 carrying one of each capability kind.
    const packDir = path.join(hermitHome, 'capability-packs', 'cap-pack');
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'cap-pack',
        name: '能力团队 能力',
        namespace: 'cap',
        version: '1.0.0',
        teamName: '能力团队',
        capabilities: {
          skills: [{ id: 'review', name: 'review', path: 'skills/review/SKILL.md' }],
          workflows: [{ id: 'loop-design', name: 'loop-design', path: 'workflows/loop.md' }],
          cron: [
            {
              id: 'weekday-report',
              name: '周报',
              cronExpression: '17 9 * * 1-5',
              prompt: 'run report',
              enabled: true,
            },
          ],
          mcpServers: [{ id: 'context7', name: 'context7', scope: 'user', transport: 'stdio' }],
        },
      })
    );

    const projectDir = path.join(claudeBase, 'projects', '-tmp-cap-project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'im-cap-1.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: 'im-cap-1',
        uuid: 'cap-msg-1',
        cwd: '/tmp/cap-project',
        timestamp: '2026-06-30T08:00:00.000Z',
        message: { role: 'user', content: 'from feishu', model: 'claude-im-model' },
      })}\n`
    );

    const posted = { im: [] as Array<Record<string, any>> };
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
              reporter: 'openhermit',
              client: 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
              status: 'never_reported',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
            },
          ],
        });
      }
      if (url.endsWith('/api/v1/report/messages')) {
        const body = JSON.parse(String(init?.body));
        if (body.scene === 'digital_employee') {
          posted.im.push(body);
          return Response.json(
            {
              ok: true,
              uploadId: 'upl-cap',
              status: 'queued',
              received: 1,
              acceptedForProcessing: 1,
            },
            { status: 202 }
          );
        }
        return Response.json(
          {
            ok: true,
            uploadId: 'upl-plain',
            status: 'queued',
            received: 0,
            acceptedForProcessing: 0,
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
    expect(posted.im).toHaveLength(1);
    const imMessage = posted.im[0].messages[0];
    // Capabilities ride ONLY under team.capabilities in the canonical IM shape:
    // skills + cron are Collections {count, items}; mcp + workflows are arrays. Each
    // item uses the per-kind ref field (capabilityRef/serverRef/workflowRef/cronRef),
    // never the raw telemetry id.
    expect(imMessage.capabilities).toBeUndefined();
    expect(imMessage.team?.capabilities).toMatchObject({
      schemaVersion: 1,
      source: 'agent-registry',
      skills: {
        count: 1,
        items: [{ capabilityRef: 'review', name: 'review', displayName: 'review' }],
      },
      mcp: [{ serverRef: 'context7', server: 'context7', transport: 'stdio' }],
      workflows: [{ workflowRef: 'loop-design', name: 'loop-design' }],
      cron: {
        count: 1,
        items: [{ cronRef: 'weekday-report', name: '周报', schedule: '17 9 * * 1-5' }],
      },
    });
    // Forbidden fields/keys must not leak (the live 422 root cause): no top-level
    // message.capabilities, no singular `workflow` key, no counts/fingerprint on the
    // capabilities object, and no description/scope/packId/id/kind on items.
    const caps = imMessage.team?.capabilities;
    expect(caps).not.toHaveProperty('workflow');
    expect(caps).not.toHaveProperty('counts');
    expect(caps).not.toHaveProperty('fingerprint');
    const capsJson = JSON.stringify(caps);
    for (const forbidden of ['description', 'packId', '"id"', '"kind"']) {
      expect(capsJson).not.toContain(forbidden);
    }
    expect(imMessage.team).toMatchObject({ teamName: '能力团队' });
    // No prompt/secret payloads leak through capability telemetry.
    const serialized = JSON.stringify(posted.im[0]);
    expect(serialized).not.toContain('run report');
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
              reporter: 'openhermit',
              client: url.includes('client=codex') ? 'codex' : 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
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
              reporter: 'openhermit',
              client: url.includes('client=codex') ? 'codex' : 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
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
              reporter: 'openhermit',
              client: 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
              status: url.includes('scene=digital_employee') ? 'never_reported' : 'success',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: null,
              lastUploadId: url.includes('scene=digital_employee')
                ? null
                : 'upl_prior_without_cursor',
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
              reporter: 'openhermit',
              client: 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
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
              reporter: 'openhermit',
              client: 'claudecode',
              scene: url.includes('scene=digital_employee') ? 'digital_employee' : 'coding',
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
