/**
 * AdvancedSection - Advanced settings including config management and about info.
 */

import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import appIcon from '@renderer/favicon.png';
import { Download, FileEdit, RefreshCw, Upload } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

import { CliStatusSection } from './CliStatusSection';
import { ConfigEditorDialog } from './ConfigEditorDialog';

interface AdvancedSectionProps {
  readonly saving: boolean;
  readonly onResetToDefaults: () => void;
  readonly onExportConfig: () => void;
  readonly onImportConfig: () => void;
  readonly onOpenInEditor: () => void;
}

export const AdvancedSection = ({
  saving,
  onResetToDefaults,
  onExportConfig,
  onImportConfig,
  onOpenInEditor,
}: AdvancedSectionProps): React.JSX.Element => {
  const [version, setVersion] = useState<string>('');
  const [configEditorOpen, setConfigEditorOpen] = useState(false);

  useEffect(() => {
    api.getAppVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <div>
      <SettingsSectionHeader title="配置" />
      <div className="flex flex-wrap gap-2 py-2">
        <button
          onClick={() => setConfigEditorOpen(true)}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <FileEdit className="size-4" />
          编辑配置
        </button>
        <button
          onClick={onResetToDefaults}
          disabled={saving}
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5 ${saving ? 'cursor-not-allowed opacity-50' : ''}`}
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <RefreshCw className="size-4" />
          恢复默认值
        </button>
        <button
          onClick={onExportConfig}
          disabled={saving}
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5 ${saving ? 'cursor-not-allowed opacity-50' : ''}`}
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Download className="size-4" />
          导出配置
        </button>
        <button
          onClick={onImportConfig}
          disabled={saving}
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/5 ${saving ? 'cursor-not-allowed opacity-50' : ''}`}
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Upload className="size-4" />
          导入配置
        </button>
      </div>

      <CliStatusSection />

      <SettingsSectionHeader title="关于" />
      <div className="flex items-start gap-4 py-3">
        <img src={appIcon} alt="应用图标" className="size-10 rounded-lg" />
        <div>
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Hermit
            </p>
            <span
              className="rounded-md border px-2.5 py-1 text-xs font-medium"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              Standalone
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Version {version || '...'}
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Assemble AI agent teams that work autonomously in parallel, communicate across teams,
            and manage tasks on a kanban board — with built-in code review, live process monitoring,
            and full tool visibility.
          </p>
        </div>
      </div>

      <ConfigEditorDialog
        open={configEditorOpen}
        onClose={() => setConfigEditorOpen(false)}
        onConfigSaved={() => {
          // Config saved via editor — settings page will pick up changes on next render
        }}
      />
    </div>
  );
};
