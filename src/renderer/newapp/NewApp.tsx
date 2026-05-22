/**
 * Hermit NewApp — cc-connect sidecar 模式的新入口。
 *
 * 布局: 左侧边栏(团队列表 / 插件 / 设置) + 右侧主内容区。
 * 不依赖 hermit 旧 store, 只使用 newapp/api/client.ts。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  Bot,
  ChevronDown,
  ChevronRight,
  Cpu,
  Hash,
  Layers,
  LayoutGrid,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Trash2,
  User,
  Users,
  Zap,
} from 'lucide-react';

import * as api from './api/client';
import type {
  CcProject,
  CcProvider,
  CcSession,
  CcSkillPreset,
  GroupMessage,
  Member,
  Task,
  Team,
} from './api/client';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ');
}

function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((v) => {
        if (!cancelled) {
          setData(v);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Nav types
// ---------------------------------------------------------------------------

type NavItem = { kind: 'team'; slug: string } | { kind: 'plugins' } | { kind: 'settings' };

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------

export function NewApp() {
  const [selected, setSelected] = useState<NavItem>({ kind: 'settings' });
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const { data: teams, loading: teamsLoading, reload: reloadTeams } = useAsync(api.listTeams, []);

  const selectTeam = (slug: string) => setSelected({ kind: 'team', slug });

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Sidebar */}
      <aside
        className="flex w-56 shrink-0 flex-col overflow-hidden"
        style={{
          background: 'var(--color-surface-sidebar)',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-2 px-4 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'var(--color-accent)', opacity: 0.9 }}
          >
            <Zap size={14} color="white" />
          </div>
          <span
            className="text-sm font-semibold tracking-wide"
            style={{ color: 'var(--color-text)' }}
          >
            Hermit
          </span>
        </div>

        {/* Teams section */}
        <div className="flex-1 overflow-y-auto py-2">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span
              className="text-xs font-medium uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              团队
            </span>
            <button
              onClick={() => setShowCreateTeam(true)}
              className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:opacity-80"
              style={{ color: 'var(--color-accent)' }}
              title="新建团队"
            >
              <Plus size={13} />
            </button>
          </div>

          {teamsLoading && (
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <Loader2 size={12} className="animate-spin" />
              <span className="text-xs">加载中…</span>
            </div>
          )}

          {teams?.map((team) => {
            const isActive = selected.kind === 'team' && selected.slug === team.slug;
            return (
              <NavTeamItem
                key={team.slug}
                team={team}
                isActive={isActive}
                onClick={() => selectTeam(team.slug)}
              />
            );
          })}

          {!teamsLoading && (!teams || teams.length === 0) && (
            <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              暂无团队
            </p>
          )}
        </div>

        {/* Bottom nav */}
        <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {(
            [
              { kind: 'plugins' as const, label: '插件', Icon: Layers },
              { kind: 'settings' as const, label: '设置', Icon: Settings },
            ] as const
          ).map(({ kind, label, Icon }) => {
            const isActive = selected.kind === kind;
            return (
              <button
                key={kind}
                onClick={() => setSelected({ kind })}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
                style={{
                  background: isActive ? 'var(--color-surface-raised)' : 'transparent',
                  color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                }}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selected.kind === 'team' && (
          <TeamDetailPage
            slug={selected.slug}
            teams={teams ?? []}
            onDeleted={() => {
              reloadTeams();
              setSelected({ kind: 'settings' });
            }}
          />
        )}
        {selected.kind === 'plugins' && <PluginsPage />}
        {selected.kind === 'settings' && <SettingsPage />}
      </main>

      {/* Create team modal */}
      {showCreateTeam && (
        <CreateTeamModal
          onClose={() => setShowCreateTeam(false)}
          onCreated={(slug) => {
            reloadTeams();
            setSelected({ kind: 'team', slug });
            setShowCreateTeam(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar team item
// ---------------------------------------------------------------------------

const TEAM_COLORS: Record<string, string> = {
  blue: '#6366f1',
  saffron: '#f59e0b',
  turquoise: '#06b6d4',
  brick: '#ef4444',
  indigo: '#818cf8',
  forest: '#22c55e',
  apricot: '#f97316',
  rose: '#ec4899',
};

function NavTeamItem({
  team,
  isActive,
  onClick,
}: {
  team: Team;
  isActive: boolean;
  onClick: () => void;
}) {
  const dot = '#818cf8';
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
      style={{
        background: isActive ? 'var(--color-surface-raised)' : 'transparent',
        color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
      }}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase"
        style={{ background: dot, color: 'white' }}
      >
        {team.displayName?.[0] ?? team.slug[0]}
      </span>
      <span className="min-w-0 flex-1 truncate">{team.displayName || team.slug}</span>
      <span className="shrink-0 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {team.members.length}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Team detail page
// ---------------------------------------------------------------------------

type TeamTab = 'chat' | 'tasks' | 'members' | 'sessions';

function TeamDetailPage({
  slug,
  teams,
  onDeleted,
}: {
  slug: string;
  teams: Team[];
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<TeamTab>('chat');
  const team = teams.find((t) => t.slug === slug);

  const tabs: { id: TeamTab; label: string; Icon: React.ElementType }[] = [
    { id: 'chat', label: '群聊', Icon: MessageSquare },
    { id: 'tasks', label: '任务', Icon: LayoutGrid },
    { id: 'members', label: '成员', Icon: Users },
    { id: 'sessions', label: '会话', Icon: Hash },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-3"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface-raised)',
        }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--color-accent)', opacity: 0.85 }}
        >
          <Users size={15} color="white" />
        </div>
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {team?.displayName || slug}
          </h1>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {team?.members.length ?? 0} 名成员 · {slug}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm(`确认删除团队 "${slug}"？`)) {
                api.stopTeam(slug).catch(console.error);
                onDeleted();
              }
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
          >
            <Trash2 size={11} />
            停用
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors"
            style={{
              color: tab === id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              borderBottom: tab === id ? '2px solid var(--color-accent)' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'chat' && <GroupChatTab slug={slug} members={team?.members ?? []} />}
        {tab === 'tasks' && <TasksTab slug={slug} members={team?.members ?? []} />}
        {tab === 'members' && <MembersTab members={team?.members ?? []} />}
        {tab === 'sessions' && <SessionsTab slug={slug} members={team?.members ?? []} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group chat tab
// ---------------------------------------------------------------------------

function GroupChatTab({ slug, members }: { slug: string; members: Member[] }) {
  const { data: messages, loading, reload } = useAsync(() => api.listGroupMessages(slug), [slug]);
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);
  const [streamChunks, setStreamChunks] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamChunks]);

  // default target to first member
  useEffect(() => {
    if (!target && members.length > 0) setTarget(members[0].name);
  }, [members, target]);

  const handleSend = async () => {
    if (!text.trim() || !target || sending) return;
    setSending(true);
    setStreamChunks([]);
    try {
      await api.groupSend(slug, { target, text: text.trim(), author: 'user' }, (event, data) => {
        if (event === 'chunk') {
          const d = data as { content?: string };
          if (d.content) setStreamChunks((c) => [...c, d.content!]);
        }
      });
      setText('');
      reload();
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
      setStreamChunks([]);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading && (
          <div
            className="flex items-center gap-2 py-4"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Loader2 size={14} className="animate-spin" />
            <span className="text-sm">加载消息中…</span>
          </div>
        )}
        {messages?.map((msg) => (
          <ChatMessage key={msg.id} msg={msg} />
        ))}
        {streamChunks.length > 0 && (
          <div
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
            }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
              ● 回复中…
            </span>
            <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
              {streamChunks.join('')}
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            发送给:
          </span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded px-2 py-1 text-xs"
            style={{
              background: 'var(--color-surface-raised)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          >
            {members.map((m) => (
              <option key={m.slug} value={m.name}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="输入消息 (Enter 发送, Shift+Enter 换行)"
            rows={2}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
            style={{
              background: 'var(--color-surface-raised)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !text.trim() || !target}
            className="flex items-center gap-1.5 self-end rounded-lg px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg }: { msg: GroupMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: isUser ? '#f59e0b' : 'var(--color-accent)', color: 'white' }}
      >
        {msg.from?.[0]?.toUpperCase() ?? '?'}
      </div>
      <div
        className={cn(
          'max-w-[70%] rounded-lg px-3 py-2 text-sm',
          isUser ? 'rounded-tr-none' : 'rounded-tl-none'
        )}
        style={{
          background: isUser ? 'rgba(249,115,22,0.1)' : 'var(--color-surface-raised)',
          border: `1px solid ${isUser ? 'rgba(249,115,22,0.2)' : 'var(--color-border)'}`,
          color: 'var(--color-text)',
        }}
      >
        <p
          className="mb-0.5 text-xs font-medium"
          style={{ color: isUser ? '#f97316' : 'var(--color-accent)' }}
        >
          {msg.from}
          {msg.to && msg.to !== 'all' ? ` → ${msg.to}` : ''}
        </p>
        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        {msg.meta?.error && <p className="mt-1 text-xs text-red-400">⚠ 错误</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks tab (Kanban)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<Task['status'], string> = {
  todo: '待处理',
  doing: '进行中',
  done: '已完成',
};
const STATUS_COLORS: Record<Task['status'], string> = {
  todo: '#64748b',
  doing: '#f59e0b',
  done: '#22c55e',
};

function TasksTab({ slug, members }: { slug: string; members: Member[] }) {
  const { data: tasks, loading, reload } = useAsync(() => api.listTasks(slug), [slug]);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [creating, setCreating] = useState(false);

  const todo = tasks?.filter((t) => t.status === 'todo') ?? [];
  const doing = tasks?.filter((t) => t.status === 'doing') ?? [];
  const done = tasks?.filter((t) => t.status === 'done') ?? [];

  const handleCreate = async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      await api.createTask(slug, { title: newTitle.trim(), assignee: newAssignee || null });
      setNewTitle('');
      reload();
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const moveTask = async (taskId: string, newStatus: Task['status']) => {
    try {
      await api.patchTask(slug, taskId, { status: newStatus });
      reload();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await api.deleteTask(slug, taskId);
      reload();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Create bar */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
          placeholder="新增任务标题…"
          className="flex-1 rounded px-3 py-1.5 text-sm outline-none"
          style={{
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
        <select
          value={newAssignee}
          onChange={(e) => setNewAssignee(e.target.value)}
          className="rounded px-2 py-1.5 text-sm"
          style={{
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          <option value="">不指定</option>
          {members.map((m) => (
            <option key={m.slug} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          disabled={creating || !newTitle.trim()}
          className="flex items-center gap-1 rounded px-3 py-1.5 text-sm disabled:opacity-40"
          style={{ background: 'var(--color-accent)', color: 'white' }}
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          添加
        </button>
      </div>

      {/* Kanban columns */}
      {loading ? (
        <div className="flex items-center gap-2 p-4" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">加载任务…</span>
        </div>
      ) : (
        <div
          className="grid flex-1 grid-cols-3 gap-0 overflow-hidden"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {(['todo', 'doing', 'done'] as Task['status'][]).map((status, i) => {
            const list = [todo, doing, done][i];
            return (
              <div
                key={status}
                className="flex flex-col overflow-hidden"
                style={{ borderRight: i < 2 ? '1px solid var(--color-border)' : undefined }}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: STATUS_COLORS[status] }}
                  />
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {list.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {list.map((task) => (
                    <KanbanCard key={task.id} task={task} onMove={moveTask} onDelete={deleteTask} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KanbanCard({
  task,
  onMove,
  onDelete,
}: {
  task: Task;
  onMove: (id: string, s: Task['status']) => void;
  onDelete: (id: string) => void;
}) {
  const nextStatus: Task['status'] =
    task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo';
  return (
    <div
      className="group rounded-lg p-2.5 text-sm"
      style={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)' }}
    >
      <p className="font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
        {task.title}
      </p>
      {task.assignee && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <User size={10} className="mr-1 inline" />
          {task.assignee}
        </p>
      )}
      <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onMove(task.id, nextStatus)}
          className="rounded px-1.5 py-0.5 text-xs"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          → {STATUS_LABELS[nextStatus]}
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="ml-auto rounded px-1.5 py-0.5 text-xs text-red-400 hover:text-red-300"
          style={{ border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

function MembersTab({ members }: { members: Member[] }) {
  return (
    <div className="space-y-2 overflow-y-auto p-4">
      {members.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          暂无成员
        </p>
      )}
      {members.map((m) => (
        <div
          key={m.slug}
          className="flex items-start gap-3 rounded-lg p-3"
          style={{
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            {m.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {m.name}
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  background: 'rgba(129,140,248,0.1)',
                  color: 'var(--color-accent)',
                  border: '1px solid rgba(129,140,248,0.2)',
                }}
              >
                {m.role}
              </span>
            </div>
            {m.bindProject && (
              <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <Bot size={10} className="mr-1 inline" />
                绑定项目: {m.bindProject}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions tab
// ---------------------------------------------------------------------------

function SessionsTab({ slug, members }: { slug: string; members: Member[] }) {
  const projectNames = [...new Set(members.map((m) => m.bindProject).filter(Boolean))] as string[];
  const [activeProject, setActiveProject] = useState<string>(projectNames[0] ?? '');

  // Update active project when members change
  useEffect(() => {
    if (!activeProject && projectNames.length > 0) setActiveProject(projectNames[0]);
  }, [projectNames, activeProject]);

  const {
    data: sessions,
    loading,
    reload,
  } = useAsync(
    () => (activeProject ? api.cc.listSessions(activeProject) : Promise.resolve([])),
    [activeProject]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Project selector */}
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          cc-connect 项目:
        </span>
        <select
          value={activeProject}
          onChange={(e) => setActiveProject(e.target.value)}
          className="rounded px-2 py-1 text-xs"
          style={{
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          {projectNames.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button onClick={reload} className="ml-auto" style={{ color: 'var(--color-text-muted)' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
            <Loader2 size={13} className="animate-spin" />
            <span className="text-sm">加载会话…</span>
          </div>
        )}
        {!loading && (!sessions || sessions.length === 0) && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            暂无会话
          </p>
        )}
        {sessions?.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: CcSession }) {
  return (
    <div
      className="rounded-lg p-3 text-sm"
      style={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: session.live ? '#22c55e' : '#64748b' }}
        />
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
          {session.chat_name || session.name || session.id.slice(0, 12)}
        </span>
        {session.platform && (
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-xs"
            style={{ background: 'rgba(129,140,248,0.1)', color: 'var(--color-accent)' }}
          >
            {session.platform}
          </span>
        )}
      </div>
      {session.last_message && (
        <p className="mt-1.5 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {session.last_message.content}
        </p>
      )}
      <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {session.history_count ?? 0} 条历史
        {session.user_name && ` · ${session.user_name}`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins page
// ---------------------------------------------------------------------------

function PluginsPage() {
  const { data: skills, loading, error, reload } = useAsync(api.cc.getSkillPresets, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            插件 / Skills
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            来自 cc-connect skill presets
          </p>
        </div>
        <button
          onClick={reload}
          className="flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <RefreshCw size={12} />
          刷新
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (!skills || skills.length === 0) && (
          <EmptyState message="暂无 Skill Presets。请检查 cc-connect 是否已配置 skills。" />
        )}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {skills?.map((s) => (
            <SkillCard key={s.name} skill={s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: CcSkillPreset }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-start gap-2">
        <Zap size={14} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {skill.name}
          </p>
          {skill.description && (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {skill.description}
            </p>
          )}
          {skill.source_url && (
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--color-accent)' }}>
              {skill.source_url}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

type SettingsTab = 'providers' | 'projects' | 'system';

function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('providers');

  const tabs: { id: SettingsTab; label: string; Icon: React.ElementType }[] = [
    { id: 'providers', label: 'Providers', Icon: Cpu },
    { id: 'projects', label: 'Projects', Icon: Bot },
    { id: 'system', label: '系统', Icon: SlidersHorizontal },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex items-center gap-4 px-6 py-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          设置
        </h2>
        <div className="ml-4 flex gap-0">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              style={{
                color: tab === id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                borderBottom:
                  tab === id ? '2px solid var(--color-accent)' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'providers' && <ProvidersPanel />}
        {tab === 'projects' && <ProjectsPanel />}
        {tab === 'system' && <SystemPanel />}
      </div>
    </div>
  );
}

// Providers panel
function ProvidersPanel() {
  const { data: providers, loading, error, reload } = useAsync(api.cc.listProviders, []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<CcProvider>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      await api.cc.createProvider(form as CcProvider);
      setForm({});
      setShowForm(false);
      reload();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`删除 Provider "${name}"?`)) return;
    try {
      await api.cc.deleteProvider(name);
      reload();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          AI Providers
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs"
          style={{ background: 'var(--color-accent)', color: 'white' }}
        >
          <Plus size={11} />
          新增
        </button>
      </div>

      {showForm && (
        <div
          className="space-y-2 rounded-lg p-3"
          style={{
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
          }}
        >
          {[
            { key: 'name', label: '名称', placeholder: 'my-openai', required: true },
            { key: 'api_key', label: 'API Key', placeholder: 'sk-...' },
            { key: 'base_url', label: 'Base URL', placeholder: 'https://api.openai.com/v1' },
            { key: 'model', label: '模型', placeholder: 'gpt-4o' },
          ].map(({ key, label, placeholder, required }) => (
            <div key={key}>
              <label className="mb-0.5 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {label}
                {required && ' *'}
              </label>
              <input
                value={(form as Record<string, string>)[key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full rounded px-2 py-1.5 text-sm outline-none"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !form.name}
              className="rounded px-3 py-1.5 text-xs disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded px-3 py-1.5 text-xs"
              style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {providers?.map((p) => (
        <div
          key={p.name}
          className="group flex items-start gap-3 rounded-lg p-3"
          style={{
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Cpu size={14} style={{ color: 'var(--color-accent)', marginTop: 2 }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {p.name}
            </p>
            {p.model && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                模型: {p.model}
              </p>
            )}
            {p.base_url && (
              <p className="truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {p.base_url}
              </p>
            )}
          </div>
          <button
            onClick={() => handleDelete(p.name)}
            className="text-red-400 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Projects panel
function ProjectsPanel() {
  const { data: projects, loading, error, reload } = useAsync(api.cc.listProjects, []);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          cc-connect Projects
        </h3>
        <button onClick={reload} style={{ color: 'var(--color-text-muted)' }}>
          <RefreshCw size={13} />
        </button>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {projects?.map((p) => (
        <div
          key={p.name}
          className="overflow-hidden rounded-lg"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
            style={{ background: 'var(--color-surface-raised)', color: 'var(--color-text)' }}
            onClick={() => setExpanded(expanded === p.name ? null : p.name)}
          >
            {expanded === p.name ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <Bot size={13} style={{ color: 'var(--color-accent)' }} />
            <span className="flex-1 font-medium">{p.name}</span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {p.agent_type} · {p.sessions_count} 会话
            </span>
          </button>
          {expanded === p.name && (
            <div
              className="space-y-1 px-3 py-2"
              style={{
                borderTop: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Platforms: {p.platforms.join(', ') || '无'}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// System panel
function SystemPanel() {
  const { data: status, loading, error, reload } = useAsync(api.cc.getStatus, []);
  const [acting, setActing] = useState<'reload' | 'restart' | null>(null);

  const doAction = async (action: 'reload' | 'restart') => {
    setActing(action);
    try {
      if (action === 'reload') await api.cc.reload();
      else await api.cc.restart();
      setTimeout(reload, 1500);
    } catch (e) {
      console.error(e);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div
        className="rounded-lg p-4"
        style={{
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            cc-connect 状态
          </h3>
          <button onClick={reload} style={{ color: 'var(--color-text-muted)' }}>
            <RefreshCw size={13} />
          </button>
        </div>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {status && (
          <div className="space-y-1.5">
            {[
              { label: '版本', value: status.version ?? '-' },
              {
                label: '运行时间',
                value:
                  status.uptime_seconds != null ? `${Math.round(status.uptime_seconds)}s` : '-',
              },
              { label: '项目数', value: String(status.projects_count ?? 0) },
              { label: 'Bridge', value: status.bridge?.enabled ? '已启用' : '未启用' },
              { label: '已连接平台', value: status.connected_platforms?.join(', ') || '无' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <span
                  className="w-24 shrink-0 text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {label}
                </span>
                <span style={{ color: 'var(--color-text)' }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => doAction('reload')}
          disabled={acting != null}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm disabled:opacity-40"
          style={{
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          {acting === 'reload' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          重载配置
        </button>
        <button
          onClick={() => doAction('restart')}
          disabled={acting != null}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm disabled:opacity-40"
          style={{
            background: 'rgba(239,68,68,0.1)',
            color: '#f87171',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          {acting === 'restart' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <LogOut size={13} />
          )}
          重启服务
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create team modal
// ---------------------------------------------------------------------------

function CreateTeamModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const { data: projects } = useAsync(api.cc.listProjects, []);
  const [displayName, setDisplayName] = useState('');
  const [members, setMembers] = useState([{ name: '', role: 'worker', bindProject: '' }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addMember = () => setMembers((m) => [...m, { name: '', role: 'worker', bindProject: '' }]);
  const removeMember = (i: number) => setMembers((m) => m.filter((_, idx) => idx !== i));
  const updateMember = (i: number, key: string, value: string) =>
    setMembers((m) => m.map((item, idx) => (idx === i ? { ...item, [key]: value } : item)));

  const handleCreate = async () => {
    if (!displayName.trim()) {
      setErr('请填写团队名称');
      return;
    }
    if (members.some((m) => !m.name.trim() || !m.bindProject)) {
      setErr('每个成员都需要填写名字和绑定项目');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const team = await api.createTeam({ displayName: displayName.trim(), members });
      onCreated(team.slug);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl p-5"
        style={{
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          新建团队
        </h3>

        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
            团队名称 *
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="如：产品研发团队"
            className="w-full rounded px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
            autoFocus
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              成员
            </label>
            <button
              onClick={addMember}
              className="flex items-center gap-1 text-xs"
              style={{ color: 'var(--color-accent)' }}
            >
              <Plus size={11} />
              添加成员
            </button>
          </div>
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={m.name}
                  onChange={(e) => updateMember(i, 'name', e.target.value)}
                  placeholder="成员名"
                  className="flex-1 rounded px-2 py-1.5 text-xs outline-none"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                  }}
                />
                <select
                  value={m.bindProject}
                  onChange={(e) => updateMember(i, 'bindProject', e.target.value)}
                  className="flex-1 rounded px-2 py-1.5 text-xs"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <option value="">选择项目…</option>
                  {projects?.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {members.length > 1 && (
                  <button onClick={() => removeMember(i)} className="text-red-400">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            创建
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex items-center gap-2 py-4" style={{ color: 'var(--color-text-muted)' }}>
      <Loader2 size={14} className="animate-spin" />
      <span className="text-sm">加载中…</span>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="rounded-lg p-3 text-sm"
      style={{
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.2)',
        color: '#f87171',
      }}
    >
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-1.5 text-xs underline">
          重试
        </button>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="py-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
      {message}
    </p>
  );
}
