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

  // Invalidate CLI status cache
  app.post('/api/cli/invalidate-status', async (_request, reply) => {
    cachedStatus = null;
    return reply.send({ ok: true });
  });
}
