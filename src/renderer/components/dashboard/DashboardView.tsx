/**
 * DashboardView - Main dashboard shell.
 * Keeps only screen composition and delegates recent-projects logic to the feature slice.
 */

import React from 'react';

import { RecentProjectsSection } from '@features/recent-projects/renderer';
import { useStore } from '@renderer/store';
import { PlugZap, Sparkles, Users, Workflow } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const HIGHLIGHT_HARNESSES = [
  'Claude Code',
  'Cursor',
  'Codex',
  'Gemini',
  'OpenCode',
  'DeepSeek / IM',
];

const HIGHLIGHT_CHANNELS = [
  'Feishu',
  'Slack',
  'Discord',
  'DingTalk',
  'WeCom',
  'Telegram',
  'Webhook / API',
];

export const DashboardView = (): React.JSX.Element => {
  const { openTeamsTab, openSettingsTab, teams, teamsLoading } = useStore(
    useShallow((state) => ({
      openTeamsTab: state.openTeamsTab,
      openSettingsTab: state.openSettingsTab,
      teams: state.teams,
      teamsLoading: state.teamsLoading,
    }))
  );
  const showQuickstartGuide = !teamsLoading && teams.length === 0;

  return (
    <div className="relative flex-1 overflow-auto bg-surface">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-8 py-12">
        <section className="mb-8 overflow-hidden rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-6 py-5">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-text-muted">
              <Sparkles className="size-3.5" />
              一人公司优先
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              Hermit：一人公司的 AI 团队控制台
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              几乎覆盖所有主流
              Harness，支持全渠道接入，把团队编排、消息协作、任务推进和运行状态放在同一个工作台。
            </p>
          </div>
          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Workflow className="size-3.5" />
                Harness 覆盖
              </div>
              <p className="text-xs text-text-muted">几乎所有主流运行时都能接入统一团队控制台。</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {HIGHLIGHT_HARNESSES.map((harness) => (
                  <span
                    key={harness}
                    className="rounded-md border border-border bg-surface-overlay px-2 py-1 text-[11px] text-text-secondary"
                  >
                    {harness}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <PlugZap className="size-3.5" />
                渠道接入
              </div>
              <p className="text-xs text-text-muted">
                统一托管企业 IM、社区渠道和 Webhook/API，消息流和任务流自动对齐。
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {HIGHLIGHT_CHANNELS.map((channel) => (
                  <span
                    key={channel}
                    className="rounded-md border border-border bg-surface-overlay px-2 py-1 text-[11px] text-text-secondary"
                  >
                    {channel}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Users className="size-3.5" />
                一人公司工作流
              </div>
              <p className="text-xs text-text-muted">
                你负责决策，Hermit 负责动态拉起子 agent、分发任务、跟踪执行和回收结果。
              </p>
              <div className="mt-3 rounded-md border border-border bg-surface-overlay px-2.5 py-2 text-[11px] text-text-muted">
                需求输入 → 任务拆解 → 动态执行 → 结果汇总
              </div>
            </div>
          </div>
        </section>

        <div className="mb-8 flex items-center justify-center">
          <button
            onClick={openTeamsTab}
            className="flex shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-raised px-4 py-3 text-sm text-text-secondary transition-all duration-200 hover:border-zinc-500 hover:text-text"
          >
            <Users className="size-4" />
            选择团队
          </button>
        </div>

        {showQuickstartGuide ? (
          <section className="rounded-xl border border-border bg-surface-raised p-5">
            <h2 className="text-sm font-semibold text-text">快速开始（3 步）</h2>
            <p className="mt-1 text-xs text-text-muted">
              首次使用会看到空白首页。按下面步骤配置后，就会出现团队和项目内容。
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => openSettingsTab('harness')}
                className="rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-overlay"
              >
                <p className="text-[11px] font-medium text-text-muted">第 1 步</p>
                <p className="mt-1 text-sm font-medium text-text">配置 Harness</p>
                <p className="mt-1 text-xs text-text-muted">连接 Claude/Codex/Gemini 等运行时</p>
              </button>
              <button
                type="button"
                onClick={() => openSettingsTab('channels')}
                className="rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-overlay"
              >
                <p className="text-[11px] font-medium text-text-muted">第 2 步</p>
                <p className="mt-1 text-sm font-medium text-text">配置渠道</p>
                <p className="mt-1 text-xs text-text-muted">接入飞书/Slack/Telegram/Webhook</p>
              </button>
              <button
                type="button"
                onClick={openTeamsTab}
                className="rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-overlay"
              >
                <p className="text-[11px] font-medium text-text-muted">第 3 步</p>
                <p className="mt-1 text-sm font-medium text-text">创建团队并启动</p>
                <p className="mt-1 text-xs text-text-muted">设置工作目录后即可开始分发任务</p>
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                最近项目
              </h2>
            </div>

            <RecentProjectsSection searchQuery="" />
          </>
        )}
      </div>
    </div>
  );
};
