// Tests for bin/lib/aikey.mjs system-env injection — the claim-time write of the
// claimed key into REAL environment variables:
//   • macOS/Linux: an idempotent marked block in ~/.zshrc / ~/.bashrc so every new
//     shell exports the key (macOS also gets `launchctl setenv` for GUI apps);
//   • Windows: HKCU user environment via [Environment]::SetEnvironmentVariable.
//
// The legacy per-prompt precmd hook stays REMOVED — this is a one-shot write at
// claim time, and every surface is best-effort (a failing surface must never fail
// the claim itself). All fs/spawn surfaces are injected so the test never touches
// the developer's real shell rc files, launchctl, or registry.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  applyShellRcEnv,
  applyToEnvironment,
  renderShellEnvBlock,
  systemEnvVarsForClaim,
  upsertMarkedBlock,
} from '../aikey.mjs';

const VARS = {
  ANTHROPIC_AUTH_TOKEN: 'sk-live-token',
  ANTHROPIC_BASE_URL: 'https://gw.example/anthropic',
  OPENAI_API_KEY: 'sk-live-token',
  OPENAI_BASE_URL: 'https://gw.example/v1',
};

describe('renderShellEnvBlock', () => {
  it('wraps exports in hermit markers and skips empty values', () => {
    const block = renderShellEnvBlock({ ...VARS, EMPTY_VAR: '' });
    const lines = block.split('\n');
    expect(lines[0]).toBe('# >>> hermit aikey >>>');
    expect(block).toContain('# <<< hermit aikey <<<');
    expect(block).toContain('export ANTHROPIC_AUTH_TOKEN="sk-live-token"');
    expect(block).toContain('export OPENAI_BASE_URL="https://gw.example/v1"');
    expect(block).not.toContain('EMPTY_VAR');
  });

  it('escapes characters that are special inside POSIX double quotes', () => {
    const block = renderShellEnvBlock({ SOME_KEY: 'a"b$c\\d`e' });
    expect(block).toContain('export SOME_KEY="a\\"b\\$c\\\\d\\`e"');
  });
});

