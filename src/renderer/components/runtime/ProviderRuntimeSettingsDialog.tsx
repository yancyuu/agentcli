import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  formatCodexCreditsValue,
  formatCodexRemainingPercent,
  formatCodexResetWindowLabel,
  formatCodexUsageExplanation,
  formatCodexUsagePercent,
  formatCodexUsageWindowLabel,
  formatCodexWindowDurationLong,
  mergeCodexProviderStatusWithSnapshot,
  normalizeCodexResetTimestamp,
  useCodexAccountSnapshot,
} from '@features/codex-account/renderer';
import {
  CODEX_FAST_CREDIT_COST_MULTIPLIER,
  CODEX_FAST_MODEL_ID,
  CODEX_FAST_SPEED_MULTIPLIER,
  resolveCodexFastMode,
  resolveCodexRuntimeSelection,
} from '@features/codex-runtime-profile/renderer';
import { RuntimeProviderManagementPanel } from '@features/runtime-provider-management/renderer';
import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { useStore } from '@renderer/store';
import { getProviderScopedTeamModelLabel } from '@renderer/utils/teamModelCatalog';
import { AlertTriangle, Eye, EyeOff, Key, Link2, Loader2, Save, Trash2 } from 'lucide-react';

import { api } from '@renderer/api';

import {
  formatProviderAuthMethodLabelForProvider,
  formatProviderAuthModeLabelForProvider,
  getProviderConnectLabel,
  getProviderCurrentRuntimeSummary,
  isConnectionManagedRuntimeProvider,
} from './providerConnectionUi';
import {
  getProviderRuntimeBackendSummary,
  getVisibleProviderRuntimeBackendOptions,
  ProviderRuntimeBackendSelector,
} from './ProviderRuntimeBackendSelector';

import type { CliProviderAuthMode, CliProviderId, CliProviderStatus } from '@shared/types';
import type { ApiKeyEntry } from '@shared/types/extensions';

type ApiKeyProviderId = 'anthropic' | 'codex' | 'gemini';
type PendingConnectionAction = 'auto' | 'oauth' | 'chatgpt' | 'api_key' | null;

interface ConnectionMethodCardOption {
  readonly authMode: CliProviderAuthMode;
  readonly title: string;
  readonly description: string;
}

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

const API_KEY_PROVIDER_CONFIG: Record<
  ApiKeyProviderId,
  {
    envVarName: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY';
    name: string;
    title: string;
    description: string;
    placeholder: string;
  }
> = {
  anthropic: {
    envVarName: 'ANTHROPIC_API_KEY',
    name: 'Anthropic API Key',
    title: 'API 密钥',
    description:
      '使用直接的 Anthropic API 密钥进行按 API 计费的访问。切回后，你的 Anthropic 订阅会话仍可使用。',
    placeholder: 'sk-ant-...',
  },
  codex: {
    envVarName: 'OPENAI_API_KEY',
    name: 'Codex API Key',
    title: 'API 密钥',
    description:
      '将 OpenAI API 密钥作为 Codex 的备用认证路径。切换到 Codex API 密钥模式后，应用会把 OPENAI_API_KEY 映射到 CODEX_API_KEY 供原生启动使用。',
    placeholder: 'sk-proj-...',
  },
  gemini: {
    envVarName: 'GEMINI_API_KEY',
    name: 'Gemini API Key',
    title: 'API 访问',
    description: '为 Gemini API 后端使用 `GEMINI_API_KEY`。CLI SDK 和 ADC 不需要它。',
    placeholder: 'AIza...',
  },
};

function isApiKeyProviderId(providerId: CliProviderId): providerId is ApiKeyProviderId {
  return providerId === 'anthropic' || providerId === 'codex' || providerId === 'gemini';
}

function findPreferredApiKeyEntry(apiKeys: ApiKeyEntry[], envVarName: string): ApiKeyEntry | null {
  const matches = apiKeys.filter((entry) => entry.envVarName === envVarName);
  return matches.find((entry) => entry.scope === 'user') ?? null;
}

function getConnectionDescription(provider: CliProviderStatus): string {
  switch (provider.providerId) {
    case 'anthropic':
      return '选择应用启动的 Anthropic 会话如何认证。';
    case 'codex':
      return '选择 Codex 原生运行时启动时优先使用 ChatGPT 订阅还是 API 密钥。';
    case 'gemini':
      return '配置可选 API 访问。CLI SDK 和 ADC 仍会自动发现。';
    case 'opencode':
      return 'OpenCode 认证和提供商清单由 OpenCode 运行时管理。';
  }
}

function getRuntimeDescription(provider: CliProviderStatus): string {
  switch (provider.providerId) {
    case 'anthropic':
      return 'Anthropic 当前没有单独的运行时后端选择器。';
    case 'codex':
      return 'Codex 现在仅通过原生运行时路径运行。';
    case 'gemini':
      return '选择多模型运行时应使用哪个 Gemini 后端。';
    case 'opencode':
      return 'OpenCode 使用自己的托管运行时宿主。桌面端当前仅显示状态。';
  }
}

function getAuthModeDescription(providerId: CliProviderId, authMode: CliProviderAuthMode): string {
  if (providerId === 'anthropic') {
    switch (authMode) {
      case 'auto':
        return '使用运行时默认行为。此应用保存的 API 密钥只会在切换到 API 密钥模式后使用。';
      case 'oauth':
        return '强制应用启动的 Anthropic 会话使用本地 Anthropic 订阅会话。';
      case 'api_key':
        return '强制应用启动的 Anthropic 会话使用 API 密钥凭据。';
    }
  }

  if (providerId === 'codex') {
    switch (authMode) {
      case 'auto':
        return '可用时优先使用 ChatGPT 账号，仅在需要时回退到 API 密钥模式。';
      case 'chatgpt':
        return '强制 Codex 原生启动使用已连接的 ChatGPT 账号和订阅。';
      case 'api_key':
        return '强制 Codex 原生启动使用 OPENAI_API_KEY / CODEX_API_KEY 计费。';
      default:
        return '';
    }
  }

  return '';
}

function getConnectionAlert(provider: CliProviderStatus): string | null {
  const authMode = provider.connection?.configuredAuthMode;
  const hasAnthropicSubscriptionSession =
    provider.authMethod === 'oauth_token' || provider.authMethod === 'claude.ai';

  if (
    provider.providerId === 'anthropic' &&
    authMode === 'api_key' &&
    !provider.connection?.apiKeyConfigured
  ) {
    return '已选择 API 密钥模式，但尚未配置 Anthropic API 凭据。';
  }

  if (
    provider.providerId === 'anthropic' &&
    authMode === 'oauth' &&
    !hasAnthropicSubscriptionSession
  ) {
    return '已选择 Anthropic 订阅模式。请登录 Anthropic 后使用此提供商。';
  }

  if (
    provider.providerId === 'anthropic' &&
    authMode === 'auto' &&
    provider.connection?.apiKeySource === 'stored'
  ) {
    return '已有保存的 API 密钥，但应用启动的 Anthropic 会话只会在切换到 API 密钥模式后使用它。';
  }

  if (provider.providerId === 'codex') {
    const codex = provider.connection?.codex;
    if (codex?.login.status === 'starting') {
      return '正在启动 ChatGPT 登录...';
    }

    if (codex?.login.status === 'pending') {
      return '正在等待 ChatGPT 账号登录完成...';
    }

    if (codex?.login.status === 'failed' && codex.login.error) {
      return codex.login.error;
    }

    if (provider.connection?.configuredAuthMode === 'api_key') {
      if (!provider.connection?.apiKeyConfigured) {
        return '已选择 API 密钥模式，但尚未配置 OPENAI_API_KEY 或 CODEX_API_KEY 凭据。';
      }
      return null;
    }

    if (provider.connection?.configuredAuthMode === 'chatgpt' && !codex?.managedAccount) {
      const missingChatgptMessage = codex?.localActiveChatgptAccountPresent
        ? 'Codex 已有本地选择的 ChatGPT 账号，但当前会话需要重新连接。'
        : codex?.localAccountArtifactsPresent
          ? 'Codex CLI 当前没有活跃的 ChatGPT 账号。本地存在 Codex 账号数据，但尚未选择活跃的托管会话。'
          : 'Codex CLI 当前没有活跃的 ChatGPT 账号。连接 ChatGPT 后即可使用订阅。';
      return provider.connection.apiKeyConfigured
        ? `${missingChatgptMessage} 切换到 API 密钥模式即可使用检测到的 API 密钥。`
        : missingChatgptMessage;
    }

    if (!codex?.launchAllowed && codex?.launchIssueMessage) {
      return codex.launchIssueMessage;
    }

    if (codex?.appServerState === 'degraded' && codex.appServerStatusMessage) {
      return codex.appServerStatusMessage;
    }

    if (!provider.connection?.apiKeyConfigured && !codex?.managedAccount) {
      return '尚无可用的 ChatGPT 账号或 API 密钥。';
    }

    return null;
  }

  if (
    provider.providerId === 'gemini' &&
    provider.availableBackends?.some((option) => option.id === 'api' && !option.available)
  ) {
    return 'Gemini API 当前不可用。请在此配置 `GEMINI_API_KEY`，或使用有效的 Google ADC 凭据。';
  }

  return null;
}

