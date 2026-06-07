/**
 * SettingsView - Main settings panel.
 * Terminal-style layout matching the control console aesthetic.
 */

import { useEffect, useState } from 'react';

import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useSettingsConfig, useSettingsHandlers } from './hooks';
import { AdvancedSection, GeneralSection, HarnessSection } from './sections';
import { TaskBusSection } from './sections/TaskBusSection';
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
      {/* Clean container */}
      <div
        className="mx-auto flex min-h-full max-w-3xl flex-col"
        style={{
          backgroundColor: 'var(--color-surface)',
        }}
      >
        {/* Tabs area */}
        <div
          className="border-b"
          style={{
            borderColor: 'var(--color-border-subtle)',
          }}
        >
          <SettingsTabs activeSection={activeSection} onSectionChange={setActiveSection} />
          {error && (
            <div className="px-4 pb-2 text-[10px] text-red-400">{error}</div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
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
