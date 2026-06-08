/**
 * BuiltinWorkflowSeeder — 将内置 workflow 作为 Claude Code 自定义命令
 * 复制到控制台工作空间的 `.claude/commands/` 目录。
 *
 * 内置 workflow 以代码常量形式内嵌，在控制台打开工作空间时自动复制到
 * <workspace>/.claude/commands/ 目录，成为原生 `/doctor` 等斜杠命令。
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from '@shared/utils/logger';

const logger = createLogger('BuiltinWorkflowSeeder');

// ---------------------------------------------------------------------------
// Builtin workflow definitions
// ---------------------------------------------------------------------------

const BUILTIN_WORKFLOWS: Record<string, string> = {
  'doctor.md': `# Hermit Doctor — 环境诊断

你是一个 Hermit 运维诊断助手。请按以下步骤逐一检查当前环境，报告每项状态（✅ 正常 / ⚠️ 警告 / ❌ 异常），并在最后给出总结和建议。

## 1. 基础环境

- 检查操作系统和版本
- 检查可用内存（\`free -h\` 或 \`vm_stat\`）
- 检查磁盘空间（\`df -h .\`）
- 检查文件描述符限制（\`ulimit -n\`）

## 2. Claude Code CLI

- 检查 \`claude\` 是否在 PATH 中（\`which claude\`）
- 检查 Claude Code 版本（\`claude --version\`）
- 检查登录状态（\`claude auth status\` 或检查 \`~/.claude\` 目录）

## 3. cc-connect 连通性

- 检查 cc-connect 进程是否运行（\`ps aux | grep cc-connect\`）
- 检查 cc-connect API 是否可达（\`curl -s http://127.0.0.1:6300/api/v1/status\`）
- 检查 cc-connect 配置文件是否存在（\`~/.cc-connect/config.toml\`）
- 列出已配置的项目数量

## 4. Hermit 数据目录

- 检查 \`~/.hermit/\` 目录结构是否完整
- 检查 \`~/.hermit/teams/\` 下的团队数量和状态
- 检查是否有 pendingDelete 或 restartRequired 标记的团队
- 检查团队 team.json 是否有效（schemaVersion 字段）

## 5. 会话健康

- 统计当前运行的 Claude 会话数量（\`ps aux | grep claude | grep -v grep\`）
- 检查是否有僵尸进程
- 检查内存占用是否异常（单个会话 > 200MB 为警告）

## 6. 网络和端口

- 检查 Hermit 服务端口是否正常监听
- 检查 cc-connect 端口是否正常监听
- 检查 DNS 解析是否正常（\`nslookup api.anthropic.com\`）

## 输出格式

完成后请输出：

\`\`\`
🔍 Hermit Doctor 诊断报告
=========================
操作系统: ...
内存: ... (可用 / 总计)
磁盘: ... (可用 / 总计)

✅/⚠️/❌ Claude Code CLI: ...
✅/⚠️/❌ cc-connect: ...
✅/⚠️/❌ Hermit 数据: ...
✅/⚠️/❌ 会话健康: ...
✅/⚠️/❌ 网络: ...

📊 总结:
- 正常项: N
- 警告项: N
- 异常项: N

💡 建议:
1. ...
2. ...
\`\`\`
`,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function hermitHome(): string {
  return process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
}

/**
 * 将内置命令文件复制到工作空间的 .claude/commands/ 目录。
 * 如果已存在同名文件则跳过（尊重用户自定义）。
 *
 * @param workspaceDir 工作空间根目录
 * @returns 实际复制的文件数量
 */
export async function seedBuiltinWorkflows(workspaceDir: string): Promise<number> {
  let copied = 0;
  try {
    const targetDir = path.join(workspaceDir, '.claude', 'commands');
    await mkdir(targetDir, { recursive: true });

    for (const [filename, content] of Object.entries(BUILTIN_WORKFLOWS)) {
      const targetPath = path.join(targetDir, filename);
      const exists = await stat(targetPath).then(() => true).catch(() => false);
      if (exists) continue;

      await writeFile(targetPath, content, 'utf-8');
      copied++;
      logger.info(`seeded builtin workflow: ${filename} → ${targetPath}`);
    }
  } catch (err) {
    logger.warn('failed to seed builtin workflows:', err instanceof Error ? err.message : err);
  }
  return copied;
}

/**
 * Ensure ~/.hermit/.claude/commands/ has the builtin commands.
 * Called once at app startup as fallback.
 */
export async function ensureGlobalWorkflows(): Promise<void> {
  const globalWorkspace = hermitHome();
  const copied = await seedBuiltinWorkflows(globalWorkspace);
  if (copied > 0) {
    logger.info(`seeded ${copied} builtin command(s) to ${path.join(globalWorkspace, '.claude', 'commands')}`);
  }
}
