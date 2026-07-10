// update.mjs — `update` (self-update via git tag or npm) and `add <plugin>`
// (register a feature plugin into the MCP library) commands.

import { execSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { currentVersion, repoRoot } from './env.mjs';
import { BRAND, brandCommand, brandLogPrefix } from '../branding.mjs';
import { migrateLegacyHermitBridgeConfigIfNeeded } from './runtime.mjs';

async function runUpdate({ onUpdated } = {}) {
  const isGitRepo = existsSync(path.join(repoRoot, '.git'));

  if (isGitRepo) {
    // Git repo: check GitHub releases and checkout latest tag
    console.log(`${brandLogPrefix()} Checking for updates...`);
    try {
      const res = await fetch(`https://api.github.com/repos/${BRAND.githubRepo}/releases/latest`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`${brandLogPrefix()} Failed to check GitHub releases (HTTP ${res.status})`);
        process.exit(1);
      }
      const data = await res.json();
      const latestVersion = data.tag_name?.replace(/^v/, '');
      if (!latestVersion) {
        console.error(`${brandLogPrefix()} No release found on GitHub`);
        process.exit(1);
      }
      if (latestVersion === currentVersion) {
        migrateLegacyHermitBridgeConfigIfNeeded();
        console.log(`${brandLogPrefix()} Already on latest version (${currentVersion})`);
        process.exit(0);
      }
      console.log(`${brandLogPrefix()} Current: ${currentVersion} → Latest: ${latestVersion}`);
      console.log(`${brandLogPrefix()} Fetching latest changes...`);
      execSync('git fetch --tags', { cwd: repoRoot, stdio: 'inherit' });
      console.log(`${brandLogPrefix()} Checking out v${latestVersion}...`);
      execSync(`git checkout v${latestVersion}`, { cwd: repoRoot, stdio: 'inherit' });
      console.log(`${brandLogPrefix()} Installing dependencies...`);
      execSync('npm install', { cwd: repoRoot, stdio: 'inherit' });
      console.log(`${brandLogPrefix()} Building frontend...`);
      execSync('npm run build:web', { cwd: repoRoot, stdio: 'inherit' });
      migrateLegacyHermitBridgeConfigIfNeeded();
      // Files just changed (checkout + install + build): reload the live usage
      // worker so it picks up the new code without waiting for a manual restart.
      await onUpdated?.();
      console.log(`\n${brandLogPrefix()} Updated to ${latestVersion}. Restart with: ${brandCommand('restart')}\n`);
    } catch (err) {
      console.error(`${brandLogPrefix()} Update failed:`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    // npm install: directly update to latest
    console.log(`${brandLogPrefix()} Updating via npm...`);
    try {
      // Pin the official registry: a user's default registry (e.g. npmmirror)
      // can lag behind registry.npmjs.org, so @latest resolved there may be
      // stale or missing → silent staleness or ETARGET. Self-update always
      // pulls the true latest from the authoritative source.
      execSync(`npm install -g ${BRAND.npmPackage}@latest --registry=https://registry.npmjs.org/`, { stdio: 'inherit' });
      migrateLegacyHermitBridgeConfigIfNeeded();
      // Files just changed (global reinstall): reload the live usage worker so
      // it picks up the new code without waiting for a manual restart.
      await onUpdated?.();
      console.log(`\n${brandLogPrefix()} Updated successfully. Restart with: ${brandCommand('restart')}\n`);
    } catch (err) {
      // Platform-aware fallback. `sudo` does not exist on Windows, and the
      // common failure there is EBUSY — a lingering agentcli process holds
      // the package files (not a permissions issue) — so steer Windows users to
      // release the lock. macOS/Linux may genuinely need sudo for a root-owned
      // global prefix.
      const hint =
        process.platform === 'win32'
          ? `先关闭所有运行中的 agentcli 进程（或重启电脑）再重试：npm install -g ${BRAND.npmPackage}@latest --prefer-online`
          : `Try: sudo npm install -g ${BRAND.npmPackage}@latest`;
      console.error(`${brandLogPrefix()} npm update failed. ${hint}`);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// add <plugin> - install a feature plugin into the MCP library
// ---------------------------------------------------------------------------

/**
 * Known installable feature plugins. Each maps a `agentcli add <name>` key to
 * the MCP library entry it registers (pointing at a hermit-served MCP endpoint).
 * Mirrors src/features/worker-society/main/composition/workerSocietyPlugin.ts.
 */
const KNOWN_PLUGINS = {
  'worker-society': {
    name: 'worker-society',
    description:
      '去中心化 worker 自治社会：agent 通过 society_* 工具发布需求、自荐、择优选派、积累声誉与关系，替代中心化派单。',
    endpoint: '/mcp',
    transport: 'sse',
    hint: 'society_* tools (publish need / volunteer / auto-select …)',
  },
};

async function runAddPlugin(pluginName, port) {
  if (!pluginName) {
    console.error(`${brandLogPrefix()} Usage: ${brandCommand('add <plugin-name>')}`);
    console.error(`${brandLogPrefix()} Known plugins: ${Object.keys(KNOWN_PLUGINS).join(', ')}`);
    process.exit(1);
  }

  const spec = KNOWN_PLUGINS[pluginName];
  if (!spec) {
    console.error(`${brandLogPrefix()} Unknown plugin: ${pluginName}`);
    console.error(`${brandLogPrefix()} Known plugins: ${Object.keys(KNOWN_PLUGINS).join(', ')}`);
    process.exit(1);
  }

  const base = `http://127.0.0.1:${port}`;
  const body = {
    name: spec.name,
    description: spec.description,
    installSpec: {
      type: 'http',
      url: `${base}${spec.endpoint}`,
      transportType: spec.transport,
    },
  };

  console.log(`${brandLogPrefix()} Installing plugin "${pluginName}" → registering MCP server ${body.installSpec.url}`);

  try {
    const res = await fetch(`${base}/api/extensions/mcp/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    // 服务端统一包成 { success, data | error }：HTTP 200 但 success:false 也算失败。
    const text = await res.text().catch(() => '');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON 响应，按 HTTP 状态兜底 */
    }
    const ok = res.ok && parsed && parsed.success !== false;
    const errMsg = parsed && typeof parsed.error === 'string' ? parsed.error : '';

    if (ok) {
      console.log(`${brandLogPrefix()} OK "${pluginName}" installed into the MCP library.`);
      console.log(`${brandLogPrefix()}   Agents can now use: ${spec.hint}`);
      console.log(`${brandLogPrefix()}   Enable it for a worker in the Extensions panel, or via the MCP library.`);
      return;
    }

    // 同名已存在 → 幂等视为已安装。
    if (res.status === 409 || /already exist|已存在|exists/i.test(errMsg)) {
      console.log(`${brandLogPrefix()} OK "${pluginName}" already in the MCP library (idempotent).`);
      return;
    }
    console.error(`${brandLogPrefix()} Install failed (HTTP ${res.status}): ${(errMsg || text).slice(0, 200)}`);
    process.exit(1);
  } catch (err) {
    console.error(`${brandLogPrefix()} Could not reach ${BRAND.stylizedName} at ${base}.`);
    console.error(`${brandLogPrefix()} ${err instanceof Error ? err.message : String(err)}`);
    console.error(`${brandLogPrefix()} Start it first with: ${brandCommand()}`);
    process.exit(1);
  }
}


export {
runUpdate,
runAddPlugin,
};
