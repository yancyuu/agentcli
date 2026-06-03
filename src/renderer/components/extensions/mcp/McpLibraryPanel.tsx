/**
 * McpLibraryPanel — global reusable MCP server definition library.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { getMcpProjectStateKey } from '@shared/utils/extensionNormalizers';
import { Plus, RefreshCw, Search, Server, Trash2, Upload } from 'lucide-react';

import { SearchInput } from '../common/SearchInput';

import { McpLibraryEnableDialog } from './McpLibraryEnableDialog';
import { McpLibraryEntryDialog } from './McpLibraryEntryDialog';

import type { InstalledMcpEntry, McpInstallSpec, McpLibraryEntry } from '@shared/types/extensions';

interface McpLibraryPanelProps {
  projectPath: string | null;
}

function summarizeTransport(spec: McpInstallSpec): string {
  if (spec.type === 'stdio') {
    return `stdio · ${spec.npmPackage}${spec.npmVersion ? `@${spec.npmVersion}` : ''}`;
  }
  return `${spec.transportType} · ${spec.url}`;
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function countBestEffortProjectInstances(
  entry: McpLibraryEntry,
  installedServers: InstalledMcpEntry[]
): number {
  return installedServers.filter(
    (server) => server.scope === 'project' && server.name === entry.name
  ).length;
}

export const McpLibraryPanel = ({ projectPath }: McpLibraryPanelProps): React.JSX.Element => {
  const mcpInstalledServersByProjectPath = useStore((s) => s.mcpInstalledServersByProjectPath);
  const mcpFetchInstalled = useStore((s) => s.mcpFetchInstalled);
  const runMcpDiagnostics = useStore((s) => s.runMcpDiagnostics);

  const [entries, setEntries] = useState<McpLibraryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<McpLibraryEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [enablingEntry, setEnablingEntry] = useState<McpLibraryEntry | null>(null);

  const projectStateKey = getMcpProjectStateKey(projectPath);
  const projectInstalledServers = projectPath
    ? (mcpInstalledServersByProjectPath[projectStateKey] ?? [])
    : [];

  const refresh = useCallback(async (): Promise<void> => {
    if (!api.mcpRegistry?.libraryList) {
      setEntries([]);
      setError('MCP 能力库 API 不可用');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const libraryEntries = await api.mcpRegistry.libraryList();
      setEntries(libraryEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 MCP 能力库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectPath) return;
    void mcpFetchInstalled(projectPath);
  }, [mcpFetchInstalled, projectPath]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query) return sorted;
    return sorted.filter((entry) => {
      const transportSummary = summarizeTransport(entry.installSpec).toLowerCase();
      return (
        entry.name.toLowerCase().includes(query) ||
        (entry.description ?? '').toLowerCase().includes(query) ||
        transportSummary.includes(query)
      );
    });
  }, [entries, search]);

  const openCreateDialog = (): void => {
    setEditingEntry(null);
    setDialogOpen(true);
  };

  const openEditDialog = (entry: McpLibraryEntry): void => {
    setEditingEntry(entry);
    setDialogOpen(true);
  };

  const handleSaved = (entry: McpLibraryEntry): void => {
    setEntries((prev) => {
      const exists = prev.some((item) => item.id === entry.id);
      return exists ? prev.map((item) => (item.id === entry.id ? entry : item)) : [entry, ...prev];
    });
    setDialogOpen(false);
    setEditingEntry(null);
  };

  const handleDelete = (entry: McpLibraryEntry): void => {
    void (async () => {
      if (!api.mcpRegistry?.libraryDelete) {
        setError('MCP 能力库 API 不可用');
        return;
      }

      const confirmed = await confirm({
        title: '删除 MCP 定义',
        message: `确认从全局能力库删除「${entry.name}」？已安装到项目中的服务器不会被自动移除。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        variant: 'danger',
      });
      if (!confirmed) return;

      setDeletingId(entry.id);
      setError(null);
      try {
        await api.mcpRegistry.libraryDelete(entry.id);
        setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除 MCP 定义失败');
      } finally {
        setDeletingId(null);
      }
    })();
  };

  const handleInstanceInstalled = (): void => {
    setEnablingEntry(null);
    if (projectPath) {
      void mcpFetchInstalled(projectPath);
      void runMcpDiagnostics(projectPath);
    }
  };

  const handleImport = (): void => {
    void (async () => {
      if (!api.mcpRegistry?.libraryImport) {
        setError('MCP 能力库 API 不可用');
        return;
      }

      setImporting(true);
      setImportMessage(null);
      setError(null);
      try {
        const result = await api.mcpRegistry.libraryImport({
          projectPath: projectPath ?? undefined,
        });
        await refresh();
        const imported = result.imported.length;
        const skipped = result.skipped.length;
        setImportMessage(`导入完成：新增 ${imported} 个，跳过 ${skipped} 个。`);
      } catch (err) {
        setError(err instanceof Error ? err.message : '导入现有 MCP 定义失败');
      } finally {
        setImporting(false);
      }
    })();
  };

  const hasActiveSearch = search.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">MCP 全局能力库</h2>
          <p className="mt-1 text-xs text-text-muted">
            保存可复用的 MCP 服务器定义，再按需安装到团队项目。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
            <Upload className="mr-1.5 size-3.5" />
            {importing ? '导入中...' : '导入现有定义'}
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="mr-1.5 size-3.5" />
            添加定义
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="搜索 MCP 定义..." />
        </div>
        <Badge variant="secondary" className="w-fit font-normal">
          {filteredEntries.length} / {entries.length} 个定义
        </Badge>
      </div>

      {importMessage && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          {importMessage}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="skeleton-card flex flex-col gap-3 rounded-lg border border-border p-4"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className="h-4 w-32 rounded bg-surface-raised" />
              <div className="h-3 w-full rounded bg-surface-raised" />
              <div className="h-3 w-3/4 rounded bg-surface-raised" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-surface-raised" />
                <div className="h-5 w-20 rounded-full bg-surface-raised" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && filteredEntries.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-border px-8 py-16">
          <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-raised">
            {hasActiveSearch ? (
              <Search className="size-5 text-text-muted" />
            ) : (
              <Server className="size-5 text-text-muted" />
            )}
          </div>
          <p className="text-sm text-text-secondary">
            {hasActiveSearch ? '没有匹配搜索条件的 MCP 定义' : '暂无 MCP 定义'}
          </p>
          <p className="text-xs text-text-muted">
            {hasActiveSearch ? '试着调整搜索关键词' : '添加新定义或从现有 MCP 配置导入'}
          </p>
          {!hasActiveSearch && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
                导入现有定义
              </Button>
              <Button size="sm" onClick={openCreateDialog}>
                添加定义
              </Button>
            </div>
          )}
        </div>
      )}

      {!loading && filteredEntries.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredEntries.map((entry) => {
            const envCount = Object.keys(entry.envValues ?? {}).length;
            const headerCount = entry.headers?.length ?? 0;
            const isDeleting = deletingId === entry.id;
            const isEnabling = enablingEntry?.id === entry.id;
            const projectInstanceCount = countBestEffortProjectInstances(
              entry,
              projectInstalledServers
            );

            return (
              <div
                key={entry.id}
                className="hover:bg-surface-raised/40 group flex min-h-44 flex-col rounded-lg border border-border bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-border-emphasis hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-text">{entry.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                      {entry.description || '无描述'}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">
                    {entry.installSpec.type === 'stdio' ? 'stdio' : entry.installSpec.transportType}
                  </Badge>
                </div>

                <div className="bg-surface-raised/40 mt-3 rounded-md border border-border px-2 py-1.5">
                  <p className="truncate font-mono text-[11px] text-text-secondary">
                    {summarizeTransport(entry.installSpec)}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="font-normal">
                    模板 · {entry.installSpec.type === 'stdio' ? 'Node / npm' : 'HTTP'}
                  </Badge>
                  {projectPath && (
                    <Badge variant="secondary" className="font-normal">
                      当前项目同名实例 {projectInstanceCount}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="font-normal">
                    Env {envCount}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    Headers {headerCount}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    更新 {formatUpdatedAt(entry.updatedAt)}
                  </Badge>
                </div>

                <div className="mt-auto flex items-center justify-end gap-2 pt-4">
                  {projectPath && (
                    <Button
                      variant={isEnabling ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEnablingEntry(isEnabling ? null : entry)}
                    >
                      添加实例到当前项目
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => openEditDialog(entry)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    disabled={isDeleting}
                    onClick={() => handleDelete(entry)}
                  >
                    <Trash2 className="mr-1 size-3" />
                    {isDeleting ? '删除中...' : '删除'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <McpLibraryEnableDialog
        open={Boolean(enablingEntry)}
        entry={enablingEntry}
        projectPath={projectPath}
        installedServers={projectInstalledServers}
        onClose={() => setEnablingEntry(null)}
        onEnabled={handleInstanceInstalled}
      />

      <McpLibraryEntryDialog
        open={dialogOpen}
        entry={editingEntry}
        onClose={() => {
          setDialogOpen(false);
          setEditingEntry(null);
        }}
        onSaved={handleSaved}
      />
    </div>
  );
};
