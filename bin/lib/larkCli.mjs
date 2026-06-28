// larkCli.mjs — quick-install helper for the official Lark/Feishu CLI.
//
// Backs the "本地数字员工工作台 → 快速安装 lark-cli" menu action. The CLI is
// the npm package `@larksuite/cli` (binary `lark-cli`), per the project's own
// ops docs (scripts/build-pages.mjs expects a `lark-cli` binary on PATH).
//
// Stays in the bin/lib shape: importable, no import-time side effects, returns a
// structured result the caller renders. It only bootstraps the GLOBAL binary —
// the per-team profile wrapper (LARK_CLI_PROFILE in each team .env) is team
// setup, documented in scripts/build-pages.mjs, and intentionally out of scope.
import { spawnSync } from 'node:child_process';

const PACKAGE = '@larksuite/cli';
const BINARY = 'lark-cli';

function findBinary() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(cmd, [BINARY], { encoding: 'utf-8' });
    const found = (r.stdout || '').split(/\r?\n/)[0]?.trim();
    if (found) return found;
  } catch {
    // which/where unavailable — treat as not found.
  }
  return null;
}

function npmGlobalBin() {
  try {
    const r = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf-8', shell: true });
    const prefix = (r.stdout || '').trim();
    if (!prefix) return null;
    return process.platform === 'win32' ? prefix : `${prefix}/bin`;
  } catch {
    return null;
  }
}

/**
 * Ensures the `lark-cli` binary is available. Installs `@larksuite/cli` globally
 * via npm when missing. Resolves to a structured result (never throws) so the
 * menu can always render an outcome.
 */
export async function installLarkCli() {
  const existing = findBinary();
  if (existing) {
    return { ok: true, alreadyInstalled: true, binPath: existing, message: `已安装：${existing}` };
  }

  const npmCheck = spawnSync('npm', ['--version'], { encoding: 'utf-8', shell: true });
  if (npmCheck.status !== 0 || !(npmCheck.stdout || '').trim()) {
    return { ok: false, alreadyInstalled: false, message: '未检测到 npm，请先安装 Node.js / npm' };
  }

  // shell: true so npm.cmd resolves on Windows (spawn without shell → ENOENT).
  const install = spawnSync('npm', ['install', '-g', PACKAGE], { encoding: 'utf-8', shell: true });
  if (install.status !== 0) {
    return {
      ok: false,
      alreadyInstalled: false,
      message: `安装失败（npm exit ${install.status}）`,
      detail: (install.stderr || install.stdout || '').slice(-400),
    };
  }

  const installed = findBinary() || `${npmGlobalBin()}/${BINARY}`;
  return {
    ok: true,
    alreadyInstalled: false,
    binPath: installed,
    message: installed ? `已安装：${installed}` : '安装完成，但未在 PATH 找到 lark-cli（重开终端后再试）',
  };
}
