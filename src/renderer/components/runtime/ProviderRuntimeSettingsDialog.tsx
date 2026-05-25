import { useCallback, useEffect, useMemo, useState } from 'react';

import { providersApi } from '@renderer/api/providers';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Loader2, RefreshCw } from 'lucide-react';

import type { CliProviderId, CliProviderStatus } from '@shared/types';
import type { AgentType, GlobalProvider } from '@shared/types/providers';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly providers: CliProviderStatus[];
  readonly initialProviderId: CliProviderId;
  readonly projectPath?: string | null;
  readonly providerStatusLoading?: Partial<Record<CliProviderId, boolean>>;
  readonly disabled?: boolean;
  readonly onSelectBackend: (providerId: CliProviderId, backendId: string) => Promise<void> | void;
  readonly onRefreshProvider?: (providerId: CliProviderId) => Promise<void> | void;
  readonly onRequestLogin?: (providerId: CliProviderId) => void;
}

const AGENT_TYPE_BY_CLI_PROVIDER: Record<CliProviderId, AgentType> = {
  anthropic: 'claudecode',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

const CLI_PROVIDER_LABELS: Record<CliProviderId, string> = {
  anthropic: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

function resolveProviderEndpoint(provider: GlobalProvider, agentType: AgentType): string {
  return provider.endpoints?.[agentType] ?? provider.base_url ?? '默认端点';
}

function resolveProviderModel(provider: GlobalProvider, agentType: AgentType): string {
  return (
    provider.agent_models?.[agentType] ??
    provider.model ??
    provider.models?.[0]?.model ??
    '未指定模型'
  );
}

export const ProviderRuntimeSettingsDialog = ({
  open,
  onOpenChange,
  initialProviderId,
}: Props): React.JSX.Element => {
  const agentType = AGENT_TYPE_BY_CLI_PROVIDER[initialProviderId];
  const harnessLabel = CLI_PROVIDER_LABELS[initialProviderId] ?? initialProviderId;
  const [providers, setProviders] = useState<GlobalProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderModel, setNewProviderModel] = useState('');
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState('');
  const [newProviderApiKey, setNewProviderApiKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const harnessProviders = useMemo(
    () => providers.filter((provider) => provider.agent_types?.includes(agentType)),
    [agentType, providers]
  );

  const refreshProviders = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await providersApi.list();
      setProviders(result.providers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Provider 失败');
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void refreshProviders();
    }
  }, [open, refreshProviders]);

  useEffect(() => {
    if (!open) {
      setNewProviderName('');
      setNewProviderModel('');
      setNewProviderBaseUrl('');
      setNewProviderApiKey('');
      setAddError(null);
    }
  }, [open]);

  const handleAddProvider = async (): Promise<void> => {
    if (!newProviderName.trim()) {
      setAddError('请填写 Provider 名称');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await providersApi.add({
        name: newProviderName.trim(),
        model: newProviderModel.trim() || undefined,
        base_url: newProviderBaseUrl.trim() || undefined,
        api_key: newProviderApiKey.trim() || undefined,
        agent_types: [agentType],
      });
      setNewProviderName('');
      setNewProviderModel('');
      setNewProviderBaseUrl('');
      setNewProviderApiKey('');
      await refreshProviders();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '添加 Provider 失败');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,760px)] max-w-[min(92vw,760px)]">
        <DialogHeader>
          <DialogTitle>{harnessLabel} 配置</DialogTitle>
          <DialogDescription>
            统一管理当前 Harness 可用的 Provider。账号、模型、端点都通过 Provider 配置维护。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="space-y-3 rounded-lg border p-3"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                新增 Provider
              </div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                保存后会自动绑定到 {harnessLabel}。
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={newProviderName}
                onChange={(event) => setNewProviderName(event.target.value)}
                placeholder="Provider 名称，例如 deepseek"
              />
              <Input
                value={newProviderModel}
                onChange={(event) => setNewProviderModel(event.target.value)}
                placeholder="默认模型（可选）"
              />
              <Input
                value={newProviderBaseUrl}
                onChange={(event) => setNewProviderBaseUrl(event.target.value)}
                placeholder="Base URL（可选）"
              />
              <Input
                type="password"
                value={newProviderApiKey}
                onChange={(event) => setNewProviderApiKey(event.target.value)}
                placeholder="API Key（可选）"
              />
            </div>
            {addError ? <div className="text-xs text-red-400">{addError}</div> : null}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={adding}
                onClick={() => void handleAddProvider()}
              >
                {adding ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                添加 Provider
              </Button>
            </div>
          </div>

          <div
            className="space-y-3 rounded-lg border p-3"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  已绑定 Provider
                </div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Agent 类型：{agentType}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => void refreshProviders()}
              >
                <RefreshCw className={loading ? 'mr-1 size-3.5 animate-spin' : 'mr-1 size-3.5'} />
                刷新
              </Button>
            </div>

            {error ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            ) : null}

            {loading && harnessProviders.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 className="size-3 animate-spin" />
                正在加载 Provider...
              </div>
            ) : harnessProviders.length > 0 ? (
              <div className="space-y-2">
                {harnessProviders.map((provider) => (
                  <div
                    key={provider.name}
                    className="rounded-lg border px-3 py-2"
                    style={{
                      borderColor: 'var(--color-border-subtle)',
                      backgroundColor: 'rgba(255, 255, 255, 0.025)',
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {provider.name}
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{
                          color: provider.api_key ? '#86efac' : '#fbbf24',
                          backgroundColor: provider.api_key
                            ? 'rgba(74, 222, 128, 0.14)'
                            : 'rgba(245, 158, 11, 0.12)',
                        }}
                      >
                        {provider.api_key ? 'API Key 已配置' : '未配置 Key'}
                      </span>
                    </div>
                    <div
                      className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <span>端点：{resolveProviderEndpoint(provider, agentType)}</span>
                      <span>模型：{resolveProviderModel(provider, agentType)}</span>
                      {provider.thinking ? <span>Thinking：{provider.thinking}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="rounded-md border px-3 py-2 text-xs"
                style={{
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-muted)',
                }}
              >
                当前还没有绑定到 {harnessLabel} 的 Provider。请在上方添加一个 Provider。
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
