/**
 * ExtensionStoreView — top-level component for the Extensions tab.
 * Uses per-tab UI state via useExtensionsTabState() hook.
 * Global catalog data comes from Zustand store.
 */

import { useCallback, useEffect, useMemo } from 'react';

// Stubs for removed codex-account feature
function useCodexAccountSnapshot(_opts: { enabled: boolean; includeRateLimits?: boolean }) {
  return { snapshot: null, loading: false };
}
function mergeCodexProviderStatusWithSnapshot<T>(provider: T, _snapshot: unknown): T {
  return provider;
}

import { api } from '@renderer/api';
import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Tabs, TabsContent, TabsList } from '@renderer/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { useTabIdOptional } from '@renderer/contexts/useTabUIContext';
import { useExtensionsTabState } from '@renderer/hooks/useExtensionsTabState';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import {
  filterExtensionStoreProviders,
  formatCliExtensionCapabilityStatus,
  getVisibleMultimodelProviders,
  isMultimodelRuntimeStatus,
} from '@renderer/utils/multimodelProviderVisibility';
import { resolveProjectPathById } from '@renderer/utils/projectLookup';
import { refreshCliStatusForCurrentMode } from '@renderer/utils/refreshCliStatus';
import { getRuntimeDisplayName } from '@renderer/utils/runtimeDisplayName';
import { getCliProviderExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';
import {
  AlertTriangle,
  FileText,
  Info,
  Loader2,
  Puzzle,
  RefreshCw,
  Server,
  Sliders,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { EnvVarPanel } from './env/EnvVarPanel';
import { McpLibraryPanel } from './mcp/McpLibraryPanel';
import { PluginsPanel } from './plugins/PluginsPanel';
import { SkillsLibraryPanel } from './skills/SkillsLibraryPanel';
import { StoreExtensionToast } from './common/ExtensionToast';
import { ExtensionsSubTabTrigger } from './ExtensionsSubTabTrigger';

import type { CliProviderId, CliProviderStatus } from '@shared/types';
import type { ExtensionsSubTab } from '@renderer/hooks/useExtensionsTabState';

const ProviderCapabilityCardSkeleton = ({
  providerId,
  displayName,
}: {
  providerId: CliProviderId;
  displayName: string;
}): React.JSX.Element => (
  <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-text">
          <ProviderBrandLogo providerId={providerId} className="size-4 shrink-0" />
          <span>{displayName}</span>
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
          <Loader2 className="size-3 animate-spin" />
          <span>正在检查提供商状态...</span>
        </div>
      </div>
      <Badge variant="outline" className="shrink-0 text-text-muted">
        加载中...
      </Badge>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {Array.from({ length: 4 }, (_, index) => (
        <span
          key={index}
          className="h-7 w-28 animate-pulse rounded-md border border-border bg-surface"
        />
      ))}
    </div>
  </div>
);

function isProviderCapabilityCardLoading(
  provider: CliProviderStatus,
  providerLoading: boolean
): boolean {
  return (
    providerLoading ||
    (!provider.authenticated &&
      provider.statusMessage === 'Checking...' &&
      provider.models.length === 0 &&
      provider.backend == null)
  );
}

function isCodexSnapshotPending(
  provider: CliProviderStatus,
  codexSnapshotPending: boolean
): boolean {
  return provider.providerId === 'codex' && codexSnapshotPending;
}

const EXTENSION_SUB_TABS = [
  {
    value: 'plugins' as const,
    label: '插件',
    icon: Puzzle,
    description: 'Claude Code 私有扩展，增强运行时的能力与集成。',
  },
  {
    value: 'mcp-servers' as const,
    label: 'MCP',
    icon: Server,
    description: '管理可复用的全局 MCP 服务器定义，再按需启用到团队项目。',
  },
  {
    value: 'skills' as const,
    label: 'Skills',
    icon: FileText,
    description: '管理全局用户 Skill，供不同团队和项目复用。',
  },
  {
    value: 'env-vars' as const,
    label: '环境变量',
    icon: Sliders,
    description: '管理运行时环境变量，启动 agent 时自动注入。',
  },
] as const;

export const ExtensionStoreView = (): React.JSX.Element => {
  const {
    bootstrapCliStatus,
    fetchCliStatus,
    fetchPluginCatalog,
    cliStatus,
    cliStatusLoading,
    cliProviderStatusLoading,
    appConfig,
    openDashboard,
    sessions,
    projects,
    repositoryGroups,
  } = useStore(
    useShallow((s) => ({
      bootstrapCliStatus: s.bootstrapCliStatus,
      fetchCliStatus: s.fetchCliStatus,
      fetchPluginCatalog: s.fetchPluginCatalog,
      pluginCatalog: s.pluginCatalog,
      cliStatus: s.cliStatus,
      cliStatusLoading: s.cliStatusLoading,
      cliProviderStatusLoading: s.cliProviderStatusLoading,
      appConfig: s.appConfig,
      openDashboard: s.openDashboard,
      sessions: s.sessions,
      projects: s.projects,
      repositoryGroups: s.repositoryGroups,
    }))
  );
  const multimodelEnabled = appConfig?.general?.multimodelEnabled ?? false;
  const loadingCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : cliStatus,
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  const codexAccount = useCodexAccountSnapshot({
    enabled:
      multimodelEnabled &&
      loadingCliStatus?.flavor === 'agent_teams_orchestrator' &&
      Boolean(
        loadingCliStatus?.providers.some(
          (provider: CliProviderStatus) => provider.providerId === 'codex'
        )
      ),
    includeRateLimits: true,
  });
  const codexSnapshotPending =
    codexAccount.loading &&
    Boolean(
      loadingCliStatus?.providers.some(
        (provider: CliProviderStatus) => provider.providerId === 'codex'
      )
    ) &&
    !codexAccount.snapshot;
  const effectiveCliStatus = useMemo(
    () =>
      loadingCliStatus
        ? {
            ...loadingCliStatus,
            providers: loadingCliStatus.providers.map((provider: CliProviderStatus) =>
              provider.providerId === 'codex'
                ? mergeCodexProviderStatusWithSnapshot(provider, codexAccount.snapshot)
                : provider
            ),
          }
        : loadingCliStatus,
    [loadingCliStatus, codexAccount.snapshot]
  );
  const effectiveCliStatusLoading = cliStatusLoading && effectiveCliStatus === null;
  const runtimeDisplayName = getRuntimeDisplayName(effectiveCliStatus, multimodelEnabled);
  const cliInstalled = effectiveCliStatus?.installed ?? true;
  const hasOngoingSessions = sessions.some((sess) => sess.isOngoing);

  const tabState = useExtensionsTabState();
  const tabId = useTabIdOptional();
  const extensionsTabProjectId = useStore((s) =>
    tabId
      ? (s.paneLayout.panes.flatMap((pane) => pane.tabs).find((tab) => tab.id === tabId)
          ?.projectId ?? null)
      : null
  );

  const resolvedProject = useMemo(
    () => resolveProjectPathById(extensionsTabProjectId, projects, repositoryGroups),
    [extensionsTabProjectId, projects, repositoryGroups]
  );
  const projectPath = resolvedProject?.path ?? null;
  const projectLabel = resolvedProject?.name ?? null;
  const subTabs = EXTENSION_SUB_TABS;

  useEffect(() => {
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, fetchCliStatus, multimodelEnabled]);

  // Fetch Plugin catalog on mount / project change
  useEffect(() => {
    void fetchPluginCatalog(projectPath ?? undefined);
  }, [fetchPluginCatalog, projectPath]);

  // Refresh all data
  const handleRefresh = useCallback(() => {
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, fetchCliStatus, multimodelEnabled]);

  const isRefreshing = effectiveCliStatusLoading;
  const cliStatusBanner = useMemo(() => {
    const providers = effectiveCliStatus?.providers ?? [];
    const visibleProviders = filterExtensionStoreProviders(
      getVisibleMultimodelProviders(providers)
    );
    const isMultimodel = isMultimodelRuntimeStatus(effectiveCliStatus);
    const shouldShowMultimodelProviderCards =
      isMultimodel && visibleProviders.length > 0 && effectiveCliStatus !== null;

    if (
      (effectiveCliStatusLoading || effectiveCliStatus === null) &&
      !shouldShowMultimodelProviderCards
    ) {
      return (
        <div className="bg-surface/70 mx-4 mt-3 flex items-start gap-3 rounded-md border border-border px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-text-secondary" />
          <div>
            <p className="text-sm font-medium text-text">正在检查扩展运行时可用性</p>
            <p className="mt-0.5 text-xs text-text-muted">
              扩展需要配置好的运行时来管理 MCP 服务器、技能和提供商连接。
            </p>
          </div>
        </div>
      );
    }

    if (!effectiveCliStatus.installed) {
      const cliLaunchIssue = Boolean(
        effectiveCliStatus.binaryPath && effectiveCliStatus.launchError
      );
      return (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-300">
              {cliLaunchIssue ? '已找到配置的运行时，但启动失败' : '配置的运行时不可用'}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {cliLaunchIssue
                ? '运行时通过启动健康检查之前，扩展功能会保持禁用。请前往首页修复或重新安装。'
                : '安装运行时之前，扩展功能会保持禁用。请前往首页安装后重试。'}
            </p>
            {cliLaunchIssue && effectiveCliStatus.launchError && (
              <p className="mt-2 break-all font-mono text-[11px] text-text-muted">
                {effectiveCliStatus.launchError}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={openDashboard}>
            打开首页
          </Button>
        </div>
      );
    }

    if (!isMultimodel && !effectiveCliStatus.authLoggedIn) {
      return (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-300">{runtimeDisplayName} 需要登录</p>
            <p className="mt-0.5 text-xs text-text-muted">
              已找到 {runtimeDisplayName}
              {effectiveCliStatus.installedVersion
                ? ` (${effectiveCliStatus.installedVersion})`
                : ''}
              ，但登录前无法管理扩展。请前往首页登录。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={openDashboard}>
            打开首页
          </Button>
        </div>
      );
    }

    if (isMultimodel) {
      return (
        <div className="bg-surface/70 mx-4 mt-3 rounded-md border border-border px-4 py-3">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 size-4 shrink-0 text-text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">多模型运行时能力</p>
              <p className="mt-0.5 text-xs text-text-muted">
                不同区域支持的提供商可能不同。插件、MCP、技能与 API keys 会按运行时声明的能力显示。
              </p>
            </div>
          </div>
          {visibleProviders.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {visibleProviders.map((provider) => {
                const providerLoading = cliProviderStatusLoading[provider.providerId] === true;
                if (
                  isProviderCapabilityCardLoading(provider, providerLoading) ||
                  isCodexSnapshotPending(provider, codexSnapshotPending)
                ) {
                  return (
                    <ProviderCapabilityCardSkeleton
                      key={provider.providerId}
                      providerId={provider.providerId}
                      displayName={provider.displayName}
                    />
                  );
                }

                const statusTone = provider.authenticated
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                  : provider.supported
                    ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
                    : 'border-border bg-surface-raised text-text-muted';
                const statusLabel = provider.authenticated
                  ? '已连接'
                  : provider.supported
                    ? '需要设置'
                    : '不支持';
                const extensionCapabilities = getCliProviderExtensionCapabilities(provider);

                return (
                  <div
                    key={provider.providerId}
                    className={`rounded-md border px-3 py-2 ${statusTone}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-2 text-sm font-medium">
                          <ProviderBrandLogo
                            providerId={provider.providerId}
                            className="size-4 shrink-0"
                          />
                          <span>{provider.displayName}</span>
                        </p>
                        <p className="truncate text-[11px] text-text-muted">
                          {provider.statusMessage ?? provider.backend?.label ?? '可配置'}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <Badge variant="secondary">
                        插件：
                        {formatCliExtensionCapabilityStatus(extensionCapabilities.plugins.status)}
                      </Badge>
                      <Badge variant="secondary">
                        MCP: {formatCliExtensionCapabilityStatus(extensionCapabilities.mcp.status)}
                      </Badge>
                      <Badge variant="secondary">
                        技能：
                        {formatCliExtensionCapabilityStatus(extensionCapabilities.skills.status)}
                      </Badge>
                      <Badge variant="secondary">
                        API keys:{' '}
                        {formatCliExtensionCapabilityStatus(extensionCapabilities.apiKeys.status)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-emerald-300" />
        <div>
          <p className="text-sm font-medium text-emerald-300">{runtimeDisplayName} 已就绪</p>
          <p className="mt-0.5 text-xs text-text-muted">
            可以从此页面管理 MCP 服务器与技能
            {effectiveCliStatus.installedVersion
              ? `，使用 ${runtimeDisplayName} ${effectiveCliStatus.installedVersion}`
              : ''}
            .
          </p>
        </div>
      </div>
    );
  }, [
    cliProviderStatusLoading,
    codexSnapshotPending,
    effectiveCliStatus,
    effectiveCliStatusLoading,
    openDashboard,
  ]);

  // Browser mode guard
  if (!api.plugins && !api.mcpRegistry && !api.skills) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Puzzle className="mx-auto mb-3 size-12 text-text-muted" />
          <h2 className="text-lg font-semibold text-text">扩展</h2>
          <p className="mt-1 text-sm text-text-muted">仅桌面应用可用。</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {cliStatusBanner}
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Puzzle className="size-5 text-text-muted" />
              <h1 className="text-lg font-semibold text-text">扩展</h1>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing}>
                  <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新目录</TooltipContent>
            </Tooltip>
          </div>

          {/* Sub-tabs */}
          <div className="px-6 py-4">
            {/* CLI not installed warning */}
            {!cliInstalled && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
                <AlertTriangle className="size-4 shrink-0" />
                安装或卸载扩展需要配置运行时。请前往首页安装或修复。
              </div>
            )}
            {/* Active sessions warning */}
            {hasOngoingSessions && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-400">
                <Info className="size-4 shrink-0" />
                正在运行的会话需要重启后才会应用扩展变更。
              </div>
            )}
            <Tabs
              value={tabState.activeSubTab}
              onValueChange={(v) => tabState.setActiveSubTab(v as ExtensionsSubTab)}
            >
              <div className="-mx-6 flex items-end justify-between border-b border-border px-6">
                <TabsList className="gap-1 rounded-b-none">
                  {subTabs.map((subTab) => (
                    <ExtensionsSubTabTrigger
                      key={subTab.value}
                      value={subTab.value}
                      label={subTab.label}
                      icon={subTab.icon}
                      description={subTab.description}
                    />
                  ))}
                </TabsList>
              </div>

              <TabsContent value="plugins" className="mt-0 pt-4">
                <PluginsPanel
                  projectPath={projectPath}
                  pluginFilters={tabState.pluginFilters}
                  pluginSort={tabState.pluginSort}
                  setPluginSort={tabState.setPluginSort}
                  selectedPluginId={tabState.selectedPluginId}
                  setSelectedPluginId={tabState.setSelectedPluginId}
                  updatePluginSearch={tabState.updatePluginSearch}
                  toggleCategory={tabState.toggleCategory}
                  toggleCapability={tabState.toggleCapability}
                  toggleInstalledOnly={tabState.toggleInstalledOnly}
                  clearFilters={tabState.clearFilters}
                  hasActiveFilters={tabState.hasActiveFilters}
                  cliStatus={effectiveCliStatus}
                  cliStatusLoading={effectiveCliStatusLoading}
                />
              </TabsContent>

              <TabsContent value="mcp-servers" className="mt-0 pt-4">
                <McpLibraryPanel projectPath={projectPath} />
              </TabsContent>

              <TabsContent value="skills" className="mt-0 pt-4">
                <SkillsLibraryPanel projectPath={projectPath} projectLabel={projectLabel} />
              </TabsContent>

              <TabsContent value="env-vars" className="mt-0 pt-4">
                <EnvVarPanel projectPath={projectPath} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
      <StoreExtensionToast />
    </TooltipProvider>
  );
};
