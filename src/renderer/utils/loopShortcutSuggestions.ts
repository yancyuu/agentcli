import type { MentionSuggestion } from '@renderer/types/mention';

export interface LoopCommandShortcut {
  id: string;
  name: string;
  command: `/${string}`;
  insertText: string;
  description: string;
  searchText: string;
  category: 'monitoring' | 'summary' | 'hygiene' | 'diagnostic' | 'workflow';
}

const LOOP_COMMAND_SHORTCUTS: LoopCommandShortcut[] = [
  {
    id: 'loop-shortcut:team-status',
    name: 'loop team status',
    command: '/loop',
    insertText: 'loop 1d 检查当前团队状态、阻塞任务和需要我关注的问题，写回消息看板',
    description: '每天检查团队状态、阻塞和需要用户关注的事项',
    searchText: 'loop team status daily 每天 团队 状态 阻塞 关注',
    category: 'monitoring',
  },
  {
    id: 'loop-shortcut:blockers',
    name: 'loop blockers watch',
    command: '/loop',
    insertText: 'loop 30m 检查当前任务是否有阻塞、失败或需要用户确认的事项，发现后提醒我',
    description: '每 30 分钟巡检阻塞、失败和待确认事项',
    searchText: 'loop blockers watch 30m 阻塞 失败 确认 提醒',
    category: 'monitoring',
  },
  {
    id: 'loop-shortcut:daily-summary',
    name: 'loop daily summary',
    command: '/loop',
    insertText: 'loop 1d 总结今天团队完成了什么、还剩什么、明天建议做什么，写回消息看板',
    description: '每天生成团队进展总结和次日建议',
    searchText: 'loop daily summary 每天 总结 进展 明天 建议',
    category: 'summary',
  },
  {
    id: 'loop-shortcut:memory-config-health',
    name: 'loop memory health',
    command: '/loop',
    insertText: 'loop 1d 检查 CLAUDE、AGENTS、memory 和 settings 是否有重复、过期或冲突指令',
    description: '每天检查记忆、配置和指令冲突',
    searchText: 'loop memory config health CLAUDE AGENTS settings 记忆 配置 冲突',
    category: 'hygiene',
  },
  {
    id: 'loop-shortcut:workspace-hygiene',
    name: 'loop workspace hygiene',
    command: '/loop',
    insertText: 'loop 1d 扫描工作区临时文件、脏 worktree、陈旧报告和需要清理的产物',
    description: '每天检查工作区清理和脏 worktree 状态',
    searchText: 'loop workspace hygiene worktree 临时文件 清理 报告',
    category: 'hygiene',
  },
  {
    id: 'ops-workflow:doctor',
    name: 'hermit:doctor',
    command: '/hermit:doctor',
    insertText: 'hermit:doctor 检查 Hermit 安装、运行时、cc-connect、MCP 和常见配置问题',
    description: '诊断 Hermit / runtime / cc-connect 健康状态',
    searchText: 'doctor hermit diagnose health runtime cc-connect mcp 诊断 健康 配置',
    category: 'diagnostic',
  },
  {
    id: 'ops-workflow:loop-scan',
    name: 'hermit:loop-scan',
    command: '/hermit:loop-scan',
    insertText: 'hermit:loop-scan 扫描 Loop 资产、推荐循环和可自动化的团队运维动作',
    description: '扫描 Loop assets 和推荐运维循环',
    searchText: 'loop scan hermit assets workflows recommended loops 扫描 推荐 循环',
    category: 'workflow',
  },
  {
    id: 'ops-workflow:summary',
    name: 'hermit:summary',
    command: '/hermit:summary',
    insertText: 'hermit:summary 总结当前团队进展、阻塞、风险和下一步建议',
    description: '生成团队/会话摘要和下一步建议',
    searchText: 'summary hermit status progress blockers risks next steps 摘要 进展 阻塞 风险',
    category: 'summary',
  },
  {
    id: 'ops-workflow:daily-folder-hygiene',
    name: 'hermit:daily-folder-hygiene',
    command: '/hermit:daily-folder-hygiene',
    insertText: 'hermit:daily-folder-hygiene 只读检查临时文件、陈旧报告、脏 worktree 和可清理产物',
    description: '只读检查工作区卫生和可清理项',
    searchText: 'daily folder hygiene hermit temp stale reports dirty worktree cleanup 工作区 清理',
    category: 'hygiene',
  },
  {
    id: 'ops-workflow:daily-memory-conflict-check',
    name: 'hermit:daily-memory-conflict-check',
    command: '/hermit:daily-memory-conflict-check',
    insertText:
      'hermit:daily-memory-conflict-check 检查 CLAUDE、AGENTS、memory、settings 的重复或冲突指令',
    description: '检查记忆/配置/指令冲突',
    searchText:
      'daily memory conflict hermit claude agents settings duplicate instructions 记忆 冲突',
    category: 'hygiene',
  },
  {
    id: 'ops-workflow:daily-workflow-extraction',
    name: 'hermit:daily-workflow-extraction',
    command: '/hermit:daily-workflow-extraction',
    insertText:
      'hermit:daily-workflow-extraction 从近期工作中提炼可复用 workflow、prompt 和自动化建议',
    description: '提炼可复用 workflow/prompt',
    searchText: 'daily workflow extraction hermit reusable prompt automation 提炼 复用 自动化',
    category: 'workflow',
  },
  {
    id: 'ops-workflow:worktree-scan',
    name: 'hermit:worktree-scan',
    command: '/hermit:worktree-scan',
    insertText: 'hermit:worktree-scan 只读检查脏 worktree、陈旧分支和需要用户确认的清理项',
    description: '只读检查 worktree/分支清理风险',
    searchText: 'worktree scan hermit dirty stale branch cleanup readonly worktree 分支 清理',
    category: 'diagnostic',
  },
];

export function getLoopCommandShortcuts(): LoopCommandShortcut[] {
  return LOOP_COMMAND_SHORTCUTS;
}

export function getLoopShortcutMentionSuggestions(): MentionSuggestion[] {
  return LOOP_COMMAND_SHORTCUTS.map((shortcut) => ({
    id: shortcut.id,
    name: shortcut.name,
    type: 'command',
    command: shortcut.command,
    insertText: shortcut.insertText,
    description: shortcut.description,
    subtitle: shortcut.description,
    searchText: `${shortcut.searchText} ${shortcut.category}`,
  }));
}

export function getLoopShortcutSuggestions(): MentionSuggestion[] {
  return getLoopShortcutMentionSuggestions();
}
