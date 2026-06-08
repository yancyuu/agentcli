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
    description: '配置 Redis 消息总线实现跨主机团队协作，以及使用数据采集和上报。',
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
      <div className="flex items-center" style={{ backgroundColor: 'var(--color-surface-raised)' }}>
        {visibleTabs.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSectionChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                isActive
                  ? 'font-medium'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
              style={{
                borderLeft: index > 0 ? '1px solid var(--color-border-subtle)' : undefined,
                color: isActive ? '#818cf8' : undefined,
              }}
            >
              <Icon className={`size-3 ${isActive ? 'opacity-90' : 'opacity-40'}`} />
              {tab.label}

              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`What is ${tab.label}?`}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                      }
                    }}
                    className="ml-0.5 inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] opacity-0 transition-opacity hover:opacity-100"
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
