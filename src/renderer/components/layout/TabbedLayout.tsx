/**
 * TabbedLayout - Main layout with full-width tab bar, sidebar, and multi-pane content.
 *
 * Layout structure:
 * - TabBarRow (full width): Pane TabBars + action buttons
 * - Sidebar (280px): Task list / date-grouped sessions
 * - Main content: PaneContainer with one or more panes
 *
 * Owns the DndContext for tab drag-and-drop across the entire layout
 * (TabBarRow tabs + PaneContainer split zones).
 */

import { useCallback, useMemo, useState } from 'react';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useKeyboardShortcuts } from '@renderer/hooks/useKeyboardShortcuts';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { CliInstallWarningBanner } from '../common/CliInstallWarningBanner';
import { GlobalProviderStatusHeader } from '../common/GlobalProviderStatusHeader';
import { WorkspaceIndicator } from '../common/WorkspaceIndicator';
import { CommandPalette } from '../search/CommandPalette';
import { GlobalTaskDetailDialog } from '../team/dialogs/GlobalTaskDetailDialog';

import { PaneContainer } from './PaneContainer';
import { Sidebar } from './Sidebar';
import { DragOverlayTab } from './SortableTab';
import { TabBarRow } from './TabBarRow';

import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { Tab } from '@renderer/types/tabs';

export const TabbedLayout = (): React.JSX.Element => {
  useKeyboardShortcuts();

  // --- DnD state (lifted from PaneContainer) ---
  const { panes, activeTabId } = useStore(
    useShallow((s) => ({
      panes: s.paneLayout.panes,
      activeTabId: s.activeTabId,
    }))
  );
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const activeTabType = useMemo(() => {
    if (!activeTabId) return null;
    for (const pane of panes) {
      const tab = pane.tabs.find((item) => item.id === activeTabId);
      if (tab) return tab.type;
    }
    return null;
  }, [activeTabId, panes]);
  const showSidebar = activeTabType === 'team';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const data = active.data.current;

      if (data?.type === 'tab') {
        const sourcePaneId = data.paneId as string;
        const tabId = data.tabId as string;

        const pane = panes.find((p) => p.id === sourcePaneId);
        const tab = pane?.tabs.find((t) => t.id === tabId);
        if (tab) {
          setActiveTab(tab);
        }
      }
    },
    [panes]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveTab(null);

      if (!over || !active.data.current) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      if (activeData.type !== 'tab') return;

      const draggedTabId = activeData.tabId as string;
      const sourcePaneId = activeData.paneId as string;
      const state = useStore.getState();

      // Case 1: Drop on a split-zone (edge of pane) → create new pane
      if (overData?.type === 'split-zone') {
        const targetPaneId = overData.paneId as string;
        const side = overData.side as 'left' | 'right';
        state.moveTabToNewPane(draggedTabId, sourcePaneId, targetPaneId, side);
        return;
      }

      // Case 2: Drop on a tabbar (different pane) → move tab to that pane
      if (overData?.type === 'tabbar') {
        const targetPaneId = overData.paneId as string;
        if (sourcePaneId !== targetPaneId) {
          state.moveTabToPane(draggedTabId, sourcePaneId, targetPaneId);
        }
        return;
      }

      // Case 3: Drop on another sortable tab
      if (overData?.type === 'tab') {
        const overTabId = overData.tabId as string;
        const overPaneId = overData.paneId as string;

        if (sourcePaneId === overPaneId) {
          const pane = panes.find((p) => p.id === sourcePaneId);
          if (!pane) return;

          const fromIndex = pane.tabs.findIndex((t) => t.id === draggedTabId);
          const toIndex = pane.tabs.findIndex((t) => t.id === overTabId);

          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            state.reorderTabInPane(sourcePaneId, fromIndex, toIndex);
          }
        } else {
          const targetPane = panes.find((p) => p.id === overPaneId);
          if (!targetPane) return;

          const insertIndex = targetPane.tabs.findIndex((t) => t.id === overTabId);
          state.moveTabToPane(draggedTabId, sourcePaneId, overPaneId, insertIndex);
        }
      }
    },
    [panes]
  );

  return (
    <div className="flex h-screen flex-col bg-claude-dark-bg text-claude-dark-text">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <TabBarRow />
        <CliInstallWarningBanner />
        <GlobalProviderStatusHeader />
        <div className="flex flex-1 overflow-hidden">
          {/* Command Palette (Cmd+K) */}
          <CommandPalette />

          {/* Content area */}
          <div
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
            style={{ background: 'transparent' }}
          >
            <PaneContainer />
          </div>

          {/* Sidebar - only for team detail tabs */}
          {showSidebar ? <Sidebar /> : null}
        </div>

        {/* Drag overlay - semi-transparent ghost of the dragged tab */}
        <DragOverlay dropAnimation={null}>
          {activeTab ? <DragOverlayTab tab={activeTab} /> : null}
        </DragOverlay>
      </DndContext>
      <GlobalTaskDetailDialog />
      <WorkspaceIndicator />
    </div>
  );
};
