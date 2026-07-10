// Tests for bin/lib/aikey.mjs::applyToConfigs — the "config-file direct-write"
// half of token distribution. Writes the claimed gateway key into the LOCAL
// runtime configs (~/.claude/settings.json, ~/.codex/auth.json, ~/.codex/config.toml)
// WITHOUT clobbering unrelated keys or [projects.*] blocks, and backs up first.
//
// All paths are redirected under a temp `home` so the test never touches the
// developer's real ~/.claude or ~/.codex.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyClaimedSecret, applyToConfigs, resolveClaudeBaseUrl, resolveCodexBaseUrl } from '../aikey.mjs';

describe('applyToConfigs — Claude settings.json', () => {
  let home;

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-cfg-'));
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('deep-merges env and preserves unrelated top-level keys + existing env keys', async () => {
    const file = path.join(home, '.claude', 'settings.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({
      // Unrelated top-level keys that MUST survive the merge.
      hooks: { Stop: [{ type: 'command', command: 'echo bye' }] },
      model: 'claude-sonnet-4',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'old-secret',
        SOME_OTHER_VAR: 'keep-me',
      },
    }, null, 2));

    const result = applyToConfigs({
      key: 'sk-new',
      endpoint: 'https://gw.example',
      model: 'qwen-max',
      runtimes: ['claude'],
      home,
    });

    const written = JSON.parse(await readFile(file, 'utf-8'));
    // Unrelated top-level keys preserved.
    expect(written.hooks).toBeDefined();
    expect(written.model).toBe('claude-sonnet-4');
    // env merged: new values written, pre-existing unrelated var kept.
    expect(written.env.ANTHROPIC_BASE_URL).toBe('https://gw.example');
    // AUTH_TOKEN (not API_KEY) is the one Claude Code honors for a custom gateway.
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-new');
    expect(written.env.ANTHROPIC_MODEL).toBe('qwen-max');
    expect(written.env.SOME_OTHER_VAR).toBe('keep-me');

    const claude = result.runtimes.find((r) => r.runtime === 'claude');
    expect(claude.path).toBe(file);
    expect(claude.backupPath).toBeTruthy();
    expect(existsSync(claude.backupPath)).toBe(true);
  });

  it('creates ~/.claude/settings.json when none exists', async () => {
    const fresh = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-fresh-'));
    try {
      const file = path.join(fresh, '.claude', 'settings.json');
      applyToConfigs({ key: 'sk-x', endpoint: 'https://gw', model: 'm', runtimes: ['claude'], home: fresh });
      const written = JSON.parse(await readFile(file, 'utf-8'));
      expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-x');
      expect(written.env.ANTHROPIC_BASE_URL).toBe('https://gw');
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});

describe('applyToConfigs — Codex auth.json', () => {
  it('overwrites OPENAI_API_KEY and preserves sibling keys', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-codex-auth-'));
    try {
      const file = path.join(home, '.codex', 'auth.json');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({
        OPENAI_API_KEY: 'sk-old',
        tokens: { id_token: 'xxx', access_token: 'yyy' },
        custom_marker: 'preserve',
      }, null, 2));

      applyToConfigs({ key: 'sk-new', endpoint: 'https://gw', model: 'm', runtimes: ['codex'], home });

      const written = JSON.parse(await readFile(file, 'utf-8'));
      expect(written.OPENAI_API_KEY).toBe('sk-new');
      expect(written.tokens.id_token).toBe('xxx');
      expect(written.custom_marker).toBe('preserve');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe('applyToConfigs — Codex config.toml (surgical, no TOML lib)', () => {
  it('sets model_provider/model, (re)writes [model_providers.X], and preserves [projects.*] verbatim', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-codex-toml-'));
    try {
      const file = path.join(home, '.codex', 'config.toml');
      await mkdir(path.dirname(file), { recursive: true });
      const seed = `# my codex config
model = "gpt-5"
model_provider = "openai"
approval_policy = "untrusted"

[model_providers.openai]
name = "OpenAI"
base_url = "https://api.openai.com/v1"
wire_api = "responses"

[projects.my-project]
path = "/Users/me/work"
autoupdate = true

[projects.my-project.history]
size = 1000
`;
      await writeFile(file, seed);

      applyToConfigs({
        key: 'sk-new',
        endpoint: 'https://gw.example',
        model: 'qwen-max',
        wireApi: 'chat',
        runtimes: ['codex'],
        home,
      });

      const out = await readFile(file, 'utf-8');

      // model + model_provider rewritten at top level.
      expect(out).toMatch(/^model = "qwen-max"/m);
      // The provider name is REUSED from the existing model_provider ("openai").
      expect(out).toMatch(/^model_provider = "openai"/m);

      // The [model_providers.openai] block now points at the gateway with wire_api=chat.
      expect(out).toMatch(/\[model_providers\.openai\]/);
      expect(out).toMatch(/base_url = "https:\/\/gw\.example"/);
      expect(out).toMatch(/wire_api = "chat"/);
      expect(out).toMatch(/requires_openai_auth = true/);

      // [projects.*] blocks — the whole point of surgical edits — survive intact.
      expect(out).toContain('[projects.my-project]');
      expect(out).toMatch(/path = "\/Users\/me\/work"/);
      expect(out).toContain('[projects.my-project.history]');
      expect(out).toMatch(/size = 1000/);

      // Backup created from the seed.
      expect(existsSync(`${file}.hermit-bak`)).toBe(true);
      expect(await readFile(`${file}.hermit-bak`, 'utf-8')).toBe(seed);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('defaults the provider name to "hermit" when no model_provider exists', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aikey-codex-toml-bare-'));
    try {
      const file = path.join(home, '.codex', 'config.toml');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `# bare\napproval_policy = "untrusted"\n`);

      applyToConfigs({
        key: 'sk-new',
        endpoint: 'https://gw.example',
        model: 'qwen-max',
        wireApi: 'chat',
        runtimes: ['codex'],
        home,
      });

      const out = await readFile(file, 'utf-8');
      expect(out).toMatch(/^model_provider = "hermit"/m);
      expect(out).toMatch(/^model = "qwen-max"/m);
      expect(out).toMatch(/\[model_providers\.hermit\]/);
      expect(out).toMatch(/base_url = "https:\/\/gw\.example"/);
      // Pre-existing top-level key preserved.
      expect(out).toMatch(/approval_policy = "untrusted"/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe('resolveClaudeBaseUrl', () => {
  it('returns the gateway endpoint verbatim', () => {
    expect(resolveClaudeBaseUrl({ endpoint: 'https://ai.skg.com/cpamc-cc' })).toBe('https://ai.skg.com/cpamc-cc');
  });
  it('trims whitespace and tolerates a missing endpoint', () => {
    expect(resolveClaudeBaseUrl({ endpoint: '  https://gw.example  ' })).toBe('https://gw.example');
    expect(resolveClaudeBaseUrl({})).toBe('');
  });
});

describe('resolveCodexBaseUrl', () => {
  it('resolves a relative proxy route against a trailing-slash endpoint and strips the chat suffix', () => {
    const secret = {
      endpoint: 'https://ai.skg.com/cpamc/',
      proxyPaths: { openai_chat: 'codex/chat/completions' },
    };
    expect(resolveCodexBaseUrl(secret, 'chat')).toBe('https://ai.skg.com/cpamc/codex');
  });
  it('uses standard URL resolution: a non-trailing-slash endpoint replaces its last segment', () => {
    const secret = {
      endpoint: 'https://ai.skg.com/cpamc',
      proxyPaths: { openai_chat: 'codex/chat/completions' },
    };
    expect(resolveCodexBaseUrl(secret, 'chat')).toBe('https://ai.skg.com/codex');
  });
  it('strips the responses suffix when wireApi=responses', () => {
    const secret = {
      endpoint: 'https://ai.skg.com/cpamc/',
      proxyPaths: { openai_responses: 'codex/responses' },
    };
    expect(resolveCodexBaseUrl(secret, 'responses')).toBe('https://ai.skg.com/cpamc/codex');
  });
  it('accepts an absolute proxy route URL (ignores the base)', () => {
    const secret = {
      endpoint: 'https://unused.example',
      proxyPaths: { openai_chat: 'https://ai.skg.com/codex/chat/completions' },
    };
    expect(resolveCodexBaseUrl(secret, 'chat')).toBe('https://ai.skg.com/codex');
  });
  it('falls back to the raw endpoint when no proxy route is declared', () => {
    expect(resolveCodexBaseUrl({ endpoint: 'https://gw.example' }, 'chat')).toBe('https://gw.example');
  });
  it('throws an /endpoint/ error when the endpoint is missing or unparseable', () => {
    expect(() => resolveCodexBaseUrl({ proxyPaths: { openai_chat: 'x/chat/completions' } }, 'chat')).toThrow(
      /endpoint/,
    );
    expect(() =>
      resolveCodexBaseUrl({ endpoint: 'not-a-url', proxyPaths: { openai_chat: 'x/chat/completions' } }, 'chat'),
    ).toThrow(/endpoint/);
  });
});

describe('applyClaimedSecret — per-runtime writes', () => {
  it('writes only Codex when runtimes=[codex] and leaves Claude untouched', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-claim-codex-only-'));
    try {
      const result = applyClaimedSecret({
        secret: {
          key: 'sk-pool',
          endpoint: 'https://ai.skg.com/cpamc/',
          proxyPaths: { openai_chat: 'codex/chat/completions' },
        },
        choices: { model: 'qwen-max', wireApi: 'chat' },
        runtimes: ['codex'],
        home,
      });
      // Endpoints recorded; codex resolved, claude absent.
      expect(result.endpoints.codex).toBe('https://ai.skg.com/cpamc/codex');
      expect(result.endpoints.claude).toBeUndefined();

      // Codex auth + config written.
      const auth = JSON.parse(await readFile(path.join(home, '.codex', 'auth.json'), 'utf-8'));
      expect(auth.OPENAI_API_KEY).toBe('sk-pool');
      const toml = await readFile(path.join(home, '.codex', 'config.toml'), 'utf-8');
      expect(toml).toMatch(/base_url = "https:\/\/ai\.skg\.com\/cpamc\/codex"/);
      expect(toml).toMatch(/^model = "qwen-max"/m);

      // Claude NOT created.
      expect(existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
      // backup:false → no .hermit-bak files anywhere.
      expect(existsSync(path.join(home, '.codex', 'auth.json.hermit-bak'))).toBe(false);
      expect(existsSync(path.join(home, '.codex', 'config.toml.hermit-bak'))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('writes both runtimes with DIFFERENT endpoints, Claude unpinned from a model', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-claim-both-'));
    try {
      const result = applyClaimedSecret({
        secret: {
          key: 'sk-pool',
          endpoint: 'https://ai.skg.com/cpamc/',
          proxyPaths: { openai_chat: 'codex/chat/completions' },
        },
        choices: { model: 'qwen-max', wireApi: 'chat' },
        runtimes: ['claude', 'codex'],
        home,
      });
      // Two distinct endpoints: claude = raw gateway, codex = resolved proxy route.
      expect(result.endpoints.claude).toBe('https://ai.skg.com/cpamc/');
      expect(result.endpoints.codex).toBe('https://ai.skg.com/cpamc/codex');
      expect(result.endpoints.claude).not.toBe(result.endpoints.codex);

      const claude = JSON.parse(await readFile(path.join(home, '.claude', 'settings.json'), 'utf-8'));
      expect(claude.env.ANTHROPIC_BASE_URL).toBe('https://ai.skg.com/cpamc/');
      expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-pool');
      // Claude is NOT pinned to a model (no ANTHROPIC_MODEL).
      expect(claude.env.ANTHROPIC_MODEL).toBeUndefined();

      // No .hermit-bak from a claim write.
      expect(existsSync(path.join(home, '.claude', 'settings.json.hermit-bak'))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('preserves [projects.*] blocks in an existing Codex config', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-claim-projects-'));
    try {
      const file = path.join(home, '.codex', 'config.toml');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        `model = "gpt-5"\n[projects.my-project]\npath = "/Users/me/work"\nautoupdate = true\n`,
      );

      applyClaimedSecret({
        secret: { key: 'sk-pool', endpoint: 'https://gw.example', proxyPaths: { openai_chat: 'codex/chat/completions' } },
        choices: { model: 'qwen-max', wireApi: 'chat' },
        runtimes: ['codex'],
        home,
      });

      const out = await readFile(file, 'utf-8');
      expect(out).toContain('[projects.my-project]');
      expect(out).toMatch(/path = "\/Users\/me\/work"/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('throws when the secret has no key', () => {
    expect(() =>
      applyClaimedSecret({ secret: { endpoint: 'https://gw' }, runtimes: ['claude'] }),
    ).toThrow(/key/);
  });
});
