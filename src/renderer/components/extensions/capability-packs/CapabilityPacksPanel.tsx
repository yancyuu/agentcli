import { useEffect, useMemo } from 'react';

import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { AlertTriangle, Loader2, Package, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { LoadedCapabilityPack } from '@shared/types/extensions';

function getPackCounts(pack: LoadedCapabilityPack): string {
  const commands = pack.manifest.capabilities.commands?.length ?? 0;
  const skills = pack.manifest.capabilities.skills?.length ?? 0;
  const workflows = pack.manifest.capabilities.workflows?.length ?? 0;
  return `${commands} commands · ${skills} skills · ${workflows} workflows`;
}

function CapabilityPackCard({ pack, index }: { pack: LoadedCapabilityPack; index: number }) {
  const baseStriped = index % 2 === 0;
  return (
    <div
      className={`relative flex w-full flex-col gap-3 rounded-xl border p-4 text-left transition-all duration-200 ${
        baseStriped ? 'bg-white/[0.045]' : 'bg-white/[0.015]'
      } ${pack.enabled ? 'border-l-2 border-border border-l-emerald-500/35' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="truncate text-sm font-semibold text-text">{pack.manifest.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[11px]">
              namespace: {pack.manifest.namespace}
            </Badge>
            <Badge variant="outline" className="border-border text-text-secondary">
              {pack.source === 'builtin' ? '官方预装' : '团队本地'}
            </Badge>
            <Badge
              variant="outline"
              className={
                pack.enabled
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-border text-text-muted'
              }
            >
              {pack.enabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge variant="outline" className="border-border text-text-secondary">
              v{pack.manifest.version}
            </Badge>
          </div>
        </div>
        <Package className="size-4 shrink-0 text-text-muted" />
      </div>

      <p className="line-clamp-2 min-h-10 text-xs leading-5 text-text-secondary">
        {pack.manifest.description || '团队能力包：commands、skills metadata、workflows metadata。'}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span>{getPackCounts(pack)}</span>
        <span className="max-w-[50%] truncate font-mono text-[11px]" title={pack.packDir}>
          {pack.packDir}
        </span>
      </div>

      {pack.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-300">
          {pack.warnings.join('；')}
        </div>
      ) : null}
    </div>
  );
}

export function CapabilityPacksPanel(): React.JSX.Element {
  const {
    capabilityPacks,
    capabilityPackList,
    capabilityPacksLoading,
    capabilityPacksError,
    fetchCapabilityPacks,
  } = useStore(
    useShallow((state) => ({
      capabilityPacks: state.capabilityPacks,
      capabilityPackList: state.capabilityPackList,
      capabilityPacksLoading: state.capabilityPacksLoading,
      capabilityPacksError: state.capabilityPacksError,
      fetchCapabilityPacks: state.fetchCapabilityPacks,
    }))
  );

  useEffect(() => {
    void fetchCapabilityPacks();
  }, [fetchCapabilityPacks]);

  const warnings = useMemo(
    () => [
      ...(capabilityPackList?.warnings ?? []),
      ...(capabilityPacksError ? [capabilityPacksError] : []),
    ],
    [capabilityPackList?.warnings, capabilityPacksError]
  );

  return (
    <div className="space-y-4">
      <div className="bg-surface-raised/50 rounded-xl border border-indigo-500/20 p-4">
        <div className="flex items-start gap-3">
          <Package className="mt-0.5 size-5 text-indigo-300" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text">团队能力包</h2>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              官方测试过的 Hermit 运维检测包会默认安装到{' '}
              <span className="font-mono">~/.claude/commands/hermit</span>，所有团队可直接运行{' '}
              <span className="font-mono">/hermit:*</span>。 后续插件包按团队启用。
            </p>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">团队可用能力包</h2>
          <p className="text-xs text-text-muted">
            默认官方包 + 团队本地包 · {capabilityPacks.length} packs
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void fetchCapabilityPacks()}
          disabled={capabilityPacksLoading}
        >
          {capabilityPacksLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          刷新
        </Button>
      </div>

      {capabilityPacksLoading && capabilityPacks.length === 0 ? (
        <div className="bg-surface-raised/50 rounded-xl border border-border px-4 py-8 text-center text-sm text-text-muted">
          正在加载能力包...
        </div>
      ) : capabilityPacks.length === 0 ? (
        <div className="bg-surface/60 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
          还没有可用能力包。官方 Hermit 运维包会自动预装。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {capabilityPacks.map((pack, index) => (
            <CapabilityPackCard key={pack.manifest.id} pack={pack} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
