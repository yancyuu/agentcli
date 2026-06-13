/**
 * cc-connect spawns each agent subprocess with `chdir(<project work_dir>)`. When a
 * project's work_dir is stale — or still the default template placeholder below —
 * every session fails at agent start with `chdir ...: no such file or directory`,
 * which cc-connect surfaces as "❌ 错误: 启动 Agent 会话失败". The session record is
 * created fine, so the user sees the success message AND the failure.
 *
 * This hit the Admin Loop hardest: its bind project is `my-project`, the same name
 * cc-connect ships as an unconfigured template (`work_dir = /path/to/your/project`).
 */

/** cc-connect's default template project work_dir — a placeholder that was never filled. */
export const CC_CONNECT_PLACEHOLDER_WORK_DIR = '/path/to/your/project';

/**
 * Decide whether a cc-connect project's work_dir must be reconciled to the
 * team manifest's work_dir.
 *
 * Reconcile only when we have a concrete expected dir AND the project's current
 * work_dir differs. The placeholder is caught by the inequality check, so the
 * common broken case needs no special-casing. We never overwrite with an empty
 * expected value — that would clear a valid path instead of repairing a bad one.
 */
export function needsWorkDirReconcile(
  actualWorkDir: string | undefined | null,
  expectedWorkDir: string | undefined | null
): boolean {
  const expected = expectedWorkDir?.trim();
  if (!expected) return false;
  return (actualWorkDir?.trim() ?? '') !== expected;
}

/** True when a work_dir is cc-connect's default template placeholder. */
export function isPlaceholderWorkDir(workDir: string | undefined | null): boolean {
  return workDir?.trim() === CC_CONNECT_PLACEHOLDER_WORK_DIR;
}
