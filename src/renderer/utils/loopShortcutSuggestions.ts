import type { MentionSuggestion } from '@renderer/types/mention';

const LOOP_SHORTCUT_SUGGESTIONS: MentionSuggestion[] = [
  {
    id: 'loop-shortcut:team-status',
    name: 'loop team status',
    type: 'command',
    command: '/loop',
    insertText: 'loop 1d 检查当前团队状态、阻塞任务和需要我关注的问题，写回消息看板',
    description: '每天检查团队状态、阻塞和需要用户关注的事项',
    searchText: 'loop team status daily 每天 团队 状态 阻塞 关注',
  },
  {
    id: 'loop-shortcut:blockers',
    name: 'loop blockers watch',
    type: 'command',
    command: '/loop',
    insertText: 'loop 30m 检查当前任务是否有阻塞、失败或需要用户确认的事项，发现后提醒我',
    description: '每 30 分钟巡检阻塞、失败和待确认事项',
    searchText: 'loop blockers watch 30m 阻塞 失败 确认 提醒',
  },
  {
    id: 'loop-shortcut:daily-summary',
    name: 'loop daily summary',
    type: 'command',
    command: '/loop',
    insertText: 'loop 1d 总结今天团队完成了什么、还剩什么、明天建议做什么，写回消息看板',
    description: '每天生成团队进展总结和次日建议',
    searchText: 'loop daily summary 每天 总结 进展 明天 建议',
  },
  {
    id: 'loop-shortcut:memory-config-health',
    name: 'loop memory health',
    type: 'command',
    command: '/loop',
    insertText: 'loop 1d 检查 CLAUDE、AGENTS、memory 和 settings 是否有重复、过期或冲突指令',
    description: '每天检查记忆、配置和指令冲突',
    searchText: 'loop memory config health CLAUDE AGENTS settings 记忆 配置 冲突',
  },
  {
    id: 'loop-shortcut:workspace-hygiene',
    name: 'loop workspace hygiene',
    type: 'command',
    command: '/loop',
    insertText: 'loop 1d 扫描工作区临时文件、脏 worktree、陈旧报告和需要清理的产物',
    description: '每天检查工作区清理和脏 worktree 状态',
    searchText: 'loop workspace hygiene worktree 临时文件 清理 报告',
  },
];

export function getLoopShortcutSuggestions(): MentionSuggestion[] {
  return LOOP_SHORTCUT_SUGGESTIONS;
}
