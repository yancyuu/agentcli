/**
 * Provider-aware CLI environment builder.
 *
 * Builds an enriched environment for CLI processes that accounts for
 * provider-specific configuration (API keys, base URLs, etc.).
 *
 * NOTE: The full source in claude_agent_teams_ui depends on several services
 * not yet available in this project (ProviderConnectionService, OpenCodeRuntime,
 * codex-runtime-installer). This module provides the core interface and
 * environment building, falling back gracefully when those services are absent.
 */

import { buildEnrichedEnv } from '@main/utils/cliEnv';

export interface ProviderAwareCliEnvOptions {
  binaryPath?: string | null;
  providerId?: string;
  providerBackendId?: string | null;
  shellEnv?: NodeJS.ProcessEnv | null;
  env?: NodeJS.ProcessEnv;
  connectionMode?: 'strict' | 'augment';
  allowStoredApiKeyDecryption?: boolean;
  allowedStoredApiKeyEnvVarNames?: readonly string[];
  projectPath?: string;
}

export interface ProviderAwareCliEnvResult {
  env: NodeJS.ProcessEnv;
  connectionIssues: Record<string, string>;
  providerArgs: string[];
}

export async function buildProviderAwareCliEnv(
  options: ProviderAwareCliEnvOptions = {}
): Promise<ProviderAwareCliEnvResult> {
  const env = buildEnrichedEnv(options.binaryPath);

  // Remove ELECTRON_RUN_AS_NODE to prevent child processes from thinking
  // they are running in Node.js mode instead of Electron mode.
  delete env.ELECTRON_RUN_AS_NODE;

  // Inject project-level env vars (from CredentialService) when a projectPath is provided
  if (options.projectPath) {
    try {
      const { CredentialService } =
        await import('@main/services/extensions/credentials/CredentialService');
      const credentials = new CredentialService();
      const projectEnv = await credentials.resolveAgentEnv(options.projectPath);
      Object.assign(env, projectEnv);
    } catch {
      // Non-critical — CLI will use system env as fallback
    }
  }

  return {
    env,
    connectionIssues: {},
    providerArgs: [],
  };
}
