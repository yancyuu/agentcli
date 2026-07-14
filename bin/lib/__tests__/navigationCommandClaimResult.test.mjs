// navigationCommandClaimResult.test.mjs — locks down the token-claim result panel.
//
// Regression: when the user selects ONLY Claude Code (not Codex) as the write
// runtime, the panel used to show a misleading yellow warning:
//   "Codex model — receipt 未返回 model_ids，Codex 模型未写入，请手动指定"
// That warning was shown unconditionally whenever `choices.model` was null, even
// though the user simply never selected Codex. The Codex row must only appear
// when Codex was actually selected; "no model" is a real warning only then.
import { describe, expect, it } from 'vitest';

import { buildClaimResultRows } from '../navigationCommand.mjs';

const baseApply = {
  endpoints: { claude: 'https://ai.skg.com/cpamc-cc', codex: '' },
  tierModels: { haiku: 'GLM-4.5-Air', sonnet: 'GLM-4.5-Air', opus: 'GLM-4.5-Air' },
};

function rowsFor({ runtimes, model }) {
  return buildClaimResultRows({
    apply: baseApply,
    choices: { model, wireApi: 'responses' },
    runtimes,
    envFilePath: '/Users/x/.hermit/aikey.env',
    backupRootPath: '/Users/x/.hermit/agentcli.env.bak',
    backupCreated: false,
    maskedKey: 'aim_…GyP8',
  });
}

describe('buildClaimResultRows — Codex model row', () => {
  it('omits the Codex model row entirely when Codex was not selected', () => {
    const rows = rowsFor({ runtimes: ['claude'], model: null });

    const codexModelRows = rows.filter(([label]) => label === 'Codex model');
    expect(codexModelRows).toHaveLength(0);
    // The misleading warning text must never appear when Codex wasn't chosen.
    expect(rows.some((r) => String(r[1]).includes('receipt 未返回 model_ids'))).toBe(false);
  });

  it('shows the chosen Codex model when Codex is selected and a model is present', () => {
    const rows = rowsFor({ runtimes: ['codex'], model: 'glm-5.2' });

    expect(rows).toContainEqual(['Codex model', 'glm-5.2', 'info']);
  });

  it('warns about a missing model only when Codex was actually selected', () => {
    const rows = rowsFor({ runtimes: ['codex'], model: null });

    expect(rows).toContainEqual([
      'Codex model',
      'receipt 未返回 model_ids，Codex 模型未写入，请手动指定',
      'warn',
    ]);
  });
});
