/**
 * HTTP routes for CLI installer status in standalone mode.
 *
 * In Docker mode, Claude Code CLI is pre-installed globally.
 * These routes check its availability and version.
 */

import { getErrorMessage } from '@shared/utils/errorHandling';
import { createLogger } from '@shared/utils/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { CliProviderId, CliProviderStatus } from '@shared/types/cliInstaller';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:cliInstaller');
const execFileAsync = promisify(execFile);

interface CliStatusResult {
  installed: boolean;
  version: string | null;
  path: string | null;
  authenticated: boolean;
}

let cachedStatus: CliStatusResult | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000;

const providerStatusCache = new Map<string, { status: CliProviderStatus; at: number }>();
const PROVIDER_STATUS_CACHE_TTL_MS = 30000;

async function detectCliStatus(): Promise<CliStatusResult> {
  try {
    const { stdout: versionOut } = await execFileAsync('claude', ['--version'], {
      timeout: 5000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const version = versionOut.trim().split('\n')[0] || null;

    let path: string | null = null;
    try {
      const { stdout: whichOut } = await execFileAsync('which', ['claude'], { timeout: 3000 });
      path = whichOut.trim() || null;
    } catch {
      /* not found */
    }

    let authenticated = false;
    try {
      await execFileAsync('claude', ['auth', 'status'], {
        timeout: 5000,
        env: { ...process.env, NO_COLOR: '1' },
      });
      authenticated = true;
    } catch {
      /* not authenticated */
    }

    return { installed: true, version, path, authenticated };
  } catch {
    return { installed: false, version: null, path: null, authenticated: false };
  }
}

async function detectProviderStatus(providerId: CliProviderId): Promise<CliProviderStatus | null> {
  // Use 'claude auth status' to check authentication (works across all claude versions).
  // Note: claude auth status exits with code 1 when not logged in, but stdout still has JSON.
  let stdout = '';
  try {
    const result = await execFileAsync('claude', ['auth', 'status'], {
      timeout: 10000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    // Non-zero exit code is expected when not logged in — extract stdout from error
    const execErr = err as { stdout?: string; stderr?: string } | undefined;
    stdout = execErr?.stdout ?? '';
    if (!stdout) {
      logger.warn(`Failed to detect provider status for ${providerId}: ${getErrorMessage(err)}`);
      return null;
    }
  }

  try {
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const loggedIn = parsed.loggedIn === true;
    const authMethod = (parsed.authMethod as string) ?? null;

    // Only anthropic is authenticated via claude auth; other providers are not supported in Docker
    const isSupported = providerId === 'anthropic';
    const authenticated = isSupported && loggedIn;

    return {
      providerId,
      displayName: providerId === 'anthropic' ? 'Claude Code' : providerId,
      supported: isSupported,
      authenticated,
      authMethod: authenticated ? authMethod : null,
      verificationState: authenticated ? 'verified' : 'unknown',
      modelVerificationState: 'idle',
      statusMessage: authenticated ? 'Connected' : isSupported ? 'Not connected' : 'Not available',
      detailMessage: null,
      models: [],
      modelAvailability: [],
      canLoginFromUi: false,
      capabilities: {
        teamLaunch: authenticated,
        oneShot: authenticated,
        extensions: {
          skills: { status: authenticated ? 'supported' : 'unsupported', ownership: 'shared' },
          mcp: { status: authenticated ? 'supported' : 'unsupported', ownership: 'shared' },
          plugins: { status: authenticated ? 'supported' : 'unsupported', ownership: 'shared' },
          apiKeys: { status: authenticated ? 'supported' : 'unsupported', ownership: 'shared' },
        },
      },
      backend: authenticated ? { kind: 'claude-code', label: 'Claude Code' } : null,
    };
  } catch (error) {
    logger.warn(`Failed to parse provider status for ${providerId}: ${getErrorMessage(error)}`);
    return null;
  }
}

export function registerCliInstallerRoutes(app: FastifyInstance): void {
  // Get CLI status
  app.get('/api/cli/status', async (_request, reply) => {
    try {
      if (cachedStatus && Date.now() - cachedAt < CACHE_TTL_MS) {
        return reply.send(cachedStatus);
      }
      const status = await detectCliStatus();
      cachedStatus = status;
      cachedAt = Date.now();
      return reply.send(status);
    } catch (error) {
      logger.error('Error in GET /api/cli/status:', getErrorMessage(error));
      return reply.status(500).send({ error: getErrorMessage(error) });
    }
  });

  // Get provider status
  app.get<{ Params: { providerId: string } }>(
    '/api/cli/provider/:providerId/status',
    async (request, reply) => {
      try {
        const providerId = request.params.providerId as CliProviderId;
        const cached = providerStatusCache.get(providerId);
        if (cached && Date.now() - cached.at < PROVIDER_STATUS_CACHE_TTL_MS) {
          return reply.send(cached.status);
        }

        const status = await detectProviderStatus(providerId);
        if (status) {
          providerStatusCache.set(providerId, { status, at: Date.now() });
        }
        return reply.send(status);
      } catch (error) {
        logger.error(
          `Error in GET /api/cli/provider/${request.params.providerId}/status:`,
          getErrorMessage(error)
        );
        return reply.status(500).send({ error: getErrorMessage(error) });
      }
    }
  );

  // Invalidate CLI status cache
  app.post('/api/cli/invalidate-status', async (_request, reply) => {
    cachedStatus = null;
    providerStatusCache.clear();
    return reply.send({ ok: true });
  });
}
