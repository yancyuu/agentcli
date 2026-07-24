import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkLarkCliDigitalWorkerAuth,
  ensureLarkCliDigitalWorkerAuth,
  ensureLarkCliProfile,
  personalLarkProfileName,
} from '../larkCli.mjs';

const MOCK_DEVICE_CODE = 'test-device-code-abc123';
const MOCK_VERIFICATION_URL = 'https://open.feishu.cn/device-verify?code=abc123';

describe('ensureLarkCliProfile — reuse by app_id', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives one stable personal profile name per app_id', () => {
    expect(personalLarkProfileName('cli_worker')).toBe('agentcli-user-cli_worker');
    expect(personalLarkProfileName('')).toBe('');
  });

  it('reuses the existing profile for the same app_id instead of adding a new one', () => {
    const calls = [];
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, ...args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'profile' && args[1] === 'list') {
        // Faithful to the real lark-cli (v1.0.53): `profile list` has no --json
        // flag. Passing --json is rejected as unknown_flag; the plain subcommand
        // prints a JSON array. This guard locks the fix against re-adding --json.
        if (args.includes('--json')) {
          return { status: 1, stdout: JSON.stringify({ ok: false, error: { type: 'unknown_flag', message: 'unknown flag "--json" for "lark-cli profile list"' } }), stderr: '' };
        }
        return {
          status: 0,
          stdout: JSON.stringify([
            { name: 'cli_a9224b7d03f91bde', appId: 'cli_a9224b7d03f91bde', brand: 'feishu', active: true },
          ]),
          stderr: '',
        };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = ensureLarkCliProfile({
      profile: '222',
      appId: 'cli_a9224b7d03f91bde',
      appSecret: 'secret',
      brand: 'feishu',
    });

    expect(result).toMatchObject({ ok: true, reused: true, profile: 'cli_a9224b7d03f91bde' });
    // Must not call `profile add` when an existing profile already holds the app_id.
    expect(calls.some((c) => c[1] === 'profile' && c[2] === 'add')).toBe(false);
    // Must not pass the unsupported --json flag to `profile list`.
    const listCall = calls.find((c) => c[1] === 'profile' && c[2] === 'list');
    expect(listCall).toBeTruthy();
    expect(listCall.slice(3)).not.toContain('--json');
  });

  it('adds a new profile when the app_id is not registered yet', () => {
    const calls = [];
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, ...args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'profile' && args[1] === 'list') {
        return { status: 0, stdout: JSON.stringify([]), stderr: '' };
      }
      if (args[0] === 'profile' && args[1] === 'add') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = ensureLarkCliProfile({
      profile: 'new-worker',
      appId: 'cli_newapp',
      appSecret: 'secret',
      brand: 'feishu',
    });

    expect(result).toMatchObject({ ok: true, profile: 'new-worker' });
    expect(calls.some((c) => c[1] === 'profile' && c[2] === 'add')).toBe(true);
  });
});

