/**
 * FolderBrowser — directory browser dialog for the console path input.
 * Extracted from ProjectPathSelector so the SystemManagerView can reuse it.
 */
import React, { useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Check, ChevronLeft, ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react';

interface FolderBrowserProps {
  value: string;
  onChange: (path: string) => void;
}

export const FolderBrowser = ({ value, onChange }: FolderBrowserProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(value || '');
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.config.browseFolders(dirPath || undefined);
      setCurrentPath(result.path);
      setDirs(result.dirs);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法访问目录');
      setDirs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    void browse(value || '');
  };

  const handleSelect = (dir: string) => {
    onChange(dir);
    setOpen(false);
  };

  const handleConfirm = () => {
    if (currentPath) {
      onChange(currentPath);
    }
    setOpen(false);
  };

  const handleNavigateUp = () => {
    if (currentPath) {
      const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
      void browse(parent);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0 border-[var(--color-border)]"
        onClick={handleOpen}
        title="浏览目录"
      >
        <FolderOpen size={13} />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>选择工作目录</DialogTitle>
          </DialogHeader>

          {/* Path breadcrumb + manual input */}
          <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <button
              type="button"
              className="shrink-0 hover:text-[var(--color-text)]"
              onClick={handleNavigateUp}
              disabled={!currentPath || currentPath === '/'}
            >
              <ChevronLeft size={14} />
            </button>
            <Input
              className="h-7 flex-1 font-mono text-xs"
              value={currentPath}
              onChange={(e) => setCurrentPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void browse(currentPath);
              }}
              placeholder="/path/to/directory"
            />
          </div>

          {/* Directory list */}
          <div className="max-h-64 overflow-auto rounded-md border border-[var(--color-border)]">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--color-text-muted)]">
                <Loader2 className="size-4 animate-spin" />
                加载中…
              </div>
            )}
            {error && <div className="px-3 py-4 text-xs text-red-400">{error}</div>}
            {!loading && !error && dirs.length === 0 && (
              <div className="px-3 py-4 text-xs text-[var(--color-text-muted)]">
                此目录下没有子目录。可手动输入路径后按 Enter。
              </div>
            )}
            {!loading && !error && dirs.length > 0 && (
              <ul className="divide-y divide-[var(--color-border)]">
                {dirs.map((dir) => (
                  <li key={dir}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-raised)]"
                      onClick={() => void browse(dir)}
                      onDoubleClick={() => handleSelect(dir)}
                    >
                      <Folder size={14} className="shrink-0 text-[var(--color-text-muted)]" />
                      <span className="truncate">{dir}</span>
                      <ChevronRight
                        size={14}
                        className="ml-auto shrink-0 text-[var(--color-text-muted)]"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleConfirm} disabled={!currentPath}>
              选择此目录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
