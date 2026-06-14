/**
 * DashboardView - Main dashboard shell.
 * Keeps only screen composition and delegates recent-projects logic to the feature slice.
 */

import React from 'react';

import { RecentProjectsSection } from '@features/recent-projects/renderer';
import { useStore } from '@renderer/store';
import { Bot, MessageCircle, Settings, ShieldCheck, TerminalSquare, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const DASHBOARD_BOUNDARIES = [
  {
    title: 'Helm Loop',
    description:
      '只放全局巡检、诊断、复盘、治理和改进提案。常用 workflow 不再铺成卡片，统一在指令台输入 / 查看。',
    badge: '全局控制台',
  },
  {
    title: 'Team Loop',
    description:
      '只负责当前团队消息、runtime 注入、Loop session 和跨团队派单，避免把 Admin workflow 混进普通团队。',
    badge: '团队作用域',
  },
  {
    title: '消息面板',
    description:
      '默认读取最近 50 条动态；需要历史时手动分页加载，每次 50 条，不一次性渲染全部历史。',
    badge: '分页边界',
  },
];

export const DashboardView = (): React.JSX.Element => {
  const { openChatTab, openSettingsTab, openSystemManager, openTeamsTab, teams, teamsLoading } =
    useStore(
      useShallow((state) => ({
        openChatTab: state.openChatTab,
        openSettingsTab: state.openSettingsTab,
        openSystemManager: state.openSystemManager,
        openTeamsTab: state.openTeamsTab,
        teams: state.teams,
        teamsLoading: state.teamsLoading,
      }))
    );
  const showQuickstartGuide = !teamsLoading && teams.length === 0;

  return (
    <div className="relative flex-1 overflow-auto bg-surface">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.1),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl px-8 py-10">
        <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm">
          <div className="grid gap-6 border-b border-border px-6 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium text-indigo-300">
                <TerminalSquare className="size-3.5" />
                Loop Engineering 首页
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-text">
                先从这里进入：全局控制、团队协作、社区入口分开
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
                首页只做总览和入口；Helm Loop 是全局指令台，团队详情里的 Loop
                是当前团队指令台，飞书群独立成扫码页。这样边界更清楚，也不会把常用命令堆在 Admin
                Loop 下方。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openSystemManager()}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-100 transition-colors hover:bg-indigo-500/15"
                >
                  <Bot className="size-4" />
                  打开 Helm Loop
                </button>
                <button
                  type="button"
                  onClick={openTeamsTab}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text"
                >
                  <Users className="size-4" />
                  选择团队
                </button>
                <button
                  type="button"
                  onClick={openChatTab}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text"
                >
                  <MessageCircle className="size-4" />
                  加入飞书群
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-text">工作区状态</div>
                <span className="rounded-full border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-muted">
                  {teamsLoading ? 'loading' : `${teams.length} teams`}
                </span>
              </div>
              <div className="space-y-2 text-xs text-text-muted">
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-overlay px-3 py-2">
                  <span>全局 workflow</span>
                  <span>在 Helm Loop 输入 / 查看</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-overlay px-3 py-2">
                  <span>团队 Loop</span>
                  <span>按团队隔离</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-overlay px-3 py-2">
                  <span>消息历史</span>
                  <span>50 条分页加载</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 px-6 py-5 md:grid-cols-3">
            {DASHBOARD_BOUNDARIES.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-border bg-surface px-4 py-4"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-text">{item.title}</div>
                  <span className="rounded-full border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-muted">
                    {item.badge}
                  </span>
                </div>
                <p className="text-xs leading-5 text-text-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {showQuickstartGuide ? (
          <section className="rounded-xl border border-border bg-surface-raised p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <ShieldCheck className="size-4 text-indigo-300" />
              快速开始（2 步）
            </div>
            <p className="mt-1 text-xs text-text-muted">
              首次使用会看到空白首页。先连接运行时，再创建团队或进入 Helm Loop。
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => openSettingsTab('harness')}
                className="rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-overlay"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-text">
                  <Settings className="size-4" />
                  配置 Harness
                </p>
                <p className="mt-1 text-xs text-text-muted">连接 Claude/Codex/Gemini 等运行时。</p>
              </button>
              <button
                type="button"
                onClick={openTeamsTab}
                className="rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-overlay"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-text">
                  <Users className="size-4" />
                  创建团队并启动
                </p>
                <p className="mt-1 text-xs text-text-muted">设置工作目录后即可开始分发任务。</p>
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                最近项目
              </h2>
              <button
                type="button"
                onClick={() => void openSystemManager()}
                className="text-xs text-text-muted transition-colors hover:text-text"
              >
                Helm Loop →
              </button>
            </div>

            <RecentProjectsSection searchQuery="" />
          </>
        )}
      </div>
    </div>
  );
};
