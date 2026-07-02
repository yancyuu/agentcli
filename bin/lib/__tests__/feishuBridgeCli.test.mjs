// feishuBridgeCli.test.mjs — unit tests for the pure pid-parsing core of the
// feishu-codex-bridge lifecycle helper. The installer/start/stop functions shell
// out to npm + the bridge binary and are exercised by the integration path; this
// file locks down the one piece of deterministic logic (service.pid → live pid)
// that the menu's 运行中/未启动/未安装 badge depends on.
import { describe, expect, it } from 'vitest';

import {
  parseFeishuBridgePid,
  parseFeishuBridgeWebConsole,
  ensureFeishuCodexBridge,
  configureFeishuBridge,
  feishuBridgeConfigured,
  startFeishuBridge,
  stopFeishuBridge,
  feishuBridgeStatus,
  feishuBridgeState,
  feishuBridgeWebUrl,
} from '../feishuBridgeCli.mjs';

describe('parseFeishuBridgePid — service.pid contents → pid number', () => {
  it('parses a bare numeric pid', () => {
    expect(parseFeishuBridgePid('12345')).toBe(12345);
  });

  it('parses a pid with surrounding whitespace / trailing newline', () => {
    expect(parseFeishuBridgePid('4242\n')).toBe(4242);
    expect(parseFeishuBridgePid('  7781 \r\n')).toBe(7781);
  });

  it('takes the first integer when the line has extra text', () => {
    expect(parseFeishuBridgePid('pid:9090')).toBe(9090);
  });

  it('returns null for empty / non-numeric garbage', () => {
    expect(parseFeishuBridgePid('')).toBeNull();
    expect(parseFeishuBridgePid('not-a-pid')).toBeNull();
    expect(parseFeishuBridgePid('\n  \n')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseFeishuBridgePid(null)).toBeNull();
    expect(parseFeishuBridgePid(undefined)).toBeNull();
    expect(parseFeishuBridgePid(12345)).toBeNull();
  });

  it('rejects 0 as a valid pid', () => {
    expect(parseFeishuBridgePid('0')).toBeNull();
  });
});

describe('parseFeishuBridgeWebConsole — web-console.json → tokenized URL', () => {
  // Guards the open-feishu-bridge-web action: it must turn the daemon's discovery
  // record into a 127.0.0.1 URL with the token as a query param (fcb's own format).
  it('builds a 127.0.0.1 URL with port + ?token= from the discovery record', () => {
    const r = parseFeishuBridgeWebConsole(JSON.stringify({ port: 51847, token: 'abc123', pid: 63573 }));
    expect(r.port).toBe(51847);
    expect(r.pid).toBe(63573);
    expect(r.url).toBe('http://127.0.0.1:51847/?token=abc123');
  });

  it('URL-encodes the token so special chars survive the query string', () => {
    const r = parseFeishuBridgeWebConsole(JSON.stringify({ port: 51847, token: 'a b/c+d' }));
    expect(r.url).toBe('http://127.0.0.1:51847/?token=a%20b%2Fc%2Bd');
  });

  it('tolerates a missing pid (port + token are enough to reach the console)', () => {
    const r = parseFeishuBridgeWebConsole(JSON.stringify({ port: 51847, token: 't' }));
    expect(r.url).toMatch(/:51847\/\?token=t$/);
    expect(r.pid).toBeNull();
  });

  it('returns null when port or token is missing / wrong type', () => {
    expect(parseFeishuBridgeWebConsole(JSON.stringify({ port: 51847 }))).toBeNull();
    expect(parseFeishuBridgeWebConsole(JSON.stringify({ token: 't' }))).toBeNull();
    expect(parseFeishuBridgeWebConsole(JSON.stringify({ port: '51847', token: 't' }))).toBeNull();
    expect(parseFeishuBridgeWebConsole(JSON.stringify({ port: 51847, token: '' }))).toBeNull();
  });

  it('returns null for malformed JSON / non-string input', () => {
    expect(parseFeishuBridgeWebConsole('{not json')).toBeNull();
    expect(parseFeishuBridgeWebConsole(null)).toBeNull();
    expect(parseFeishuBridgeWebConsole(undefined)).toBeNull();
  });
});

describe('feishuBridgeCli — public lifecycle surface', () => {
  // Guards the contract hermit.mjs depends on: these names must exist and return
  // structured (never-throwing) results the menu can render.
  it('exports the expected lifecycle functions', () => {
    expect(typeof ensureFeishuCodexBridge).toBe('function');
    expect(typeof configureFeishuBridge).toBe('function');
    expect(typeof feishuBridgeConfigured).toBe('function');
    expect(typeof startFeishuBridge).toBe('function');
    expect(typeof stopFeishuBridge).toBe('function');
    expect(typeof feishuBridgeStatus).toBe('function');
    expect(typeof feishuBridgeState).toBe('function');
    expect(typeof feishuBridgeWebUrl).toBe('function');
    expect(typeof parseFeishuBridgeWebConsole).toBe('function');
  });

  it('feishuBridgeState returns a snapshot with the badge-critical fields', () => {
    const s = feishuBridgeState();
    expect(s).toEqual(
      expect.objectContaining({
        installed: expect.any(Boolean),
        configured: expect.any(Boolean),
        running: expect.any(Boolean),
        dataDir: expect.any(String),
      }),
    );
  });
});
