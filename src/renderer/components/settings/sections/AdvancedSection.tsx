import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Textarea } from '@renderer/components/ui/textarea';
import { emitOpenHermitEvent, OPEN_HERMIT_EVENTS } from '@renderer/utils/openHermitEvents';
import appIcon from '@renderer/favicon.png';
import { Check, FileEdit, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

interface CcConnectConfigRawDialogProps {
  open: boolean;
  onClose: () => void;
}

const CcConnectConfigRawDialog = ({
  open,
  onClose,
}: CcConnectConfigRawDialogProps): React.JSX.Element | null => {
  const [filePath, setFilePath] = useState('~/.hermit/cc-connect/config.toml');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaved(false);
    api.ccConfig
      .getRaw()
      .then((data) => {
        if (cancelled) return;
        setFilePath(data.path);
        setContent(data.content);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '读取配置文件失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.ccConfig.updateRaw(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [content]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>编辑 配置</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">配置文件：{filePath}</p>
          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-md border border-[var(--color-border)]">
              <Loader2 className="size-5 animate-spin text-[var(--color-text-muted)]" />
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[420px] font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <X className="size-3.5" />
              {error}
            </div>
          )}
          <p className="text-xs text-[var(--color-text-muted)]">
            保存后将直接覆盖 Hermit 管理的 cc-connect config.toml。若修改了端口或
            token，请点击“重启服务”生效。
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            关闭
          </Button>
          <Button onClick={() => void handleSave()} disabled={loading || saving}>
            {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {saved && !saving ? <Check className="mr-1.5 size-3.5 text-emerald-400" /> : null}
            {saved && !saving ? '已保存' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface AdvancedSectionProps {
  readonly saving: boolean;
  readonly onResetToDefaults: () => void;
  readonly onExportConfig: () => void;
  readonly onImportConfig: () => void;
  readonly onOpenInEditor: () => void;
}

export const AdvancedSection = ({}: AdvancedSectionProps): React.JSX.Element => {
  const [version, setVersion] = useState<string>('');
  const [ccConfigOpen, setCcConfigOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getAppVersion().then(setVersion).catch(console.error);
  }, []);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setRestartMsg(null);
    try {
      await api.ccSettings.restart();
      emitOpenHermitEvent(OPEN_HERMIT_EVENTS.runtimeRestarted);
      setRestartMsg('已重启');
    } catch {
      setRestartMsg('重启失败');
    } finally {
      setRestarting(false);
      setTimeout(() => setRestartMsg(null), 3000);
    }
  }, []);

  const handleReload = useCallback(async () => {
    setReloading(true);
    setRestartMsg(null);
    try {
      await api.ccSettings.reload();
      setRestartMsg('配置已重载');
    } catch {
      setRestartMsg('重载失败');
    } finally {
      setReloading(false);
      setTimeout(() => setRestartMsg(null), 3000);
    }
  }, []);

  return (
    <div>
      <SettingsSectionHeader title="服务配置" />
      <div className="flex flex-wrap gap-2 py-2">
        <button
          onClick={() => setCcConfigOpen(true)}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <FileEdit className="size-4" />
          编辑 配置
        </button>
        <button
          onClick={() => void handleReload()}
          disabled={reloading || restarting}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {reloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          重载配置
        </button>
        <button
          onClick={() => void handleRestart()}
          disabled={restarting || reloading}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {restarting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          重启服务
        </button>
      </div>
      {restartMsg && (
        <p
          className="mb-2 text-xs"
          style={{ color: restartMsg.includes('失败') ? '#f87171' : '#4ade80' }}
        >
          {restartMsg}
        </p>
      )}

      <SettingsSectionHeader title="关于" />
      <div className="flex items-start gap-4 py-3">
        <img src={appIcon} alt="应用图标" className="size-10 rounded-lg" />
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Hermit
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Version {version || '...'}
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            模型供应商由后端服务统一管理；团队内部任务由 harness 自主管理。
          </p>
        </div>
      </div>

      <CcConnectConfigRawDialog open={ccConfigOpen} onClose={() => setCcConfigOpen(false)} />
    </div>
  );
};