describe('upsertMarkedBlock', () => {
  it('appends to an empty file', () => {
    const out = upsertMarkedBlock('', renderShellEnvBlock(VARS));
    expect(out).toContain('export OPENAI_API_KEY="sk-live-token"');
  });

  it('replaces an existing hermit block in place and preserves user content around it', () => {
    const before = '# my rc\nalias gs="git status"\n';
    const after = '\n# user tail\nexport USER_VAR="keep"\n';
    const first = upsertMarkedBlock(before + after, renderShellEnvBlock({ A: '1' }));
    const second = upsertMarkedBlock(first, renderShellEnvBlock({ B: '2' }));

    expect(second).toContain('alias gs="git status"');
    expect(second).toContain('export USER_VAR="keep"');
    expect(second).toContain('export B="2"');
    expect(second).not.toContain('export A="1"');
    // Exactly one block — the update is idempotent, not cumulative.
    expect(second.match(/# >>> hermit aikey >>>/g)).toHaveLength(1);
  });

  it('appends a fresh block when markers are malformed (begin without end)', () => {
    const broken = '# >>> hermit aikey >>>\nexport STALE="x"\n# no end marker\n';
    const out = upsertMarkedBlock(broken, renderShellEnvBlock(VARS));
    expect(out).toContain('# no end marker'); // user content untouched
    expect(out.match(/export ANTHROPIC_AUTH_TOKEN="sk-live-token"/g)).toHaveLength(1);
  });
});

describe('applyShellRcEnv', () => {
  let home;
  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-env-'));
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('always writes the primary rc file, writes secondary only when it exists, and backs up pre-existing files', async () => {
    const plan = [
      { name: '.zshrc', always: true },
      { name: '.bashrc', always: false },
    ];
    const first = applyShellRcEnv({ vars: VARS, home, plan });
    expect(first.find((r) => r.surface.endsWith('.zshrc'))?.ok).toBe(true);
    expect(first.find((r) => r.surface.endsWith('.bashrc'))?.skipped).toBe(true);
    const zshrc = await readFile(path.join(home, '.zshrc'), 'utf-8');
    expect(zshrc).toContain('export ANTHROPIC_AUTH_TOKEN="sk-live-token"');
    expect(existsSync(path.join(home, '.bashrc'))).toBe(false);

    // Pre-existing .bashrc gets the block too — and a .hermit-bak backup first.
    await writeFile(path.join(home, '.bashrc'), 'export PATH="/x:$PATH"\n');
    const second = applyShellRcEnv({ vars: { ...VARS, ANTHROPIC_AUTH_TOKEN: 'sk-rotated' }, home, plan });
    expect(second.find((r) => r.surface.endsWith('.bashrc'))?.ok).toBe(true);
    const bashrc = await readFile(path.join(home, '.bashrc'), 'utf-8');
    expect(bashrc).toContain('export PATH="/x:$PATH"');
    expect(bashrc).toContain('export ANTHROPIC_AUTH_TOKEN="sk-rotated"');
    const bak = await readFile(path.join(home, '.bashrc.hermit-bak'), 'utf-8');
    expect(bak).toBe('export PATH="/x:$PATH"\n');

    // .zshrc updated idempotently (rotation replaces, never duplicates).
    const zshrc2 = await readFile(path.join(home, '.zshrc'), 'utf-8');
    expect(zshrc2.match(/ANTHROPIC_AUTH_TOKEN/g)).toHaveLength(1);
    expect(zshrc2).toContain('sk-rotated');
  });
});

describe('applyToEnvironment — platform routing', () => {
  let home;
  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-sysenv-'));
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('darwin: writes rc block AND launchctl setenv per var', () => {
    const spawnImpl = vi.fn(() => ({ status: 0 }));
    const result = applyToEnvironment({ vars: VARS, home, platform: 'darwin', spawnImpl });

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(home, '.zshrc'))).toBe(true);
    const calls = spawnImpl.mock.calls.filter(([bin]) => bin === 'launchctl');
    expect(calls).toHaveLength(Object.keys(VARS).length);
    expect(calls[0]).toEqual(['launchctl', ['setenv', 'ANTHROPIC_AUTH_TOKEN', 'sk-live-token'], expect.anything()]);
  });

  it('linux: writes rc only, never launchctl', () => {
    const spawnImpl = vi.fn(() => ({ status: 0 }));
    const result = applyToEnvironment({ vars: VARS, home, platform: 'linux', spawnImpl });

    expect(result.ok).toBe(true);
    expect(spawnImpl.mock.calls.filter(([bin]) => bin === 'launchctl')).toHaveLength(0);
    expect(existsSync(path.join(home, '.bashrc'))).toBe(true);
  });

  it('win32: writes the HKCU user env via PowerShell, secrets over stdin — never argv', async () => {
    // Fresh home: the darwin test above already wrote a .zshrc into the shared one.
    const winHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-sysenv-win-'));
    try {
      const spawnImpl = vi.fn(() => ({ status: 0 }));
      const result = applyToEnvironment({ vars: VARS, home: winHome, platform: 'win32', spawnImpl });

      expect(result.ok).toBe(true);
      expect(spawnImpl).toHaveBeenCalledOnce();
      const [bin, args, opts] = spawnImpl.mock.calls[0];
      expect(bin).toBe('powershell');
      expect(args.join(' ')).toContain('SetEnvironmentVariable');
      expect(args.join(' ')).not.toContain('sk-live-token'); // no plaintext in argv
      expect(JSON.parse(opts.input)).toMatchObject({ ANTHROPIC_AUTH_TOKEN: 'sk-live-token' });
      // No shell rc files on Windows.
      expect(existsSync(path.join(winHome, '.zshrc'))).toBe(false);
      expect(existsSync(path.join(winHome, '.bashrc'))).toBe(false);
    } finally {
      await rm(winHome, { recursive: true, force: true });
    }
  });

  it('never throws and reports per-surface failure (a failing surface must not fail the claim)', () => {
    const spawnImpl = vi.fn(() => ({ status: 1, stderr: 'boom' }));
    const result = applyToEnvironment({ vars: VARS, home, platform: 'darwin', spawnImpl });

    expect(result.ok).toBe(false);
    expect(result.results.some((r) => !r.ok && r.surface === 'launchctl')).toBe(true);
    // rc write still succeeded — one bad surface does not abort the others.
    expect(result.results.some((r) => r.ok && r.surface.endsWith('.zshrc'))).toBe(true);
  });
});

describe('systemEnvVarsForClaim — vars built from a claimed secret', () => {
  const secret = {
    key: 'sk-claimed',
    endpoints: { anthropic: 'https://gw.example/anthropic', openai: 'https://gw.example' },
  };
  const endpoints = { claude: 'https://gw.example/anthropic', codex: 'https://gw.example/v1' };

  it('claude-only claim exports ANTHROPIC_AUTH_TOKEN + BASE_URL (not OPENAI_*)', () => {
    const vars = systemEnvVarsForClaim({ secret, endpoints, runtimes: ['claude'] });
    expect(vars).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'sk-claimed',
      ANTHROPIC_BASE_URL: 'https://gw.example/anthropic',
    });
  });

  it('codex-only claim exports OPENAI_API_KEY + BASE_URL (not ANTHROPIC_*)', () => {
    const vars = systemEnvVarsForClaim({ secret, endpoints, runtimes: ['codex'] });
    expect(vars).toEqual({
      OPENAI_API_KEY: 'sk-claimed',
      OPENAI_BASE_URL: 'https://gw.example/v1',
    });
  });

  it('both runtimes exports both families; missing endpoints omit BASE_URL', () => {
    const both = systemEnvVarsForClaim({ secret, endpoints, runtimes: ['claude', 'codex'] });
    expect(Object.keys(both).sort()).toEqual([
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
    ]);
    const noEndpoints = systemEnvVarsForClaim({ secret, endpoints: {}, runtimes: ['claude', 'codex'] });
    expect(noEndpoints).toEqual({ ANTHROPIC_AUTH_TOKEN: 'sk-claimed', OPENAI_API_KEY: 'sk-claimed' });
  });
});
