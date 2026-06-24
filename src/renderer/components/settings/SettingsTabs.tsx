import { useMemo } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { Bot, Info, Settings, Share2, Wrench } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

export type SettingsSection = 'general' | 'harness' | 'task-bus' | 'advanced';

interface SettingsTabsProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

interface TabConfig {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  description: string;
}

const tabs: TabConfig[] = [
  {
    id: 'general',
    label: '通用',
    icon: Settings,
    description: '主题、语言、显示密度和启动行为等核心应用偏好。',
  },
  {
    id: 'harness',
    label: 'Harness',
    icon: Bot,
    description: '管理 AI Agent 运行时的 Provider 配置、API Key、端点和 CLI 安装状态。',
  },
  {
    id: 'task-bus',
    label: '团队总线',
    icon: Share2,
    description: '配置 Redis 消息总线实现跨主机团队协作，以及本地 Usage 数据采集。',
  },
  {
    id: 'advanced',
    label: '高级',
    icon: Wrench,
    description: '导出/导入配置、重置默认值和编辑原始配置。',
  },
];

export const SettingsTabs = ({
  activeSection,
  onSectionChange,
}: Readonly<SettingsTabsProps>): React.JSX.Element => {
  const visibleTabs = useMemo(() => tabs, []);

  return (
    <TooltipProvider>
      <div
        className="inline-flex items-center gap-1 rounded-xl border p-1 shadow-inner shadow-black/10"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSectionChange(tab.id)}
              className={`group relative flex h-8 w-[112px] items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs transition-all duration-200 ${
                isActive
                  ? 'shadow-[var(--color-accent-glow)]/20 font-medium text-[var(--color-accent)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text-secondary)]'
              }`}
              style={
                isActive
                  ? {
                      backgroundColor: 'var(--color-accent-muted)',
                      border: '1px solid var(--color-accent-border)',
                    }
                  : { border: '1px solid transparent' }
              }
            >
              <Icon
                className={`size-3 transition-opacity ${isActive ? 'opacity-95' : 'opacity-45 group-hover:opacity-70'}`}
              />
              {tab.label}

              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-hidden="true"
                    className="ml-0.5 inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-[var(--color-accent)] group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <Info className="size-2.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-xs leading-relaxed">
                  {tab.description}
                </TooltipContent>
              </Tooltip>
            </button>
          );
        })}
      </div>
    </TooltipProvider>
  );
};