function getCodexAccountPanelHint(
  provider: CliProviderStatus | null,
  configuredAuthMode: CliProviderAuthMode | undefined
): string | null {
  if (provider?.providerId !== 'codex') {
    return null;
  }

  const codex = provider.connection?.codex;
  if (!codex || codex.login.status === 'starting' || codex.login.status === 'pending') {
    return null;
  }

  const hasActiveChatgptSession =
    codex.effectiveAuthMode === 'chatgpt' && codex.launchAllowed === true;

  if (hasActiveChatgptSession) {
    if (!codex.rateLimits) {
      return 'Codex 报告已连接 ChatGPT 账号的用量限制后，会显示在这里。';
    }

    return null;
  }

  const usageSentence = codex.localActiveChatgptAccountPresent
    ? 'Codex 已有本地选择的 ChatGPT 账号，但当前会话需要重新连接后才能在这里加载用量限制。'
    : codex.localAccountArtifactsPresent
      ? 'Codex CLI 当前未报告活跃的 ChatGPT 账号。本地存在 Codex 账号数据，但尚未选择活跃的托管会话。只有 Codex CLI 识别到账号后，用量限制才会显示在这里。'
      : 'Codex CLI 当前未报告活跃的 ChatGPT 账号。只有 Codex CLI 识别到账号后，用量限制才会显示在这里。';
  if (configuredAuthMode === 'chatgpt' && provider.connection?.apiKeyConfigured) {
    return `${usageSentence} 检测到的 API 密钥只会在你将 Codex 切换到 API 密钥模式后使用。`;
  }

  if (configuredAuthMode === 'auto' && provider.connection?.apiKeyConfigured) {
    return `${usageSentence} 自动模式会在 ChatGPT 连接前继续使用检测到的 API 密钥。`;
  }

  return usageSentence;
}

function getCheckingStatusColor(): string {
  return 'var(--color-text-secondary)';
}

function getProviderStatusColor(statusText: string | null, authenticated: boolean): string {
  if (statusText === 'Checking...') {
    return getCheckingStatusColor();
  }

  return authenticated ? '#4ade80' : 'var(--color-text-muted)';
}

function formatCodexResetDateTime(timestampSeconds: number | null | undefined): string {
  const normalized = normalizeCodexResetTimestamp(timestampSeconds);
  return normalized ? new Date(normalized).toLocaleString() : 'Unknown';
}

const CodexRateLimitWindowCard = ({
  title,
  usedLabel,
  usedValue,
  remainingValue,
  resetLabel,
  resetValue,
  accent,
}: Readonly<{
  title: string;
  usedLabel: string;
  usedValue: string;
  remainingValue: string;
  resetLabel: string;
  resetValue: string;
  accent: 'primary' | 'secondary';
}>): React.JSX.Element => {
  const accentStyles =
    accent === 'primary'
      ? {
          borderColor: 'rgba(74, 222, 128, 0.24)',
          backgroundColor: 'rgba(74, 222, 128, 0.05)',
          badgeColor: '#86efac',
          badgeBackground: 'rgba(74, 222, 128, 0.14)',
        }
      : {
          borderColor: 'rgba(125, 211, 252, 0.22)',
          backgroundColor: 'rgba(125, 211, 252, 0.04)',
          badgeColor: '#bae6fd',
          badgeBackground: 'rgba(125, 211, 252, 0.14)',
        };

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        borderColor: accentStyles.borderColor,
        backgroundColor: accentStyles.backgroundColor,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {title}
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: accentStyles.badgeColor,
            backgroundColor: accentStyles.badgeBackground,
          }}
        >
          {remainingValue}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-1">
          <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {usedLabel}
          </div>
          <div
            className="text-3xl font-semibold leading-none"
            style={{ color: 'var(--color-text)' }}
          >
            {usedValue}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            {remainingValue} left
          </div>
        </div>

        <div
          className="rounded-md border px-3 py-2"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {resetLabel}
          </div>
          <div className="mt-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {resetValue}
          </div>
        </div>
      </div>
    </div>
  );
};

