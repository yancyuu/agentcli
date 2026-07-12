// Tests for bin/lib/aikey.mjs::runAikeyManual — the agent-facing manual command.
//
// The manual reads local config files (aikey.env, settings.json, config.toml)
// and outputs variable names + base_url + model — NO plaintext key, NO network requests.
//
// All paths use isolated HOME so the test never touches real configs.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('runAikeyManual — agent-facing variable docs', () => {
  let home;
  let hermitHome;

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-manual-'));
    hermitHome = path.join(home, '.hermit');
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // Seed realistic files that a v3 claim would have written.
  async function seedClaimedFiles({ key = 'sk-real-key-abcdef1234567890' } = {}) {
    // ~/.hermit/aikey.env
    await mkdir(hermitHome, { recursive: true });
    await writeFile(path.join(hermitHome, 'aikey.env'), [
      `export OPENHERMIT_ACTIVE_KEY="agentcli"`,
      `export ANTHROPIC_API_KEY="${key}"`,
      `export ANTHROPIC_BASE_URL="https://ai.skg.com/cpamc-cc"`,
      `export OPENAI_API_KEY="${key}"`,
      `export OPENAI_BASE_URL="https://ai.skg.com/cpaopen"`,
    ].join('\n') + '\n');

    // ~/.claude/settings.json
    const claudeDir = path.join(home, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_BASE_URL: 'https://ai.skg.com/cpamc-cc',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
      },
    }, null, 2));

    // ~/.codex/auth.json (not read by manual — only has the key)
    const codexDir = path.join(home, '.codex');
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, 'auth.json'), JSON.stringify({
      OPENAI_API_KEY: key,
    }, null, 2));

    // ~/.codex/config.toml
    await writeFile(path.join(codexDir, 'config.toml'), [
      `model = "glm-5.2"`,
      `model_provider = "hermit"`,
      `approval_policy = "untrusted"`,
      ``,
      `[model_providers.hermit]`,
      `name = "hermit"`,
      `base_url = "https://ai.skg.com/cpaopen"`,
      `wire_api = "responses"`,
      `requires_openai_auth = true`,
    ].join('\n') + '\n');
  }

  it('returns variable names + base_url + tier models + codex model without plaintext key', async () => {
    await seedClaimedFiles();
    const { runAikeyManual } = await import('../aikey.mjs');
    const result = await runAikeyManual({ exitOnDone: false, home, hermitHome });

    // Env file info.
    expect(result.envFile).toContain('aikey.env');
    expect(result.envVars).toContain('ANTHROPIC_API_KEY');
    expect(result.envVars).toContain('ANTHROPIC_BASE_URL');
    expect(result.envVars).toContain('OPENAI_API_KEY');
    expect(result.envVars).toContain('OPENAI_BASE_URL');

    // Base URLs present (non-secret).
    expect(result.baseUrls.anthropic).toBe('https://ai.skg.com/cpamc-cc');
    expect(result.baseUrls.openai).toBe('https://ai.skg.com/cpaopen');

    // Claude tier vars (from settings.json — NOT ANTHROPIC_AUTH_TOKEN).
    expect(result.claude.tierVars.haiku).toBe('glm-4.5-air');
    expect(result.claude.tierVars.sonnet).toBe('glm-5.1');
    expect(result.claude.tierVars.opus).toBe('glm-5.2');
    expect(result.claude.baseUrl).toBe('https://ai.skg.com/cpamc-cc');

    // Codex config (from config.toml).
    expect(result.codex.model).toBe('glm-5.2');
    expect(result.codex.wireApi).toBe('responses');
    expect(result.codex.baseUrl).toBe('https://ai.skg.com/cpaopen');

    // CRITICAL: the output MUST NOT contain the plaintext key.
    const keyStr = 'sk-real-key-abcdef1234567890';
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(keyStr);
  });

  it('returns empty fields when config files are missing (graceful degradation)', async () => {
    // Use a completely separate home with no files — not the shared home that
    // other tests seeded.
    const emptyHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-manual-empty-'));
    const emptyHermitHome = path.join(emptyHome, '.hermit');
    try {
      const { runAikeyManual } = await import('../aikey.mjs');
      const result = await runAikeyManual({ exitOnDone: false, home: emptyHome, hermitHome: emptyHermitHome });

      expect(result.envVars).toEqual([]);
      expect(result.baseUrls).toEqual({});
      expect(result.claude).toEqual({});
      expect(result.codex).toEqual({});
    } finally {
      await rm(emptyHome, { recursive: true, force: true });
    }
  });

  it('does NOT include ANTHROPIC_AUTH_TOKEN in the output', async () => {
    await seedClaimedFiles();
    const { runAikeyManual } = await import('../aikey.mjs');
    const result = await runAikeyManual({ exitOnDone: false, home, hermitHome });

    // ANTHROPIC_AUTH_TOKEN is the secret; must not appear in structured output.
    expect(result.claude.authToken).toBeUndefined();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ANTHROPIC_AUTH_TOKEN');
  });
});
