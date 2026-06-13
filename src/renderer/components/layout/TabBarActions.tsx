/**
 * TabBarActions - Right-side action buttons for the tab bar row.
 * Extracted from TabBar to render once (not per-pane).
 * Reads focused pane data from root store selectors (auto-synced via syncRootState).
 */

import { useMemo, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useStore } from '@renderer/store';
import { Bot, ListTodo, MessageCircle, PanelRight, Puzzle, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { MoreMenu } from './MoreMenu';

export const TabBarActions = (): React.JSX.Element => {
  const {
    unreadCount,
    openChatTab,
    openExtensionsTab,
    openTasksTab,
    openTeamsTab,
    openSocietyTab,
    activeTabId,
    openTabs,
    tabSessionData,
    sidebarCollapsed,
    toggleSidebar,
  } = useStore(
    useShallow((s) => ({
      unreadCount: s.unreadCount,
      openChatTab: s.openChatTab,
      openExtensionsTab: s.openExtensionsTab,
      openTasksTab: s.openTasksTab,
      openTeamsTab: s.openTeamsTab,
      openSocietyTab: s.openSocietyTab,
      activeTabId: s.activeTabId,
      openTabs: s.openTabs,
      tabSessionData: s.tabSessionData,
      sidebarCollapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
    }))
  );

  // Hover states for buttons
  const [teamsHover, setTeamsHover] = useState(false);
  const [extensionsHover, setExtensionsHover] = useState(false);
  const [tasksHover, setTasksHover] = useState(false);
  const [chatHover, setChatHover] = useState(false);
  const [societyHover, setSocietyHover] = useState(false);
  const [expandHover, setExpandHover] = useState(false);

  // Derive active tab and session detail for MoreMenu
  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId),
    [openTabs, activeTabId]
  );
  const activeTabSessionDetail = activeTabId
    ? (tabSessionData[activeTabId]?.sessionDetail ?? null)
    : null;

  return (
    <div
      className="ml-2 flex shrink-0 items-center gap-1"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Primary app areas */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openTeamsTab}
            onMouseEnter={() => setTeamsHover(true)}
            onMouseLeave={() => setTeamsHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: teamsHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: teamsHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="团队"
          >
            <Users className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">团队</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openExtensionsTab}
            onMouseEnter={() => setExtensionsHover(true)}
            onMouseLeave={() => setExtensionsHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: extensionsHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: extensionsHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="扩展"
          >
            <Puzzle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">扩展</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openTasksTab}
            onMouseEnter={() => setTasksHover(true)}
            onMouseLeave={() => setTasksHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: tasksHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: tasksHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="任务"
          >
            <ListTodo className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">任务</TooltipContent>
      </Tooltip>

      {/* Worker 社会 —— 去中心化自治 agent 互动平台 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openSocietyTab}
            onMouseEnter={() => setSocietyHover(true)}
            onMouseLeave={() => setSocietyHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: societyHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: societyHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="Worker 社会"
          >
            <Bot className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Worker 社会</TooltipContent>
      </Tooltip>

      {/* Feishu group QR */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openChatTab}
            onMouseEnter={() => setChatHover(true)}
            onMouseLeave={() => setChatHover(false)}
            className="rounded-md p-2 transition-colors"
            style={{
              color: chatHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: chatHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            aria-label="加入飞书群"
          >
            <MessageCircle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">加入飞书群</TooltipContent>
      </Tooltip>

      {/* More menu (Notifications, Settings, Search, Export, Analyze) */}
      <MoreMenu
        activeTab={activeTab}
        activeTabSessionDetail={activeTabSessionDetail}
        activeTabId={activeTabId}
        unreadCount={unreadCount}
      />

      {/* Expand sidebar — rightmost, only when collapsed */}
      {sidebarCollapsed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              onMouseEnter={() => setExpandHover(true)}
              onMouseLeave={() => setExpandHover(false)}
              className="mr-1 rounded-md p-2 transition-colors"
              style={{
                color: expandHover ? 'var(--color-text)' : 'var(--color-text-muted)',
                backgroundColor: expandHover ? 'var(--color-surface-raised)' : 'transparent',
              }}
              aria-label="展开侧边栏"
            >
              <PanelRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">展开侧边栏</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