function getAnthropicAuthState(provider: CliProviderStatus): {
  label: string;
  detail: string;
  color: string;
  backgroundColor: string;
} {
  const configuredAuthMode = provider.connection?.configuredAuthMode ?? 'auto';
  const hasSubscriptionSession =
    provider.authMethod === 'oauth_token' || provider.authMethod === 'claude.ai';

  if (configuredAuthMode === 'api_key') {
    return provider.connection?.apiKeyConfigured
      ? {
          label: 'API 密钥已就绪',
          detail: provider.connection.apiKeySourceLabel ?? '使用 ANTHROPIC_API_KEY',
          color: '#86efac',
          backgroundColor: 'rgba(74, 222, 128, 0.14)',
        }
      : {
          label: '缺少 API 密钥',
          detail: '当前已选择 API 密钥模式，但还没有可用的 ANTHROPIC_API_KEY。',
          color: '#fbbf24',
          backgroundColor: 'rgba(245, 158, 11, 0.14)',
        };
  }

  if (configuredAuthMode === 'oauth') {
    return hasSubscriptionSession && provider.authenticated
      ? {
          label: 'Claude 订阅已连接',
          detail: '使用本机 Claude Code / Anthropic 登录态启动团队。',
          color: '#86efac',
          backgroundColor: 'rgba(74, 222, 128, 0.14)',
        }
      : {
          label: '需要登录 Claude',
          detail: '当前强制使用 Anthropic 订阅模式，请重新连接本机登录态。',
          color: '#fbbf24',
          backgroundColor: 'rgba(245, 158, 11, 0.14)',
        };
  }

  if (provider.authenticated) {
    return {
      label: `自动模式 · ${formatProviderAuthMethodLabelForProvider(
        provider.providerId,
        provider.authMethod
      )}`,
      detail: 'Claude Code 会按本机运行时默认顺序解析订阅或环境凭据。',
      color: '#86efac',
      backgroundColor: 'rgba(74, 222, 128, 0.14)',
    };
  }

  return {
    label: '自动模式待连接',
    detail: provider.statusMessage ?? '等待 Claude Code 报告可用的本机凭据。',
    color: 'var(--color-text-muted)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  };
}

function formatAnthropicCatalogStatus(provider: CliProviderStatus): string {
  const catalog = provider.modelCatalog;
  if (!catalog) {
    return '模型目录：未加载';
  }

  const sourceLabel =
    catalog.source === 'anthropic-models-api'
      ? 'Anthropic Models API'
      : catalog.source === 'app-server'
        ? 'App server'
        : '静态回退';
  const statusLabel =
    catalog.status === 'ready'
      ? 'ready'
      : catalog.status === 'stale'
        ? 'stale'
        : catalog.status === 'degraded'
          ? 'degraded'
          : 'unavailable';
  return `模型目录：${sourceLabel} · ${statusLabel}`;
}

function getAnthropicDefaultModelLabel(provider: CliProviderStatus): string {
  const defaultLaunchModel =
    provider.modelCatalog?.defaultLaunchModel?.trim() ||
    provider.modelCatalog?.defaultModelId?.trim() ||
    'opus';
  return getProviderScopedTeamModelLabel('anthropic', defaultLaunchModel) ?? defaultLaunchModel;
}

function getAnthropicVisibleModelLabels(provider: CliProviderStatus): string[] {
  const catalogModels = provider.modelCatalog?.models ?? [];
  const sourceModels =
    catalogModels.length > 0
      ? catalogModels.filter((model) => !model.hidden).map((model) => model.launchModel)
      : provider.models;
  return Array.from(
    new Set(
      sourceModels
        .map((model) => getProviderScopedTeamModelLabel('anthropic', model) ?? model.trim())
        .filter(Boolean)
    )
  );
}

function getAnthropicReasoningEffortSummary(provider: CliProviderStatus): string {
  const configuredValues = provider.runtimeCapabilities?.reasoningEffort?.values ?? [];
  const catalogValues =
    provider.modelCatalog?.models.flatMap((model) => model.supportedReasoningEfforts) ?? [];
  const values = Array.from(new Set([...configuredValues, ...catalogValues])).filter(Boolean);
  return values.length > 0 ? values.join(', ') : '未报告';
}

function getAnthropicDiagnosticLines(provider: CliProviderStatus): string[] {
  const lines: string[] = [];
  const catalog = provider.modelCatalog;
  if (catalog?.diagnostics.message) {
    lines.push(catalog.diagnostics.message);
  }
  if (catalog?.diagnostics.configReadState) {
    lines.push(`配置读取：${catalog.diagnostics.configReadState}`);
  }
  if (catalog?.diagnostics.appServerState) {
    lines.push(`运行时探测：${catalog.diagnostics.appServerState}`);
  }
  if (provider.runtimeCapabilities?.fastMode?.reason) {
    lines.push(`Fast mode：${provider.runtimeCapabilities.fastMode.reason}`);
  }
  return lines;
}

function getConnectionMethodCardOptions(
  provider: CliProviderStatus
): ConnectionMethodCardOption[] | null {
  switch (provider.providerId) {
    case 'anthropic':
      return [
        {
          authMode: 'auto',
          title: '自动',
          description: '使用 Anthropic 运行时默认值和最佳可用本地凭据。',
        },
        {
          authMode: 'oauth',
          title: 'Anthropic 订阅',
          description: '使用本地 Anthropic 登录会话和订阅访问权限。',
        },
        {
          authMode: 'api_key',
          title: 'API 密钥',
          description: '使用 ANTHROPIC_API_KEY 和 Anthropic API 计费。',
        },
      ];
    case 'codex':
      return [
        {
          authMode: 'auto',
          title: '自动',
          description: '优先使用 ChatGPT 账号和订阅，仅在需要时使用 API 密钥模式。',
        },
        {
          authMode: 'chatgpt',
          title: 'ChatGPT 账号',
          description: '使用已连接的 ChatGPT 账号和 Codex 订阅。',
        },
        {
          authMode: 'api_key',
          title: 'API 密钥',
          description: '为 Codex 原生启动使用 OPENAI_API_KEY 和 CODEX_API_KEY 计费。',
        },
      ];
    default:
      return null;
  }
}

function getConnectionMethodCardsHint(provider: CliProviderStatus): string | null {
  if (provider.providerId === 'codex') {
    return 'Codex 始终通过原生运行时运行。自动模式会优先使用 ChatGPT 账号，再回退到 API 密钥凭据。';
  }

  if (provider.providerId === 'anthropic') {
    return '自动模式会让 Anthropic 保持默认的本地凭据解析方式。';
  }

  return null;
}

const ConnectionMethodCards = ({
  options,
  selectedAuthMode,
  disabled,
  connectionSaving,
  pendingConnectionAction,
  onSelect,
}: Readonly<{
  options: ConnectionMethodCardOption[];
  selectedAuthMode: CliProviderAuthMode;
  disabled: boolean;
  connectionSaving: boolean;
  pendingConnectionAction: PendingConnectionAction;
  onSelect: (authMode: CliProviderAuthMode) => void;
}>): React.JSX.Element => {
  const gridClassName =
    options.length === 3 ? 'grid gap-2 md:grid-cols-3' : 'grid gap-2 sm:grid-cols-2';

  return (
    <div className={gridClassName}>
      {options.map((option) => {
        const selected = selectedAuthMode === option.authMode;
        return (
          <button
            key={option.authMode}
            type="button"
            onClick={() => onSelect(option.authMode)}
            disabled={disabled}
            className="rounded-md border p-3 text-left transition-colors disabled:opacity-60"
            style={{
              borderColor: selected ? 'rgba(74, 222, 128, 0.32)' : 'var(--color-border-subtle)',
              backgroundColor: selected ? 'rgba(74, 222, 128, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <div
              className="flex items-center justify-between gap-2 text-sm font-medium"
              style={{ color: 'var(--color-text)' }}
            >
              <span>{option.title}</span>
              {connectionSaving && pendingConnectionAction === option.authMode ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <Loader2 className="size-3 animate-spin" />
                  切换中...
                </span>
              ) : selected ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    color: '#86efac',
                    backgroundColor: 'rgba(74, 222, 128, 0.14)',
                  }}
                >
                  已选择
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {option.description}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export const ProviderRuntimeSettingsDialog = ({
  open,
  onOpenChange,
  providers,
  initialProviderId,
  projectPath = null,
  providerStatusLoading = {},
  disabled = false,
  onSelectBackend,
  onRefreshProvider,
  onRequestLogin,
}: Props): React.JSX.Element => {
  const [selectedProviderId, setSelectedProviderId] = useState<CliProviderId>(initialProviderId);
  const [activeApiKeyFormProviderId, setActiveApiKeyFormProviderId] =
    useState<ApiKeyProviderId | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeyScope, setApiKeyScope] = useState<'user' | 'project'>('user');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [pendingConnectionAction, setPendingConnectionAction] =
    useState<PendingConnectionAction>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  // Claude env vars state
  const [claudeEnv, setClaudeEnv] = useState<Record<string, string>>({});
  const [claudeEnvOriginal, setClaudeEnvOriginal] = useState<Record<string, string>>({});
  const [claudeEnvLoaded, setClaudeEnvLoaded] = useState(false);
  const [claudeEnvSaving, setClaudeEnvSaving] = useState(false);
  const [claudeEnvSaved, setClaudeEnvSaved] = useState(false);
  const [claudeEnvVisibleKeys, setClaudeEnvVisibleKeys] = useState<Set<string>>(new Set());

  const apiKeys = useStore((s) => s.apiKeys);
  const apiKeysLoading = useStore((s) => s.apiKeysLoading);
  const apiKeysError = useStore((s) => s.apiKeysError);
  const apiKeySaving = useStore((s) => s.apiKeySaving);
  const apiKeyStorageStatus = useStore((s) => s.apiKeyStorageStatus);
  const fetchApiKeys = useStore((s) => s.fetchApiKeys);
  const fetchApiKeyStorageStatus = useStore((s) => s.fetchApiKeyStorageStatus);
  const saveApiKey = useStore((s) => s.saveApiKey);
  const deleteApiKey = useStore((s) => s.deleteApiKey);
  const updateConfig = useStore((s) => s.updateConfig);
  const appConfig = useStore((s) => s.appConfig);
  const bootstrapCliStatus = useStore((s) => s.bootstrapCliStatus);
  const fetchCliStatus = useStore((s) => s.fetchCliStatus);
  const codexAccount = useCodexAccountSnapshot({
    enabled: open && selectedProviderId === 'codex',
    includeRateLimits: true,
  });

  const refreshCliStatus = useCallback(() => {
    const multimodelEnabled = appConfig?.general?.multimodelEnabled ?? false;
    if (multimodelEnabled) {
      void bootstrapCliStatus({ multimodelEnabled: true });
    } else {
      void fetchCliStatus();
    }
  }, [appConfig?.general?.multimodelEnabled, bootstrapCliStatus, fetchCliStatus]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedProviderId(initialProviderId);
    void fetchApiKeys();
    void fetchApiKeyStorageStatus();
  }, [fetchApiKeyStorageStatus, fetchApiKeys, initialProviderId, open]);

  useEffect(() => {
    if (open) {
      return;
    }

    setActiveApiKeyFormProviderId(null);
    setApiKeyValue('');
    setApiKeyScope('user');
    setApiKeyError(null);
    setConnectionError(null);
    setRuntimeError(null);
    setConnectionSaving(false);
    setRuntimeSaving(false);
    setPendingConnectionAction(null);
  }, [open]);

  useEffect(() => {
    setConnectionError(null);
    setRuntimeError(null);
  }, [selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId === 'codex' && codexAccount.error) {
      setConnectionError(codexAccount.error);
    }
  }, [codexAccount.error, selectedProviderId]);

  // Load Claude env vars when Anthropic provider is selected
  useEffect(() => {
    if (selectedProviderId === 'anthropic' && !claudeEnvLoaded) {
      void api.config
        .getClaudeEnv()
        .then((data) => {
          setClaudeEnv(data);
          setClaudeEnvOriginal(data);
          setClaudeEnvLoaded(true);
        })
        .catch(() => {
          setClaudeEnvLoaded(true);
        });
    }
  }, [selectedProviderId, claudeEnvLoaded]);

  const statusSelectedProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.providerId === selectedProviderId) ??
      providers.find(
        (provider) => provider.availableBackends && provider.availableBackends.length > 0
      ) ??
      providers[0] ??
      null
    );
  }, [providers, selectedProviderId]);

  const statusApiKeyConfig =
    statusSelectedProvider && isApiKeyProviderId(statusSelectedProvider.providerId)
      ? API_KEY_PROVIDER_CONFIG[statusSelectedProvider.providerId]
      : null;
  const selectedApiKey = statusApiKeyConfig
    ? findPreferredApiKeyEntry(apiKeys, statusApiKeyConfig.envVarName)
    : null;

  const selectedProvider = useMemo(() => {
    const mergedStatusProvider =
      statusSelectedProvider?.providerId === 'codex'
        ? mergeCodexProviderStatusWithSnapshot(statusSelectedProvider, codexAccount.snapshot)
        : statusSelectedProvider;

    if (!mergedStatusProvider?.connection) {
      return mergedStatusProvider;
    }

    const nextConnection = {
      ...mergedStatusProvider.connection,
    };

    if (mergedStatusProvider.providerId === 'anthropic') {
      nextConnection.configuredAuthMode =
        appConfig?.providerConnections?.anthropic.authMode ??
        mergedStatusProvider.connection.configuredAuthMode;
    }

    if (mergedStatusProvider.providerId === 'codex') {
      nextConnection.configuredAuthMode =
        appConfig?.providerConnections?.codex.preferredAuthMode ??
        mergedStatusProvider.connection.configuredAuthMode;
    }

    if (statusApiKeyConfig) {
      if (nextConnection.apiKeySource === 'stored') {
        nextConnection.apiKeyConfigured = Boolean(selectedApiKey);
        nextConnection.apiKeySource = selectedApiKey ? 'stored' : null;
        nextConnection.apiKeySourceLabel = selectedApiKey ? '已存储在应用中' : null;
      } else if (!nextConnection.apiKeyConfigured && selectedApiKey) {
        nextConnection.apiKeyConfigured = true;
        nextConnection.apiKeySource = 'stored';
        nextConnection.apiKeySourceLabel = '已存储在应用中';
      }
    }

    return {
      ...mergedStatusProvider,
      connection: nextConnection,
    };
  }, [
    appConfig?.providerConnections?.anthropic.authMode,
    appConfig?.providerConnections?.codex.preferredAuthMode,
    codexAccount.snapshot,
    selectedApiKey,
    statusApiKeyConfig,
    statusSelectedProvider,
  ]);

  const selectedProviderLoading = selectedProvider
    ? providerStatusLoading[selectedProvider.providerId] === true
    : false;
  const runtimeSummary = selectedProvider
    ? getProviderRuntimeBackendSummary(selectedProvider)
    : null;
  const codexConnection =
    selectedProvider?.providerId === 'codex' ? (selectedProvider.connection?.codex ?? null) : null;
  const codexHasActiveChatgptSession =
    codexConnection?.effectiveAuthMode === 'chatgpt' && codexConnection.launchAllowed === true;
  const codexNeedsReconnect =
    Boolean(codexConnection?.localActiveChatgptAccountPresent) && !codexHasActiveChatgptSession;
  const codexLoginPending =
    codexConnection?.login.status === 'starting' || codexConnection?.login.status === 'pending';
  const configurableAuthModes = selectedProvider?.connection?.configurableAuthModes ?? [];
  const configuredAuthMode: CliProviderAuthMode | undefined =
    selectedProvider?.connection?.configuredAuthMode ?? configurableAuthModes[0] ?? undefined;
  const connectionMethodCardOptions = selectedProvider
    ? getConnectionMethodCardOptions(selectedProvider)
    : null;
  const showConnectionMethodCards =
    connectionMethodCardOptions !== null && typeof configuredAuthMode !== 'undefined';
  const managedRuntimeSummary = selectedProvider
    ? getProviderCurrentRuntimeSummary(selectedProvider)
    : null;
  const connectionManagedRuntime = selectedProvider
    ? isConnectionManagedRuntimeProvider(selectedProvider)
    : false;
  const showRuntimeProviderManagement = selectedProvider?.providerId === 'opencode';
  const hideConnectionMethodMeta = showConnectionMethodCards;
  const canConfigureRuntime =
    !showRuntimeProviderManagement &&
    !connectionManagedRuntime &&
    (selectedProvider
      ? getVisibleProviderRuntimeBackendOptions(selectedProvider).length > 1
      : false);

  const apiKeyConfig =
    selectedProvider && isApiKeyProviderId(selectedProvider.providerId)
      ? API_KEY_PROVIDER_CONFIG[selectedProvider.providerId]
      : null;
  const showApiKeyForm =
    selectedProvider &&
    isApiKeyProviderId(selectedProvider.providerId) &&
    activeApiKeyFormProviderId === selectedProvider.providerId;
  const showApiKeySection = Boolean(
    apiKeyConfig &&
    (selectedProvider?.providerId === 'anthropic'
      ? true
      : selectedProvider?.providerId !== 'codex' || !selectedProvider.connection?.supportsOAuth)
  );
  const connectionAlert = selectedProvider ? getConnectionAlert(selectedProvider) : null;
  const connectionLoading =
    selectedProviderLoading ||
    connectionSaving ||
    Boolean(selectedProvider?.providerId === 'codex' && codexAccount.loading && !codexConnection);
  const connectionBusy = disabled || connectionLoading;
  const codexActionBusy =
    disabled || selectedProviderLoading || connectionSaving || codexAccount.loading;
  const runtimeBusy = disabled || selectedProviderLoading || runtimeSaving;
  const anthropicFastModeCapability =
    selectedProvider?.providerId === 'anthropic'
      ? (selectedProvider.runtimeCapabilities?.fastMode ?? null)
      : null;
  const anthropicFastModeEnabled =
    appConfig?.providerConnections?.anthropic.fastModeDefault === true;
  const anthropicFastModeSupported = anthropicFastModeCapability?.supported === true;
  const anthropicFastModeAvailable = anthropicFastModeCapability?.available === true;
  const anthropicFastModeDisabledReason =
    anthropicFastModeCapability?.reason ??
    (anthropicFastModeSupported
      ? '此 Anthropic 运行时当前无法使用 Fast mode。'
      : '此 Anthropic 运行时未提供 Fast mode。');
  const anthropicAuthState =
    selectedProvider?.providerId === 'anthropic' ? getAnthropicAuthState(selectedProvider) : null;
  const anthropicDefaultModelLabel =
    selectedProvider?.providerId === 'anthropic'
      ? getAnthropicDefaultModelLabel(selectedProvider)
      : null;
  const anthropicVisibleModelLabels =
    selectedProvider?.providerId === 'anthropic'
      ? getAnthropicVisibleModelLabels(selectedProvider)
      : [];
  const anthropicReasoningEffortSummary =
    selectedProvider?.providerId === 'anthropic'
      ? getAnthropicReasoningEffortSummary(selectedProvider)
      : null;
  const anthropicDiagnosticLines =
    selectedProvider?.providerId === 'anthropic'
      ? getAnthropicDiagnosticLines(selectedProvider)
      : [];
  const anthropicCatalogStatus =
    selectedProvider?.providerId === 'anthropic'
      ? formatAnthropicCatalogStatus(selectedProvider)
      : null;
  const connectionMethodCardsHint = selectedProvider
    ? getConnectionMethodCardsHint(selectedProvider)
    : null;
  const codexAccountPanelHint = getCodexAccountPanelHint(
    selectedProvider ?? null,
    configuredAuthMode
  );
  const codexFastCapability = useMemo(() => {
    if (selectedProvider?.providerId !== 'codex') {
      return null;
    }
    const fastProbeModel =
      selectedProvider.modelCatalog?.models.find((model) => model.supportsFastMode === true)
        ?.launchModel ?? CODEX_FAST_MODEL_ID;
    const selection = resolveCodexRuntimeSelection({
      source: {
        providerStatus: selectedProvider,
        accountSnapshot: codexAccount.snapshot,
      },
      selectedModel: fastProbeModel,
    });
    return resolveCodexFastMode({
      selection,
      selectedFastMode: 'on',
    });
  }, [codexAccount.snapshot, selectedProvider]);
  const codexFastCapabilityHint =
    selectedProvider?.providerId === 'codex' && codexFastCapability
      ? codexFastCapability.selectable
        ? `使用 ChatGPT 账号时，可为支持 Fast 的 Codex 模型按团队或计划启用 Fast mode。速度约提升 ${CODEX_FAST_SPEED_MULTIPLIER} 倍，消耗 ${CODEX_FAST_CREDIT_COST_MULTIPLIER} 倍 credits。`
        : (codexFastCapability.disabledReason ?? '此账号或运行时当前无法使用 Codex Fast mode。')
      : null;
  const hasSubscriptionSession =
    selectedProvider?.providerId === 'anthropic'
      ? selectedProvider.authMethod === 'oauth_token' || selectedProvider.authMethod === 'claude.ai'
      : false;
  const canRequestSubscriptionLogin =
    selectedProvider?.providerId === 'anthropic' &&
    Boolean(selectedProvider.connection?.supportsOAuth && onRequestLogin) &&
    configuredAuthMode !== 'api_key' &&
    selectedProvider.statusMessage !== 'Checking...' &&
    (!selectedProvider?.authenticated || hasSubscriptionSession || configuredAuthMode === 'oauth');

  useEffect(() => {
    if (!showApiKeyForm) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      apiKeyInputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedProvider?.providerId, showApiKeyForm]);

  let connectionStatusLabel: string | null = null;
  if (selectedProvider) {
    if (!hideConnectionMethodMeta && selectedProvider.authenticated) {
      connectionStatusLabel = `使用 ${formatProviderAuthMethodLabelForProvider(
        selectedProvider.providerId,
        selectedProvider.authMethod
      )}`;
    } else if (!hideConnectionMethodMeta) {
      connectionStatusLabel = '未连接';
    }
  }
  const showSelectedProviderSummary = Boolean(selectedProvider) && !connectionManagedRuntime;

  const connectionProgressMessage = useMemo(() => {
    if (!connectionLoading || !selectedProvider) {
      return null;
    }

    if (connectionSaving) {
      if (selectedProvider.providerId === 'anthropic') {
        switch (pendingConnectionAction) {
          case 'api_key':
            return '正在切换到 API 密钥...';
          case 'oauth':
            return '正在切换到 Anthropic 订阅...';
          case 'auto':
            return '正在切换到自动模式...';
          default:
            return '正在应用连接变更...';
        }
      }

      if (selectedProvider.providerId === 'codex') {
        switch (pendingConnectionAction) {
          case 'chatgpt':
            return '正在切换到 ChatGPT 账号模式...';
          case 'api_key':
            return '正在切换到 API 密钥模式...';
          case 'auto':
            return '正在切换到自动模式...';
          default:
            return '正在应用连接变更...';
        }
      }

      return '正在应用连接变更...';
    }

    return '正在刷新提供商状态...';
  }, [connectionLoading, connectionSaving, pendingConnectionAction, selectedProvider]);

  const handleStartApiKeyEdit = (): void => {
    if (!selectedProvider || !isApiKeyProviderId(selectedProvider.providerId) || !apiKeyConfig) {
      return;
    }

    setConnectionError(null);
    setActiveApiKeyFormProviderId(selectedProvider.providerId);
    setApiKeyScope(selectedApiKey?.scope ?? 'user');
    setApiKeyValue('');
    setApiKeyError(null);
  };

  const handleCancelApiKeyEdit = (): void => {
    setActiveApiKeyFormProviderId(null);
    setApiKeyValue('');
    setApiKeyError(null);
  };

  const handleSaveApiKey = async (): Promise<void> => {
    if (!selectedProvider || !isApiKeyProviderId(selectedProvider.providerId) || !apiKeyConfig) {
      return;
    }

    if (!apiKeyValue.trim()) {
      setApiKeyError('API 密钥不能为空');
      return;
    }

    setApiKeyError(null);
    setConnectionError(null);
    try {
      await saveApiKey({
        id: selectedApiKey?.id,
        name: apiKeyConfig.name,
        envVarName: apiKeyConfig.envVarName,
        value: apiKeyValue.trim(),
        scope: apiKeyScope,
      });
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : '保存 API 密钥失败');
      return;
    }

    setActiveApiKeyFormProviderId(null);
    setApiKeyValue('');

    refreshCliStatus();
    try {
      await onRefreshProvider?.(selectedProvider.providerId);
    } catch {
      setConnectionError('API 密钥已保存，但刷新提供商状态失败。');
    }
  };

  const handleDeleteApiKey = async (): Promise<void> => {
    if (!selectedProvider || !selectedApiKey) {
      return;
    }

    setApiKeyError(null);
    setConnectionError(null);
    try {
      await deleteApiKey(selectedApiKey.id);
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : '删除 API 密钥失败');
      return;
    }

    setActiveApiKeyFormProviderId(null);
    setApiKeyValue('');

    refreshCliStatus();
    try {
      await onRefreshProvider?.(selectedProvider.providerId);
    } catch {
      setConnectionError('API 密钥已删除，但刷新提供商状态失败。');
    }
  };

  const handleAuthModeChange = async (authMode: string): Promise<void> => {
    if (selectedProvider?.providerId !== 'anthropic' && selectedProvider?.providerId !== 'codex') {
      return;
    }

    const nextAuthMode = authMode as CliProviderAuthMode;
    if (nextAuthMode === configuredAuthMode) {
      return;
    }

    setConnectionSaving(true);
    setPendingConnectionAction(nextAuthMode);
    setConnectionError(null);
    let updateSucceeded = false;
    try {
      if (selectedProvider.providerId === 'anthropic') {
        await updateConfig('providerConnections', {
          anthropic: {
            authMode: nextAuthMode,
          },
        });
        setActiveApiKeyFormProviderId(nextAuthMode === 'api_key' ? 'anthropic' : null);
      } else if (nextAuthMode !== 'oauth') {
        await updateConfig('providerConnections', {
          codex: {
            preferredAuthMode: nextAuthMode,
          },
        });
        await codexAccount.refresh({ includeRateLimits: true, forceRefreshToken: true });
      }

      updateSucceeded = true;
      refreshCliStatus();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : '更新连接失败');
    } finally {
      if (updateSucceeded) {
        try {
          await onRefreshProvider?.(selectedProvider.providerId);
        } catch {
          setConnectionError('连接已更新，但刷新提供商状态失败。');
        }
      }

      setConnectionSaving(false);
      setPendingConnectionAction(null);
    }
  };

  const handleCodexAccountRefresh = async (): Promise<void> => {
    setConnectionError(null);
    try {
      await codexAccount.refresh({ includeRateLimits: true, forceRefreshToken: true });
      await onRefreshProvider?.('codex');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : '刷新 Codex 账号失败');
    }
  };

  const handleCodexStartLogin = async (): Promise<void> => {
    setConnectionError(null);
    const success = await codexAccount.startChatgptLogin();
    if (!success && codexAccount.error) {
      setConnectionError(codexAccount.error);
    }
  };

  const handleCodexCancelLogin = async (): Promise<void> => {
    setConnectionError(null);
    const success = await codexAccount.cancelChatgptLogin();
    if (success) {
      await onRefreshProvider?.('codex');
    } else if (codexAccount.error) {
      setConnectionError(codexAccount.error);
    }
  };

  const handleCodexLogout = async (): Promise<void> => {
    setConnectionError(null);
    const success = await codexAccount.logout();
    if (success) {
      await onRefreshProvider?.('codex');
    } else if (codexAccount.error) {
      setConnectionError(codexAccount.error);
    }
  };

  const handleRuntimeBackendSelect = async (
    providerId: CliProviderId,
    backendId: string
  ): Promise<void> => {
    setRuntimeSaving(true);
    setRuntimeError(null);
    try {
      await onSelectBackend(providerId, backendId);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : '更新运行时后端失败');
    } finally {
      setRuntimeSaving(false);
    }
  };

  const handleAnthropicFastModeDefaultChange = async (enabled: boolean): Promise<void> => {
    if (selectedProvider?.providerId !== 'anthropic' || anthropicFastModeEnabled === enabled) {
      return;
    }

    setConnectionSaving(true);
    setConnectionError(null);
    try {
      await updateConfig('providerConnections', {
        anthropic: {
          fastModeDefault: enabled,
        },
      });
      refreshCliStatus();
      await onRefreshProvider?.('anthropic');
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : '更新 Anthropic Fast mode 失败');
    } finally {
      setConnectionSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,980px)] max-w-[min(96vw,980px)]">
        <DialogHeader>
          <DialogTitle>提供商设置</DialogTitle>
          <DialogDescription>
            管理每个提供商的连接方式，以及在支持时选择多模型运行时使用的后端。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
              提供商
            </div>
            <Tabs
              value={selectedProvider?.providerId ?? selectedProviderId}
              onValueChange={(value) => setSelectedProviderId(value as CliProviderId)}
            >
              <div
                className="-mx-1 border-b px-1"
                style={{ borderColor: 'var(--color-border-subtle)' }}
              >
                <TabsList className="gap-1 rounded-b-none">
                  {providers.map((provider) => (
                    <TabsTrigger
                      key={provider.providerId}
                      value={provider.providerId}
                      className="relative rounded-b-none data-[state=active]:z-10 data-[state=active]:-mb-px data-[state=active]:bg-[var(--color-surface)] data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-1 data-[state=active]:after:bg-[var(--color-surface)] data-[state=active]:after:content-['']"
                    >
                      <span className="inline-flex items-center gap-2">
                        <ProviderBrandLogo
                          providerId={provider.providerId}
                          className="size-4 shrink-0"
                        />
                        <span>{provider.displayName}</span>
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
          </div>

          {showSelectedProviderSummary && selectedProvider ? (
            <div
              className="rounded-lg border px-3 py-2.5"
              style={{
                borderColor: 'var(--color-border-subtle)',
                backgroundColor: 'rgba(255, 255, 255, 0.025)',
              }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {selectedProvider.displayName}
                </span>
                <span
                  className="text-xs"
                  style={{
                    color: getProviderStatusColor(
                      selectedProvider.authenticated
                        ? `使用 ${formatProviderAuthMethodLabelForProvider(
                            selectedProvider.providerId,
                            selectedProvider.authMethod
                          )}`
                        : selectedProvider.statusMessage || '未连接',
                      selectedProvider.authenticated
                    ),
                  }}
                >
                  {selectedProvider.authenticated
                    ? `使用 ${formatProviderAuthMethodLabelForProvider(
                        selectedProvider.providerId,
                        selectedProvider.authMethod
                      )}`
                    : selectedProvider.statusMessage || '未连接'}
                </span>
                {managedRuntimeSummary && !hideConnectionMethodMeta ? (
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {managedRuntimeSummary}
                  </span>
                ) : runtimeSummary ? (
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    运行时：{runtimeSummary}
                  </span>
                ) : null}
              </div>
              {selectedProvider.detailMessage ? (
                <div className="mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {selectedProvider.detailMessage}
                </div>
              ) : null}
              {selectedProvider.externalRuntimeDiagnostics &&
              selectedProvider.externalRuntimeDiagnostics.length > 0 ? (
                <div
                  className="mt-2 space-y-1 text-[11px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {selectedProvider.externalRuntimeDiagnostics.slice(0, 3).map((diagnostic) => (
                    <div key={diagnostic.id}>
                      {diagnostic.label}:{' '}
                      {diagnostic.statusMessage ?? (diagnostic.detected ? '已检测到' : '缺失')}
                      {diagnostic.detailMessage ? ` - ${diagnostic.detailMessage}` : ''}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedProvider ? (
            showRuntimeProviderManagement ? (
              <RuntimeProviderManagementPanel
                runtimeId="opencode"
                open={open}
                projectPath={projectPath}
                disabled={disabled || selectedProviderLoading}
                onProviderChanged={() => onRefreshProvider?.('opencode')}
              />
            ) : (
              <div
                className="space-y-3 rounded-lg border p-3"
                style={{
                  borderColor: 'var(--color-border-subtle)',
                  backgroundColor: 'rgba(255, 255, 255, 0.025)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      连接
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {getConnectionDescription(selectedProvider)}
                    </div>
                    {connectionProgressMessage ? (
                      <div
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px]"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <Loader2 className="size-3 animate-spin" />
                        <span>{connectionProgressMessage}</span>
                      </div>
                    ) : null}
                  </div>
                  {canRequestSubscriptionLogin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={connectionBusy}
                      onClick={() => onRequestLogin?.(selectedProvider.providerId)}
                    >
                      <Link2 className="mr-1 size-3.5" />
                      {selectedProvider.authenticated &&
                      (selectedProvider.authMethod === 'oauth_token' ||
                        selectedProvider.authMethod === 'claude.ai')
                        ? '重新连接 Anthropic'
                        : getProviderConnectLabel(selectedProvider)}
                    </Button>
                  ) : null}
                </div>

                {showConnectionMethodCards ? (
                  <div className="space-y-2">
                    <Label className="text-xs">连接方式</Label>
                    <ConnectionMethodCards
                      options={connectionMethodCardOptions}
                      selectedAuthMode={configuredAuthMode}
                      disabled={connectionBusy}
                      connectionSaving={connectionSaving}
                      pendingConnectionAction={pendingConnectionAction}
                      onSelect={(authMode) => void handleAuthModeChange(authMode)}
                    />
                    {connectionMethodCardsHint ? (
                      <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {connectionMethodCardsHint}
                      </div>
                    ) : null}
                  </div>
                ) : configurableAuthModes.length > 0 && configuredAuthMode ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {selectedProvider.providerId === 'codex' ? '连接方式' : '认证方式'}
                    </Label>
                    <Select
                      value={configuredAuthMode}
                      disabled={connectionBusy}
                      onValueChange={(value) => void handleAuthModeChange(value)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {configurableAuthModes.map((authMode) => (
                          <SelectItem key={authMode} value={authMode}>
                            {formatProviderAuthModeLabelForProvider(
                              selectedProvider.providerId,
                              authMode
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {getAuthModeDescription(selectedProvider.providerId, configuredAuthMode)}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {configuredAuthMode && !hideConnectionMethodMeta ? (
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{
                        color: 'var(--color-text-secondary)',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      模式：
                      {formatProviderAuthModeLabelForProvider(
                        selectedProvider.providerId,
                        configuredAuthMode
                      )}
                    </span>
                  ) : null}
                  {connectionStatusLabel ? (
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{
                        color: selectedProvider.authenticated
                          ? '#86efac'
                          : 'var(--color-text-muted)',
                        backgroundColor: selectedProvider.authenticated
                          ? 'rgba(74, 222, 128, 0.14)'
                          : 'rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      {connectionStatusLabel}
                    </span>
                  ) : null}
                  {selectedProvider.connection?.apiKeyConfigured && !showApiKeySection ? (
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {selectedProvider.connection.apiKeySourceLabel}
                    </span>
                  ) : null}
                </div>

                {selectedProvider.providerId === 'anthropic' ? (
                  <div
                    className="space-y-3 rounded-md border p-3"
                    style={{
                      borderColor: 'rgba(125, 211, 252, 0.18)',
                      background:
                        'linear-gradient(135deg, rgba(125, 211, 252, 0.055), rgba(255, 255, 255, 0.015) 42%, rgba(74, 222, 128, 0.035))',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          Claude Code
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          管理 Claude Code 的账号、模型上下文和启动能力。
                        </div>
                      </div>
                      {anthropicAuthState ? (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            color: anthropicAuthState.color,
                            backgroundColor: anthropicAuthState.backgroundColor,
                          }}
                        >
                          {anthropicAuthState.label}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div
                        className="rounded-lg border px-3 py-2.5"
                        style={{
                          borderColor: 'var(--color-border-subtle)',
                          backgroundColor: 'rgba(255, 255, 255, 0.025)',
                        }}
                      >
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          账号与认证
                        </div>
                        <div
                          className="mt-1 text-sm font-medium"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {anthropicAuthState?.label ?? '状态未知'}
                        </div>
                        <div
                          className="mt-1 text-[11px] leading-relaxed"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          {anthropicAuthState?.detail ?? '等待 Claude Code 状态刷新。'}
                        </div>
                      </div>

                      <div
                        className="rounded-lg border px-3 py-2.5"
                        style={{
                          borderColor: 'var(--color-border-subtle)',
                          backgroundColor: 'rgba(255, 255, 255, 0.025)',
                        }}
                      >
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          默认模型
                        </div>
                        <div
                          className="mt-1 text-sm font-medium"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {anthropicDefaultModelLabel ?? 'Opus'}
                        </div>
                        <div
                          className="mt-1 text-[11px] leading-relaxed"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          默认保留 1M context；启用 200K 限制时会去掉 `[1m]`。1M 模型不支持 effort
                          参数。
                        </div>
                      </div>
                    </div>

                    <div
                      className="rounded-lg border px-3 py-2.5"
                      style={{
                        borderColor: 'var(--color-border-subtle)',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                          模型与能力
                        </div>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {anthropicCatalogStatus}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(anthropicVisibleModelLabels.length > 0
                          ? anthropicVisibleModelLabels.slice(0, 6)
                          : ['Opus', 'Sonnet', 'Haiku']
                        ).map((modelLabel) => (
                          <span
                            key={modelLabel}
                            className="rounded-full border px-2 py-0.5 text-[11px]"
                            style={{
                              borderColor: 'var(--color-border-subtle)',
                              color: 'var(--color-text-secondary)',
                              backgroundColor: 'rgba(255, 255, 255, 0.035)',
                            }}
                          >
                            {modelLabel}
                          </span>
                        ))}
                        {anthropicVisibleModelLabels.length > 6 ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px]"
                            style={{
                              color: 'var(--color-text-muted)',
                              backgroundColor: 'rgba(255, 255, 255, 0.035)',
                            }}
                          >
                            +{anthropicVisibleModelLabels.length - 6}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="mt-2 text-[11px]"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        推理强度：{anthropicReasoningEffortSummary ?? '未报告'}
                      </div>
                    </div>

                    <div
                      className="space-y-2 rounded-lg border px-3 py-2.5"
                      style={{
                        borderColor: 'var(--color-border-subtle)',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div
                            className="text-xs font-medium"
                            style={{ color: 'var(--color-text)' }}
                          >
                            Fast mode 默认值
                          </div>
                          <div
                            className="mt-0.5 text-[11px]"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            当解析后的模型和运行时允许时，新建 Claude Code 团队启动默认应用 Fast
                            mode。
                          </div>
                        </div>
                        {anthropicFastModeSupported ? (
                          <div className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
                            {[
                              { enabled: false, label: '默认关闭' },
                              { enabled: true, label: '优先 Fast' },
                            ].map((option) => (
                              <button
                                key={option.label}
                                type="button"
                                className={`rounded-[3px] px-3 py-1 text-xs font-medium transition-colors ${
                                  anthropicFastModeEnabled === option.enabled
                                    ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm'
                                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                                }`}
                                disabled={connectionBusy || !anthropicFastModeAvailable}
                                onClick={() =>
                                  void handleAnthropicFastModeDefaultChange(option.enabled)
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {anthropicFastModeSupported && anthropicFastModeAvailable
                          ? anthropicFastModeEnabled
                            ? '当解析后的模型支持时，新的 Claude Code 启动会默认请求 Fast mode。'
                            : '除非团队明确启用 Fast mode，新的 Claude Code 启动会保持普通速度。'
                          : anthropicFastModeDisabledReason}
                      </div>
                    </div>

                    {anthropicDiagnosticLines.length > 0 ? (
                      <div
                        className="rounded-md border px-3 py-2 text-[11px]"
                        style={{
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <div className="mb-1 font-medium" style={{ color: 'var(--color-text)' }}>
                          诊断
                        </div>
                        <div className="space-y-0.5">
                          {anthropicDiagnosticLines.map((line) => (
                            <div key={line}>{line}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedProvider.providerId === 'codex' ? (
                  <div
                    className="space-y-3 rounded-md border p-3"
                    style={{ borderColor: 'var(--color-border-subtle)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          ChatGPT 账号
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          管理由本地 Codex app-server 维护、用于订阅原生启动的账号会话。
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={codexActionBusy}
                          onClick={() => void handleCodexAccountRefresh()}
                        >
                          刷新
                        </Button>
                        {codexLoginPending ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={codexActionBusy}
                            onClick={() => void handleCodexCancelLogin()}
                          >
                            取消登录
                          </Button>
                        ) : codexHasActiveChatgptSession ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={codexActionBusy}
                            onClick={() => void handleCodexLogout()}
                          >
                            断开账号
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={codexActionBusy}
                            onClick={() => void handleCodexStartLogin()}
                          >
                            <Link2 className="mr-1 size-3.5" />
                            {codexNeedsReconnect ? '重新连接 ChatGPT' : '连接 ChatGPT'}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className="rounded-full px-2 py-0.5"
                        style={{
                          color: codexHasActiveChatgptSession
                            ? '#86efac'
                            : codexNeedsReconnect
                              ? '#fbbf24'
                              : 'var(--color-text-muted)',
                          backgroundColor: codexHasActiveChatgptSession
                            ? 'rgba(74, 222, 128, 0.14)'
                            : codexNeedsReconnect
                              ? 'rgba(245, 158, 11, 0.14)'
                              : 'rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        {codexHasActiveChatgptSession
                          ? '已连接'
                          : codexNeedsReconnect
                            ? '需要重新连接'
                            : codexLoginPending
                              ? '正在登录'
                              : '未连接'}
                      </span>
                      {codexConnection ? (
                        <span
                          className="rounded-full px-2 py-0.5"
                          style={{
                            color:
                              codexConnection.appServerState === 'healthy'
                                ? '#86efac'
                                : codexConnection.appServerState === 'degraded'
                                  ? '#fbbf24'
                                  : '#fca5a5',
                            backgroundColor:
                              codexConnection.appServerState === 'healthy'
                                ? 'rgba(74, 222, 128, 0.14)'
                                : codexConnection.appServerState === 'degraded'
                                  ? 'rgba(245, 158, 11, 0.12)'
                                  : 'rgba(248, 113, 113, 0.08)',
                          }}
                        >
                          App-server：{codexConnection.appServerState}
                        </span>
                      ) : null}
                      {codexConnection?.managedAccount?.planType ? (
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          计划：{codexConnection.managedAccount.planType}
                        </span>
                      ) : null}
                      {codexConnection?.managedAccount?.email ? (
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          {codexConnection.managedAccount.email}
                        </span>
                      ) : null}
                    </div>

                    {codexAccountPanelHint ? (
                      <div
                        className="rounded-md border px-3 py-2 text-xs"
                        style={{
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {codexAccountPanelHint}
                      </div>
                    ) : null}

                    {codexFastCapabilityHint ? (
                      <div
                        className="rounded-md border px-3 py-2 text-xs"
                        style={{
                          borderColor: codexFastCapability?.selectable
                            ? 'rgba(34, 197, 94, 0.28)'
                            : 'var(--color-border-subtle)',
                          color: codexFastCapability?.selectable
                            ? '#86efac'
                            : 'var(--color-text-secondary)',
                          backgroundColor: codexFastCapability?.selectable
                            ? 'rgba(34, 197, 94, 0.08)'
                            : 'transparent',
                        }}
                      >
                        {codexFastCapabilityHint}
                      </div>
                    ) : null}

                    {codexConnection?.rateLimits ? (
                      <div className="space-y-2">
                        <div
                          className="rounded-md border px-3 py-2 text-xs"
                          style={{
                            borderColor: 'var(--color-border-subtle)',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          这些百分比表示已用额度，不是剩余额度。{' '}
                          {formatCodexUsageExplanation(
                            codexConnection.rateLimits.primary?.usedPercent,
                            codexConnection.rateLimits.primary?.windowDurationMins
                          )}
                          {codexConnection.rateLimits.secondary
                            ? ` 每周限制会单独显示在 ${
                                formatCodexWindowDurationLong(
                                  codexConnection.rateLimits.secondary.windowDurationMins
                                ) ?? 'secondary'
                              } 窗口中。`
                            : ''}
                        </div>

                        <div className="space-y-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <CodexRateLimitWindowCard
                              title="主要窗口"
                              usedLabel={formatCodexUsageWindowLabel(
                                '主要已用',
                                codexConnection.rateLimits.primary?.windowDurationMins
                              )}
                              usedValue={formatCodexUsagePercent(
                                codexConnection.rateLimits.primary?.usedPercent
                              )}
                              remainingValue={
                                formatCodexRemainingPercent(
                                  codexConnection.rateLimits.primary?.usedPercent
                                ) ?? '剩余额度未知'
                              }
                              resetLabel={formatCodexResetWindowLabel(
                                '主要重置',
                                codexConnection.rateLimits.primary?.windowDurationMins
                              )}
                              resetValue={formatCodexResetDateTime(
                                codexConnection.rateLimits.primary?.resetsAt
                              )}
                              accent="primary"
                            />

                            {codexConnection.rateLimits.secondary ? (
                              <CodexRateLimitWindowCard
                                title={
                                  codexConnection.rateLimits.secondary.windowDurationMins === 10_080
                                    ? '每周窗口'
                                    : '次要窗口'
                                }
                                usedLabel={formatCodexUsageWindowLabel(
                                  codexConnection.rateLimits.secondary.windowDurationMins === 10_080
                                    ? '每周已用'
                                    : '次要已用',
                                  codexConnection.rateLimits.secondary.windowDurationMins
                                )}
                                usedValue={formatCodexUsagePercent(
                                  codexConnection.rateLimits.secondary.usedPercent
                                )}
                                remainingValue={
                                  formatCodexRemainingPercent(
                                    codexConnection.rateLimits.secondary.usedPercent
                                  ) ?? '剩余额度未知'
                                }
                                resetLabel={formatCodexResetWindowLabel(
                                  codexConnection.rateLimits.secondary.windowDurationMins === 10_080
                                    ? '每周重置'
                                    : '次要重置',
                                  codexConnection.rateLimits.secondary.windowDurationMins
                                )}
                                resetValue={formatCodexResetDateTime(
                                  codexConnection.rateLimits.secondary.resetsAt
                                )}
                                accent="secondary"
                              />
                            ) : (
                              <div
                                className="rounded-lg border px-4 py-3"
                                style={{
                                  borderColor: 'var(--color-border-subtle)',
                                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                }}
                              >
                                <div
                                  className="text-sm font-medium"
                                  style={{ color: 'var(--color-text)' }}
                                >
                                  每周窗口
                                </div>
                                <div
                                  className="mt-3 text-[11px]"
                                  style={{ color: 'var(--color-text-muted)' }}
                                >
                                  每周已用（1 周）
                                </div>
                                <div
                                  className="mt-1 text-sm font-medium"
                                  style={{ color: 'var(--color-text)' }}
                                >
                                  未报告
                                </div>
                                <div
                                  className="mt-1 text-[11px]"
                                  style={{ color: 'var(--color-text-secondary)' }}
                                >
                                  Codex 未为此账号快照返回次要窗口。
                                </div>
                              </div>
                            )}
                          </div>

                          <div
                            className="rounded-lg border px-4 py-3"
                            style={{
                              borderColor: 'var(--color-border-subtle)',
                              backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            }}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div
                                  className="text-[11px]"
                                  style={{ color: 'var(--color-text-muted)' }}
                                >
                                  Credits
                                </div>
                                <div
                                  className="mt-1 text-sm font-medium"
                                  style={{ color: 'var(--color-text)' }}
                                >
                                  {formatCodexCreditsValue(codexConnection.rateLimits.credits)}
                                </div>
                              </div>
                              <div
                                className="max-w-md text-[11px]"
                                style={{ color: 'var(--color-text-secondary)' }}
                              >
                                Credits 会与基于窗口的订阅用量分开显示；对于计划支持的 ChatGPT
                                会话，它可能不可用。
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {showApiKeySection && apiKeyConfig ? (
                  <div
                    className="space-y-3 rounded-md border p-3"
                    style={{ borderColor: 'var(--color-border-subtle)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex size-8 shrink-0 items-center justify-center rounded-md border"
                        style={{
                          borderColor: 'var(--color-border-subtle)',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <Key className="size-3.5" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          环境变量
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          配置 Claude Code CLI 运行时环境变量（写入 ~/.claude/settings.json）
                        </div>
                      </div>
                    </div>

                    {!claudeEnvLoaded ? (
                      <div
                        className="flex items-center gap-2 text-xs"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <Loader2 className="size-3 animate-spin" /> 加载中...
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(
                          [
                            {
                              key: 'ANTHROPIC_AUTH_TOKEN',
                              label: '认证令牌',
                              desc: 'API 认证 token 或密钥',
                            },
                            {
                              key: 'ANTHROPIC_BASE_URL',
                              label: 'API 地址',
                              desc: '自定义 API 端点 URL',
                            },
                            { key: 'API_TIMEOUT_MS', label: '超时时间', desc: '请求超时（毫秒）' },
                            {
                              key: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
                              label: '禁用遥测',
                              desc: '设为 1 关闭非必要网络请求',
                            },
                            {
                              key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
                              label: 'Haiku 模型',
                              desc: '替代 haiku 模型名称',
                            },
                            {
                              key: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
                              label: 'Sonnet 模型',
                              desc: '替代 sonnet 模型名称',
                            },
                            {
                              key: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
                              label: 'Opus 模型',
                              desc: '替代 opus 模型名称',
                            },
                          ] as const
                        ).map(({ key, label, desc }) => {
                          const isSecret = key === 'ANTHROPIC_AUTH_TOKEN';
                          const visible = claudeEnvVisibleKeys.has(key);
                          return (
                            <div key={key} className="space-y-1">
                              <div className="flex items-baseline justify-between">
                                <Label
                                  className="text-xs"
                                  style={{ color: 'var(--color-text-secondary)' }}
                                >
                                  {label}
                                </Label>
                                <span
                                  className="text-[10px]"
                                  style={{ color: 'var(--color-text-muted)' }}
                                >
                                  {key}
                                </span>
                              </div>
                              <div
                                className="text-[10px]"
                                style={{ color: 'var(--color-text-muted)' }}
                              >
                                {desc}
                              </div>
                              <div className="flex gap-1">
                                <Input
                                  type={isSecret && !visible ? 'password' : 'text'}
                                  value={claudeEnv[key] ?? ''}
                                  onChange={(e) => {
                                    setClaudeEnv((prev) => ({ ...prev, [key]: e.target.value }));
                                    setClaudeEnvSaved(false);
                                  }}
                                  placeholder={key}
                                  className="h-8 text-xs"
                                />
                                {isSecret && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="shrink-0 px-2"
                                    onClick={() => {
                                      setClaudeEnvVisibleKeys((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      });
                                    }}
                                  >
                                    {visible ? (
                                      <EyeOff
                                        className="size-3.5"
                                        style={{ color: 'var(--color-text-muted)' }}
                                      />
                                    ) : (
                                      <Eye
                                        className="size-3.5"
                                        style={{ color: 'var(--color-text-muted)' }}
                                      />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              claudeEnvSaving ||
                              JSON.stringify(claudeEnv) === JSON.stringify(claudeEnvOriginal)
                            }
                            onClick={async () => {
                              setClaudeEnvSaving(true);
                              try {
                                const result = await api.config.updateClaudeEnv(claudeEnv);
                                setClaudeEnvOriginal(result);
                                setClaudeEnvSaved(true);
                                setTimeout(() => setClaudeEnvSaved(false), 2000);
                              } catch {
                                /* ignore */
                              }
                              setClaudeEnvSaving(false);
                            }}
                          >
                            {claudeEnvSaving ? (
                              <Loader2 className="mr-1 size-3.5 animate-spin" />
                            ) : claudeEnvSaved ? (
                              <span style={{ color: '#4ade80' }}>已保存</span>
                            ) : (
                              <Save className="mr-1 size-3.5" />
                            )}
                            {claudeEnvSaving ? '保存中...' : claudeEnvSaved ? '' : '保存'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {connectionError ? (
                  <div
                    className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                    style={{
                      borderColor: 'rgba(248, 113, 113, 0.25)',
                      backgroundColor: 'rgba(248, 113, 113, 0.06)',
                      color: '#fca5a5',
                    }}
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{connectionError}</span>
                  </div>
                ) : null}

                {connectionAlert ? (
                  <div
                    className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                    style={{
                      borderColor: 'rgba(245, 158, 11, 0.25)',
                      backgroundColor: 'rgba(245, 158, 11, 0.06)',
                      color: '#fbbf24',
                    }}
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{connectionAlert}</span>
                  </div>
                ) : null}

                {apiKeysLoading && !selectedApiKey ? (
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    正在加载已保存凭据...
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {selectedProvider && canConfigureRuntime ? (
            <div
              className="space-y-3 rounded-lg border p-3"
              style={{
                borderColor: 'var(--color-border-subtle)',
                backgroundColor: 'rgba(255, 255, 255, 0.025)',
              }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  运行时
                </div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {getRuntimeDescription(selectedProvider)}
                </div>
              </div>

              <ProviderRuntimeBackendSelector
                provider={selectedProvider}
                disabled={runtimeBusy}
                onSelect={(providerId, backendId) =>
                  void handleRuntimeBackendSelect(providerId, backendId)
                }
              />

              {runtimeSaving ? (
                <div
                  className="inline-flex items-center gap-1.5 text-[11px]"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <Loader2 className="size-3 animate-spin" />
                  <span>正在更新运行时...</span>
                </div>
              ) : null}

              {runtimeError ? (
                <div
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                  style={{
                    borderColor: 'rgba(248, 113, 113, 0.25)',
                    backgroundColor: 'rgba(248, 113, 113, 0.06)',
                    color: '#fca5a5',
                  }}
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{runtimeError}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
