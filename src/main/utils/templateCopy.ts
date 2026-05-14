import { createLogger } from '@shared/utils/logger';
import { getAppDataPath } from '@main/utils/pathDecoder';
import { isPathWithinRoot } from '@main/utils/pathValidation';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('templateCopy');

/**
 * Validates a template source/directory ID pair against path traversal.
 * Rejects values containing `..`, path separators, NUL, or leading dots,
 * and asserts the resolved path stays under the template repos root.
 */
export function validateTemplatePathIds(
  templateSourceId: string,
  templateDirectoryId: string
): { valid: true; resolvedBase: string } | { valid: false; error: string } {
  const validateSegment = (value: string, label: string): string | null => {
    if (!value || !value.trim()) return `${label} must be a non-empty string`;
    const trimmed = value.trim();
    if (trimmed.includes('..')) return `${label} must not contain ".."`;
    if (trimmed.includes('/') || trimmed.includes('\\'))
      return `${label} must not contain path separators`;
    if (trimmed.includes('\0')) return `${label} must not contain NUL bytes`;
    if (trimmed.startsWith('.')) return `${label} must not start with a dot`;
    return null;
  };

  const sourceError = validateSegment(templateSourceId, 'templateSourceId');
  if (sourceError) return { valid: false, error: sourceError };

  const dirError = validateSegment(templateDirectoryId, 'templateDirectoryId');
  if (dirError) return { valid: false, error: dirError };

  const reposRoot = path.join(getAppDataPath(), 'team-template-sources', 'repos');
  const resolvedBase = path.resolve(reposRoot, templateSourceId, templateDirectoryId);
  if (!isPathWithinRoot(resolvedBase, reposRoot)) {
    return { valid: false, error: 'Template path escapes the repos directory' };
  }

  return { valid: true, resolvedBase };
}

/**
 * Copies the `.claude/` directory from a template into a new team directory.
 * Only catches ENOENT on the source stat — other errors propagate.
 */
export async function copyTemplateClaudeDir(
  teamDir: string,
  templateBaseDir: string
): Promise<void> {
  const claudeDir = path.join(templateBaseDir, '.claude');
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(claudeDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (!stat.isDirectory()) return;

  const destDir = path.join(teamDir, '.claude');
  await fs.promises.mkdir(destDir, { recursive: true });
  await copyDirRecursive(claudeDir, destDir);
}

/**
 * Recursively copies a directory. Symlinks are intentionally skipped
 * (template repos are user-pulled git repos; symlink following is unnecessary).
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fs.promises.mkdir(destPath, { recursive: true });
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
    // Symlinks are intentionally skipped.
  }
}
