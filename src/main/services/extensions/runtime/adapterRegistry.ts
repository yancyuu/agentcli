/**
 * Adapter registry — maps harness types to their install adapters.
 */

import type { CcAgentType } from '@shared/types/ccConnect';

import type { HarnessInstallAdapter } from './HarnessInstallAdapter';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter';
import { CodexAdapter } from './CodexAdapter';
import { CursorAdapter } from './CursorAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { OpenCodeAdapter } from './OpenCodeAdapter';

const adapters = new Map<CcAgentType, HarnessInstallAdapter>();

function registerDefaults(): void {
  if (adapters.size > 0) return;
  const instances: HarnessInstallAdapter[] = [
    new ClaudeCodeAdapter(),
    new CodexAdapter(),
    new GeminiAdapter(),
    new OpenCodeAdapter(),
    new CursorAdapter(),
  ];
  for (const adapter of instances) {
    adapters.set(adapter.harnessType, adapter);
  }
}

export function getAdapter(harnessType: CcAgentType): HarnessInstallAdapter | null {
  registerDefaults();
  return adapters.get(harnessType) ?? null;
}

export function getAllAdapters(): HarnessInstallAdapter[] {
  registerDefaults();
  return [...adapters.values()];
}

export function getAdaptersForCapability(
  capability: 'plugins' | 'mcp' | 'skills'
): HarnessInstallAdapter[] {
  registerDefaults();
  return [...adapters.values()].filter((a) => {
    switch (capability) {
      case 'plugins':
        return a.supportsPlugins;
      case 'mcp':
        return a.supportsMcp;
      case 'skills':
        return a.supportsSkills;
    }
  });
}
