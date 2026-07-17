/**
 * DashboardView - Main dashboard shell.
 * Keeps only screen composition and delegates recent-projects logic to the feature slice.
 */

import React from 'react';

import { RecentProjectsSection } from '@features/recent-projects/renderer';
import { useStore } from '@renderer/store';
import { PRODUCT_NAME } from '@shared/constants';
import { Bot, MessageCircle, Settings, ShieldCheck, TerminalSquare, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const DASHBOARD_BOUNDARIES = [
  {
    title: '本地优先控制面',
    description: '把项目、运行时、工作流和执行记录收束在本机；你掌握代码、上下文和团队协作边界。',
    badge: 'Local-first',
  },
  {
    title: 'AI Workforce',
    description:
      '以团队为单位组织数字员工，对接飞书等渠道、进入真实业务场景：接需求、跟进任务、审阅交付，在业务里持续提供服务。',
    badge: 'Agent Teams',
  },
  {
    title: 'Loop Engineering',
    description: '把诊断、巡检、复盘和改进提案变成可重复运行的循环，让系统自己维护系统。',
    badge: 'Self-improving',
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
          <div className="grid gap-6 border-b border-border p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                <TerminalSquare className="size-3.5" />
                {PRODUCT_NAME} Command Center
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-text">
                你的本地 AI 员工操作系统
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
                {PRODUCT_NAME} 把 Claude Code、团队协作和 Loop
                工作流收束到一个本地优先的控制面。你的数字员工对接飞书等外部渠道、深入真实业务场景，按团队分工自主跟进任务、审阅结果——不是开一个聊天窗口，而是养一支能接业务、持续交付服务的
                AI 团队。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openSystemManager()}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-500/15 dark:text-indigo-100"
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
                  进入团队
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

            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-text">工作区状态</div>
                <span className="rounded-full border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-muted">
                  {teamsLoading ? '加载中' : `${teams.length} 个团队`}
                </span>
              </div>
              <div className="space-y-2 text-xs text-text-muted">
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-overlay px-3 py-2">
                  <span>本地团队</span>
                  <span>{teamsLoading ? '同步中' : `${teams.length} 支`}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-overlay px-3 py-2">
                  <span>运行入口</span>
                  <span>Team / Helm / Channel</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-overlay px-3 py-2">
                  <span>数据边界</span>
                  <span>Local-first by default</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 px-6 py-5 md:grid-cols-3">
            {DASHBOARD_BOUNDARIES.map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-surface p-4">
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
              <ShieldCheck className="size-4 text-indigo-600 dark:text-indigo-300" />
              快速开始（2 步）
            </div>
            <p className="mt-1 text-xs text-text-muted">
              首次使用会看到空白首页。先连接运行时，再创建团队或进入 Helm Loop。
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => openSettingsTab('harness')}
                className="rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-overlay"
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
                className="rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-overlay"
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
                最近打开的项目
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
