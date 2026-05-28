/**
 * HarnessSection — AI Agent 运行时管理。
 *
 * 管理所有支持的 Agent 运行时（12 种）。
 * 数据来源: cc-connect /api/v1/providers
 */

import { useCallback, useEffect, useState } from 'react';

import { providersApi } from '@renderer/api/providers';
import { ALL_AGENT_TYPES, AGENT_TYPE_LABELS } from '@renderer/components/team/HarnessCards';
import type { CcAgentType } from '@renderer/components/team/HarnessCards';
import { HarnessIcon } from '@renderer/components/team/HarnessSelect';
import { cn } from '@renderer/lib/utils';
import { OPEN_HERMIT_EVENTS } from '@renderer/utils/openHermitEvents';
import { CheckCircle2 } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';
import { CliStatusSection } from './CliStatusSection';

export const HarnessSection = (): React.JSX.Element => {
  const [providerNamesByAgentType, setProviderNamesByAgentType] = useState<
    Map<CcAgentType, string[]>
  >(() => new Map(ALL_AGENT_TYPES.map((type) => [type, []])));
  const [usedAgentTypes, setUsedAgentTypes] = useState<Set<CcAgentType>>(new Set());

  const refresh = useCallback(async () => {
    try {
      // Fetch both providers and projects in parallel
      const [providerRes, projectsRes] = await Promise.allSettled([
        providersApi.list(),
        fetch('/api/v1/projects'),
      ]);

      const providerData =
        providerRes.status === 'fulfilled' ? providerRes.value : { providers: [] };
      const providerCoverage = new Map<CcAgentType, string[]>(
        ALL_AGENT_TYPES.map((type) => [type, []])
      );
      for (const provider of providerData.providers ?? []) {
        for (const agentType of provider.agent_types ?? []) {
          const type = agentType as CcAgentType;
          const list = providerCoverage.get(type);
          if (list && !list.includes(provider.name)) {
            list.push(provider.name);
          }
        }
      }
      setProviderNamesByAgentType(providerCoverage);

      // Extract agent types from projects to mark which types are in use
      const projectAgentTypes = new Set<CcAgentType>();
      if (projectsRes.status === 'fulfilled' && projectsRes.value.ok) {
        try {
          const json = await projectsRes.value.json();
          for (const proj of json.data?.projects ?? []) {
            if (proj.agent_type) projectAgentTypes.add(proj.agent_type);
          }
        } catch {
          /* ignore parse errors */
        }
      }

      setUsedAgentTypes(projectAgentTypes);
    } catch {
      setProviderNamesByAgentType(new Map(ALL_AGENT_TYPES.map((type) => [type, []])));
      setUsedAgentTypes(new Set());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleProvidersChanged = () => {
      void refresh();
    };
    window.addEventListener(OPEN_HERMIT_EVENTS.providersChanged, handleProvidersChanged);
    return () => {
      window.removeEventListener(OPEN_HERMIT_EVENTS.providersChanged, handleProvidersChanged);
    };
  }, [refresh]);

  // Build coverage map: agent type -> list of sources (providers + projects)
  const coveredTypes = new Map<CcAgentType, string[]>();
  for (const type of ALL_AGENT_TYPES) {
    coveredTypes.set(type, [...(providerNamesByAgentType.get(type) ?? [])]);
  }
  // From active projects
  for (const type of usedAgentTypes) {
    const list = coveredTypes.get(type);
    if (list && !list.includes('项目')) list.push('项目');
  }

  return (
    <div className="space-y-6">
      {/* Supported agent types reference */}
      <div>
        <SettingsSectionHeader title="支持的 Agent 类型" />
        <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          hermit 支持的全部 Agent CLI 类型。绿色表示已配置对应 Provider。
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {ALL_AGENT_TYPES.map((type) => {
            const covering = coveredTypes.get(type) ?? [];
            const covered = covering.length > 0;

            return (
              <div
                key={type}
                className="flex items-center gap-2 rounded-lg border px-3 py-2.5"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-surface-raised)',
                }}
              >
                <HarnessIcon type={type} className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-xs font-medium"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {AGENT_TYPE_LABELS[type]}
                  </p>
                  {covered && (
                    <p
                      className="truncate text-[10px]"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {covering.join(', ')}
                    </p>
                  )}
                </div>
                {covered && <CheckCircle2 size={12} className="shrink-0 text-green-500" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Unified harness configuration: runtime + providers */}
      <div>
        <SettingsSectionHeader title="Harness 配置" />
        <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          点击对应 Harness 的“配置”，安装、检查运行时，并配置 settings.json、API
          Key、端点和认证方式。
        </p>

        <CliStatusSection showSectionHeader={false} />
      </div>
    </div>
  );
};