describe('larkCli — digital worker authorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports missing Digital Worker scopes without accepting a profile-only authorization', () => {
    const calls = [];
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      // Use includes() instead of args[0/1] so the --profile prefix is tolerated.
      if (args.includes('auth') && args.includes('status')) {
        return { status: 0, stdout: '{"identities":{"user":{"available":true,"verified":true}}}', stderr: '' };
      }
      if (args.includes('auth') && args.includes('check')) {
        return { status: 0, stdout: '{"ok":false,"granted":["contact:user.basic_profile:readonly"],"missing":["docs:document.content:read","drive:drive:readonly","im:message.send_as_user"]}', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = checkLarkCliDigitalWorkerAuth({ profile: 'agentcli-user-cli_worker' });

    expect(result).toMatchObject({
      ok: false,
      missingScopes: ['docs:document.content:read', 'drive:drive:readonly', 'im:message.send_as_user'],
    });
    const check = calls.find(([, args]) => args.includes('auth') && args.includes('check'));
    expect(check[1][check[1].indexOf('--scope') + 1]).toContain('docs:document.content:read');
    expect(check[1][check[1].indexOf('--scope') + 1]).toContain('im:message.send_as_user');
  });

  it('initiates two-step device flow when auth is missing', async () => {
    const calls = [];
    // Synchronous spawn mock: initial check returns missing scopes, final check returns ok
    let checkCount = 0;
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status')
        return { status: 0, stdout: '{"identities":{"user":{"available":true,"verified":true,"userName":"测试"}}}', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'check') {
        checkCount++;
        // First check: missing scopes → triggers login flow
        // Second check (after poll succeeds): all scopes granted
        if (checkCount === 1) return { status: 0, stdout: '{"ok":false,"missing":["docs:document.content:read"]}', stderr: '' };
        return { status: 0, stdout: '{"ok":true,"granted":["docs:document.content:read"],"missing":null}', stderr: '' };
      }
      // --no-wait init step returns verification_url + device_code
      if (args.includes('--no-wait'))
        return {
          status: 0,
          stdout: JSON.stringify({ verification_url: MOCK_VERIFICATION_URL, device_code: MOCK_DEVICE_CODE }),
          stderr: '',
        };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    // Async spawn mock: returns a mock ChildProcess that feeds stdout payload then emits close
    vi.stubGlobal('__larkCli_test_spawn_async', (cmd, args) => {
      calls.push([cmd, args, 'async']);
      const isPoll = args.includes('--device-code');
      const stdoutPayload = isPoll ? '{"ok":true}' : '';
      const mkStream = (payload) => ({
        on: (ev, cb) => { if (ev === 'data') cb(payload); },
      });
      const proc = {
        stdout: mkStream(stdoutPayload),
        stderr: mkStream(''),
        on: (ev, cb) => {
          if (ev === 'close') cb(0);
          // 'error' handler registered but never emitted
        },
      };
      return proc;
    });

    const renderQrCalls = [];
    const renderStatusCalls = [];
    const result = await ensureLarkCliDigitalWorkerAuth(async (url, authState) => {
      renderQrCalls.push({ url, authState });
      return (status) => renderStatusCalls.push(status);
    });

    // Step 1: --no-wait init was called
    const init = calls.find(([, args]) => args.includes('--no-wait'));
    expect(init).toBeTruthy();
    expect(init[1]).toContain('--scope');
    expect(init[1][init[1].indexOf('--scope') + 1]).toContain('docs:document.content:read');
    expect(init[1][init[1].indexOf('--scope') + 1]).toContain('drive:drive:readonly');
    expect(init[1]).not.toContain('--domain');
    expect(init[1]).not.toContain('all');

    // renderQr was called with verification URL
    expect(renderQrCalls[0]?.url).toBe(MOCK_VERIFICATION_URL);
    expect(renderQrCalls[0]?.authState?.user?.userName).toBe('测试');
    expect(renderStatusCalls).toContain('completed');

    // Step 2: async poll with --device-code was called
    const poll = calls.find(([, args, mode]) => args.includes('--device-code') && mode === 'async');
    expect(poll).toBeTruthy();
    expect(poll[1]).toContain(MOCK_DEVICE_CODE);

    // Final auth check passed
    expect(result.ok).toBe(true);
    expect(result.authReady).toBe(true);
  });

  it('detects completion via authoritative auth check when device-code polling stays pending', async () => {
    const calls = [];
    let checkCount = 0;
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status') {
        return { status: 0, stdout: '{"identities":{"user":{"available":true,"verified":true,"userName":"测试"}}}', stderr: '' };
      }
      if (args[0] === 'auth' && args[1] === 'check') {
        checkCount += 1;
        if (checkCount === 1) {
          return { status: 0, stdout: '{"ok":false,"missing":["docs:document.content:read"]}', stderr: '' };
        }
        return { status: 0, stdout: '{"ok":true,"granted":["docs:document.content:read"],"missing":null}', stderr: '' };
      }
      if (args.includes('--no-wait')) {
        return {
          status: 0,
          stdout: JSON.stringify({ verification_url: MOCK_VERIFICATION_URL, device_code: MOCK_DEVICE_CODE }),
          stderr: '',
        };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    vi.stubGlobal('__larkCli_test_spawn_async', () => {
      const mkStream = (payload) => ({
        on: (ev, cb) => { if (ev === 'data') cb(payload); },
      });
      return {
        stdout: mkStream('{"error":{"subtype":"authorization_pending"}}'),
        stderr: mkStream(''),
        on: (ev, cb) => { if (ev === 'close') cb(1); },
      };
    });

    const renderStatuses = [];
    const result = await ensureLarkCliDigitalWorkerAuth(async () => (status) => renderStatuses.push(status));

    expect(result).toMatchObject({ ok: true, authReady: true });
    expect(checkCount).toBeGreaterThanOrEqual(3);
    expect(renderStatuses.at(-1)).toBe('completed');
  });

  it('skips login when required scopes are already granted', async () => {
    const calls = [];
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status')
        return { status: 0, stdout: '{"identities":{"user":{"available":true,"verified":true,"userName":"测试"}}}', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'check')
        return { status: 0, stdout: '{"ok":true,"granted":["docs:document.content:read"],"missing":null}', stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = await ensureLarkCliDigitalWorkerAuth();

    expect(result.ok).toBe(true);
    expect(result.authReady).toBe(true);
    expect(calls.some(([, args]) => args[0] === 'auth' && args[1] === 'login')).toBe(false);
  });

  it('force:true re-runs the device flow even when auth is already granted', async () => {
    // Regression: the digital-worker provisioning flow must always let the creator
    // refresh their personal authorization. Without force, the existing-auth check
    // short-circuits and skips the authorization screen the user expects.
    const calls = [];
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      calls.push([cmd, args]);
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status')
        return { status: 0, stdout: '{"identities":{"user":{"available":true,"verified":true,"userName":"测试"}}}', stderr: '' };
      // Existing auth is ALREADY ok — the short-circuit path the bug used to take.
      if (args[0] === 'auth' && args[1] === 'check')
        return { status: 0, stdout: '{"ok":true,"granted":["docs:document.content:read"],"missing":null}', stderr: '' };
      if (args.includes('--no-wait'))
        return {
          status: 0,
          stdout: JSON.stringify({ verification_url: MOCK_VERIFICATION_URL, device_code: MOCK_DEVICE_CODE }),
          stderr: '',
        };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });
    vi.stubGlobal('__larkCli_test_spawn_async', (cmd, args) => {
      calls.push([cmd, args, 'async']);
      const isPoll = args.includes('--device-code');
      const mkStream = (payload) => ({ on: (ev, cb) => { if (ev === 'data') cb(payload); } });
      return {
        stdout: mkStream(isPoll ? '{"ok":true}' : ''),
        stderr: mkStream(''),
        on: (ev, cb) => { if (ev === 'close') cb(0); },
      };
    });

    const result = await ensureLarkCliDigitalWorkerAuth(async () => () => {}, { force: true });

    // The device flow MUST run despite existing auth being valid.
    expect(calls.some(([, args]) => args.includes('--no-wait'))).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.authReady).toBe(true);
  });

  it('returns error when init step fails to produce verification_url', async () => {
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status')
        return { status: 0, stdout: '{"identities":{"user":{"available":true,"verified":true,"userName":"测试"}}}', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'check')
        return { status: 0, stdout: '{"ok":false,"missing":["docs:document.content:read"]}', stderr: '' };
      if (args.includes('--no-wait'))
        return { status: 1, stdout: '{"error":"network"}', stderr: 'login init failed' };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = await ensureLarkCliDigitalWorkerAuth();

    expect(result.ok).toBe(false);
    expect(result.authReady).toBe(false);
    expect(result.message).toContain('飞书授权初始化失败');
  });

  it('requires a bound personal user identity, not only a bot identity', async () => {
    vi.stubGlobal('__larkCli_test_spawn', (cmd, args) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm')) return { status: 0, stdout: cmd.includes('--version') ? '10.0.0\n' : '', stderr: '' };
      if (cmd === 'which' || cmd === 'where') return { status: 0, stdout: '/usr/local/bin/lark-cli\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status')
        return {
          status: 0,
          stdout: '{"identities":{"bot":{"available":true,"verified":true,"appName":"测试应用"}}}',
          stderr: '',
        };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = checkLarkCliDigitalWorkerAuth();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('需要绑定飞书个人身份');
  });
});
