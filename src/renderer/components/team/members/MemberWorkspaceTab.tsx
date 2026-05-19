import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { getBasename } from '@shared/utils/platformPath';
import { AlertCircle, FileCode, FileDiff, FolderOpen, Loader2 } from 'lucide-react';

import type { AgentChangeSet } from '@shared/types/review';

interface MemberWorkspaceTabProps {
  teamName: string;
  memberName: string;
  onFileClick?: (filePath: string) => void;
  onViewAllChanges?: () => void;
}

export const MemberWorkspaceTab = ({
  teamName,
  memberName,
  onFileClick,
  onViewAllChanges,
}: MemberWorkspaceTabProps): React.JSX.Element => {
  const [changes, setChanges] = useState<AgentChangeSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await api.review.getAgentChanges(teamName, memberName);
        if (!cancelled) setChanges(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load changes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teamName, memberName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={14} className="animate-spin" />
        Loading workspace changes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-red-400">
        <AlertCircle size={14} />
        {error}
      </div>
    );
  }

  if (!changes || changes.files.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
        <FolderOpen size={20} className="mx-auto mb-2 opacity-40" />
        No workspace changes
      </div>
    );
  }

  const totalAdded = changes.files.reduce((sum, f) => sum + f.linesAdded, 0);
  const totalRemoved = changes.files.reduce((sum, f) => sum + f.linesRemoved, 0);

  return (
    <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
      {/* Summary */}
      <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {changes.files.length} file{changes.files.length !== 1 ? 's' : ''} changed
          </span>
          <span className="flex items-center gap-1 font-mono text-xs">
            {totalAdded > 0 && <span className="text-emerald-400">+{totalAdded}</span>}
            {totalRemoved > 0 && <span className="text-red-400">-{totalRemoved}</span>}
          </span>
        </div>
        {onViewAllChanges && (
          <button
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
            onClick={onViewAllChanges}
          >
            <FileDiff size={10} />
            View Diff
          </button>
        )}
      </div>

      {/* File list */}
      <div className="space-y-0.5">
        {changes.files.map((file) => {
          const basename = getBasename(file.filePath) || file.filePath;
          const isClickable = !!onFileClick;
          return (
            <button
              key={file.filePath}
              type="button"
              className={cn(
                'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-[var(--color-text-muted)]',
                isClickable &&
                  'cursor-pointer hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-secondary)]'
              )}
              title={file.filePath}
              onClick={() => onFileClick?.(file.filePath)}
              disabled={!isClickable}
            >
              <FileCode size={12} className="shrink-0 opacity-50" />
              <span className="min-w-0 flex-1 truncate">{basename}</span>
              {file.isNewFile && (
                <span className="shrink-0 text-[10px] text-emerald-400 opacity-60">new</span>
              )}
              {(file.linesAdded > 0 || file.linesRemoved > 0) && (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                  {file.linesAdded > 0 && (
                    <span className="text-emerald-400">+{file.linesAdded}</span>
                  )}
                  {file.linesRemoved > 0 && (
                    <span className="text-red-400">-{file.linesRemoved}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
