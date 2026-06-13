import { Button } from '@renderer/components/ui/button';

import { AGENT_TYPE_LABELS, ALL_AGENT_TYPES } from './HarnessCards';
import { HarnessIcon } from './HarnessSelect';

import type { CcAgentType } from '@shared/types/ccConnect';

interface TeamEmptyStateProps {
  canCreate: boolean;
  onCreateTeam: () => void;
  onSelectHarness?: (harness: CcAgentType) => void;
}

const HARNESS_DESCRIPTIONS: Record<CcAgentType, string> = {
  claudecode: 'Anthropic 官方 CLI',
  codex: 'OpenAI Codex CLI',
  cursor: 'Cursor IDE Agent',
  gemini: 'Google Gemini CLI',
  iflow: 'iFlow CLI',
  kimi: 'Moonshot Kimi',
  devin: 'Cognition Devin',
  opencode: 'OpenCode CLI',
  qoder: 'Qoder CLI',
  pi: 'Inflection Pi',
  acp: 'Agent Communication Protocol',
  tmux: 'Tmux Session',
};

export const TeamEmptyState = ({
  canCreate,
  onCreateTeam,
  onSelectHarness,
}: TeamEmptyStateProps): React.JSX.Element => {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <p className="text-lg font-medium text-[var(--color-text)]">还没有 Agent runtime</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          选择一种 Agent 类型启动循环，或创建自定义 runtime。
        </p>
      </div>

      {/* Harness 卡片网格 */}
      {onSelectHarness && (
        <div className="w-full max-w-2xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            选择 Agent 类型
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {ALL_AGENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="flex flex-col items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center transition-colors hover:border-[var(--color-border-emphasis)] hover:bg-[var(--color-surface-raised)]"
                onClick={() => onSelectHarness(type)}
              >
                <HarnessIcon type={type} className="size-6" />
                <span className="text-xs font-medium text-[var(--color-text)]">
                  {AGENT_TYPE_LABELS[type]}
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {HARNESS_DESCRIPTIONS[type]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px w-12 bg-[var(--color-border)]" />
        <span className="text-xs text-[var(--color-text-muted)]">或</span>
        <div className="h-px w-12 bg-[var(--color-border)]" />
      </div>

      <Button size="sm" disabled={!canCreate} onClick={onCreateTeam}>
        创建自定义 runtime
      </Button>

      {!canCreate && (
        <p className="text-xs text-[var(--color-text-muted)]">只有本地桌面模式支持创建 runtime。</p>
      )}
    </div>
  );
};
