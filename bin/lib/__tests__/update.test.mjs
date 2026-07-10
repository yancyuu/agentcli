import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(testDir, '../../hermit.mjs');

describe('agentcli update dispatch', () => {
  it('reloads a running usage worker after updating code', () => {
    const source = readFileSync(cliEntry, 'utf-8');

    expect(source).toMatch(
      /runUpdate\(\{\s*onUpdated:\s*restartUsageWorkerIfRunning\s*\}\)/
    );
  });
});
