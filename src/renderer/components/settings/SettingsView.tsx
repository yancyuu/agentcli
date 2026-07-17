/**
 * SettingsView - Main settings panel.
 * Terminal-style layout matching the control console aesthetic.
 */

import { useEffect, useState } from 'react';

import { useStore } from '@renderer/store';
import { PRODUCT_NAME } from '@shared/constants';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { TaskBusSection } from './sections/TaskBusSection';
import { useSettingsConfig, useSettingsHandlers } from './hooks';
import { AdvancedSection, GeneralSection, HarnessSection } from './sections';
import { type SettingsSection, SettingsTabs } from './SettingsTabs';

export const SettingsView = (): React.JSX.Element | null => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const { pendingSettingsSection, clearPendingSettingsSection } = useStore(
    useShallow((s) => ({
      pendingSettingsSection: s.pendingSettingsSection,
      clearPendingSettingsSection: s.clearPendingSettingsSection,
    }))
  );

  useEffect(() => {
    if (pendingSettingsSection) {
      const nextSection: SettingsSection =
        pendingSettingsSection === 'harness' ||
        pendingSettingsSection === 'task-bus' ||
        pendingSettingsSection === 'advanced'
          ? pendingSettingsSection
          : 'general';
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveSection(nextSection);
      clearPendingSettingsSection();
    }
  }, [pendingSettingsSection, clearPendingSettingsSection]);

  const {
    config,
    safeConfig,
    loading,
    saving,
    error,
    setError,
    setSaving,
    setConfig,
    setOptimisticConfig,
    updateConfig,
  } = useSettingsConfig();

  const handlers = useSettingsHandlers({
    config,
    setSaving,
    setError,
    setConfig,
    setOptimisticConfig,
    updateConfig,
  });

  if (loading) {
    return (
      <div
        className="flex flex-1 items-center justify-center font-mono"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-3" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 className="size-4 animate-spin" />
          <span className="text-xs">loading settings...</span>
        </div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div
        className="flex flex-1 items-center justify-center font-mono"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div className="text-center">
          <p className="mb-4 text-xs text-red-400">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded border px-3 py-1.5 text-xs transition-colors"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
      {/* Control-console settings shell */}
      <div
        className="mx-auto flex min-h-full max-w-4xl flex-col p-6"
        style={{
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <div
          className="bg-[var(--color-surface-raised)]/60 mb-5 overflow-hidden rounded-2xl border shadow-sm shadow-black/10"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <div className="pointer-events-none h-px bg-gradient-to-r from-transparent via-[var(--color-accent-border)] to-transparent" />
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="shadow-[var(--color-accent-glow)]/20 flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-accent-border)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm">
                <SlidersHorizontal className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text)]">设置 Helm Loop</h2>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  配置 {PRODUCT_NAME} 运行时、外观、数字员工渠道和本地控制行为。
                </p>
              </div>
            </div>
            <SettingsTabs activeSection={activeSection} onSectionChange={setActiveSection} />
          </div>
          {error && <div className="px-4 pb-3 text-[10px] text-red-400">{error}</div>}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto duration-200 animate-in fade-in slide-in-from-bottom-1">
          {activeSection === 'general' && (
            <GeneralSection
              safeConfig={safeConfig}
              saving={saving}
              onGeneralToggle={handlers.handleGeneralToggle}
              onThemeChange={handlers.handleThemeChange}
              onLanguageChange={handlers.handleLanguageChange}
            />
          )}

          {activeSection === 'harness' && <HarnessSection />}

          {activeSection === 'task-bus' && <TaskBusSection />}

          {activeSection === 'advanced' && (
            <AdvancedSection
              saving={saving}
              onResetToDefaults={handlers.handleResetToDefaults}
              onExportConfig={handlers.handleExportConfig}
              onImportConfig={handlers.handleImportConfig}
              onOpenInEditor={handlers.handleOpenInEditor}
            />
          )}
        </div>
      </div>
    </div>
  );
};
