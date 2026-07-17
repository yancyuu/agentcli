/**
 * Worker Society —— 纯图谱交互视图（图谱即界面）。
 *
 * 这是用户核心诉求的最终形态：删掉看板后，整页就是一张全息 worker 社会图谱，所有交互
 * 都发生在图谱里——
 *   - 创建/全局动作（发布需求、注册成员、触发自治、刷新）→ 浮于图谱顶部的工具条
 *     小弹层（避免把页面切成一堆卡片）。
 *   - 单个节点动作 → 点击 worker/need 节点，引擎弹出 SocietyNodeOverlay（成员→发消息；
 *     需求→按生命周期出操作；自荐改由「触发自治」自动完成，反派单）。
 *   - 声誉=节点大小、关系=发光边、在途任务=沿边流动粒子——信息全由图谱编码，不再有文字列表。
 *
 * 数据来自同源 /api/society/*（createSocietyApi() 默认相对路径）。纯展示 + store 驱动；
 * 节点交互的决策规则走已测的 societyOverlayActions（needLifecycleActions）；弹卡定位由引擎 Floating UI 负责。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { HUMAN_OPERATOR } from '../core/domain/models/society';

import { SocietyGraph } from './SocietyGraph';
import { SocietyNodeOverlay } from './SocietyNodeOverlay';
import { createSocietyStore } from './societyStore';

import type { GraphViewProps } from '@claude-teams/agent-graph';

/** 单例 store hook（renderer 内多处可复用同一份社会状态）。 */
const useSocietyStore = createSocietyStore();

export function SocietyView() {
  const workers = useSocietyStore((s) => s.workers);
  const activeNeeds = useSocietyStore((s) => s.activeNeeds);
  const relationships = useSocietyStore((s) => s.relationships);
  const loading = useSocietyStore((s) => s.loading);
  const error = useSocietyStore((s) => s.error);
  const loadAll = useSocietyStore((s) => s.loadAll);
  const publishNeed = useSocietyStore((s) => s.publishNeed);
  const registerWorker = useSocietyStore((s) => s.registerWorker);
  const selectAssignee = useSocietyStore((s) => s.selectAssignee);
  const startNeed = useSocietyStore((s) => s.startNeed);
  const deliverNeed = useSocietyStore((s) => s.deliverNeed);
  const acceptDelivery = useSocietyStore((s) => s.acceptDelivery);
  const sendMessage = useSocietyStore((s) => s.sendMessage);
  const runAutonomyTick = useSocietyStore((s) => s.runAutonomyTick);
  const autoSelectPending = useSocietyStore((s) => s.autoSelectPending);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 顶栏小弹层开关 + 表单本地状态（创建动作的入口）。
  const [showPublish, setShowPublish] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [pubSubject, setPubSubject] = useState('');
  const [pubCaps, setPubCaps] = useState('');
  const [regName, setRegName] = useState('');
  const [regId, setRegId] = useState('');
  const [regCaps, setRegCaps] = useState('');
  const [tickBusy, setTickBusy] = useState(false);
  const [autonomyNotice, setAutonomyNotice] = useState<string | null>(null);

  // 自治反馈几秒后自动淡出（与 error/loading 同处工具条，避免常驻噪音）。
  useEffect(() => {
    if (!autonomyNotice) return;
    const t = setTimeout(() => setAutonomyNotice(null), 4500);
    return () => clearTimeout(t);
  }, [autonomyNotice]);

  // 节点弹卡要用的查找表 / 概览（任意生命周期操作后 store 刷新即重算，弹卡内容实时同步）。
  const workerById = useMemo(() => new Map(workers.map((w) => [w.workerId, w])), [workers]);
  const needById = useMemo(() => new Map(activeNeeds.map((n) => [n.needId, n])), [activeNeeds]);
  const workerName = useCallback(
    (id: string): string => workerById.get(id)?.name ?? id,
    [workerById]
  );
  const societyStats = useMemo(
    () => ({ workerCount: workers.length, needCount: activeNeeds.length }),
    [workers.length, activeNeeds.length]
  );

  const handlePublish = async (): Promise<void> => {
    if (!pubSubject.trim()) return;
    await publishNeed({
      postedBy: HUMAN_OPERATOR,
      subject: pubSubject,
      requiredCapabilities: pubCaps,
    });
    setPubSubject('');
    setPubCaps('');
    setShowPublish(false);
  };

  const handleRegister = async (): Promise<void> => {
    const name = regName.trim();
    if (!name) return;
    await registerWorker({
      workerId: regId.trim() || name,
      name,
      capabilities: regCaps.trim() || undefined,
    });
    setRegName('');
    setRegId('');
    setRegCaps('');
    setShowRegister(false);
  };

  // 完整自治回路：先让 worker 自发投标，再按适配度择优选派——全程无人工指派。
  const handleTriggerAutonomy = useCallback(async (): Promise<void> => {
    setTickBusy(true);
    setAutonomyNotice(null);
    try {
      const tick = await runAutonomyTick();
      const sel = await autoSelectPending();
      // 失败时 mutate 已把 error 写进 store（工具条红字显示），这里只在成功时给正向反馈。
      if (tick && sel) {
        setAutonomyNotice(`自治完成：${tick.applied} 个自荐 · 选派 ${sel.selected} 个`);
      }
    } finally {
      setTickBusy(false);
    }
  }, [runAutonomyTick, autoSelectPending]);

  // 节点弹卡渲染器：闭合 store 动作 + lookups。引擎在节点被点击时以
  // {node, screenPos, onClose} 调用；SocietyNodeOverlay 按 domainRef.kind 出对应卡片。
  const renderOverlay = useCallback<NonNullable<GraphViewProps['renderOverlay']>>(
    (overlayProps) => (
      <SocietyNodeOverlay
        node={overlayProps.node}
        screenPos={overlayProps.screenPos}
        onClose={overlayProps.onClose}
        workerById={workerById}
        needById={needById}
        workerName={workerName}
        societyStats={societyStats}
        onSelectAssignee={(needId) => void selectAssignee(needId)}
        onStartNeed={(needId) => {
          // 开始执行用 need 上已选派的 assignee（去中心化：谁被选派谁执行）。
          const who = needById.get(needId)?.assignee ?? '';
          if (who) void startNeed(needId, who);
        }}
        onDeliverNeed={(needId) => void deliverNeed(needId, '已交付（请审核）')}
        onAcceptDelivery={(needId) => void acceptDelivery(needId)}
        onTriggerAutonomy={() => void handleTriggerAutonomy()}
        onSendMessage={(toWorker, text) => void sendMessage(HUMAN_OPERATOR, toWorker, text)}
      />
    ),
    [
      workerById,
      needById,
      workerName,
      societyStats,
      selectAssignee,
      startNeed,
      deliverNeed,
      acceptDelivery,
      sendMessage,
      handleTriggerAutonomy,
    ]
  );

  return (
    <div className="relative h-full w-full overflow-hidden text-[var(--color-text)]">
      {/* 图谱全屏铺满整个 pane */}
      <div className="absolute inset-0 flex" style={{ background: '#050510' }}>
        <SocietyGraph
          workers={workers}
          needs={activeNeeds}
          relationships={relationships}
          onAddFirstWorker={() => setShowRegister(true)}
          renderOverlay={renderOverlay}
        />
      </div>

      {/* 浮动工具条：透传拖拽/缩放给图谱，标题与控件可点 */}
      <SocietyToolbar
        workerCount={workers.length}
        needCount={activeNeeds.length}
        relCount={relationships.length}
        error={error}
        loading={loading}
        tickBusy={tickBusy}
        notice={autonomyNotice}
        showPublish={showPublish}
        showRegister={showRegister}
        onTogglePublish={() => {
          setShowPublish((v) => !v);
          setShowRegister(false);
        }}
        onToggleRegister={() => {
          setShowRegister((v) => !v);
          setShowPublish(false);
        }}
        onTriggerAutonomy={handleTriggerAutonomy}
        onRefresh={() => void loadAll()}
      />

      {/* 创建动作的小弹层（锚在工具条右上方区域） */}
      {showPublish && (
        <PublishPopover
          subject={pubSubject}
          caps={pubCaps}
          onSubject={setPubSubject}
          onCaps={setPubCaps}
          onClose={() => setShowPublish(false)}
          onSubmit={handlePublish}
        />
      )}
      {showRegister && (
        <RegisterPopover
          name={regName}
          id={regId}
          caps={regCaps}
          onName={setRegName}
          onId={setRegId}
          onCaps={setRegCaps}
          onClose={() => setShowRegister(false)}
          onSubmit={handleRegister}
        />
      )}
    </div>
  );
}

/**
 * 浮动工具条：外层 pointer-events-none（拖拽/缩放透传给图谱），标题与控件组
 * pointer-events-auto 可点、半透明 rgba(5,5,16,.72)+backdrop-blur 保证浮于亮节点之上可读。
 * 看板已删除——这里只有创建/全局动作，单个节点动作在图谱弹卡里。
 */
function SocietyToolbar(props: {
  workerCount: number;
  needCount: number;
  relCount: number;
  error: string | null;
  loading: boolean;
  tickBusy: boolean;
  notice?: string | null;
  showPublish: boolean;
  showRegister: boolean;
  onTogglePublish: () => void;
  onToggleRegister: () => void;
  onTriggerAutonomy: () => void;
  onRefresh: () => void;
}) {
  const {
    workerCount,
    needCount,
    relCount,
    error,
    loading,
    tickBusy,
    notice,
    showPublish,
    showRegister,
    onTogglePublish,
    onToggleRegister,
    onTriggerAutonomy,
    onRefresh,
  } = props;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3">
      <div
        className="pointer-events-auto rounded-md px-2.5 py-1 backdrop-blur"
        style={{ backgroundColor: 'rgba(5,5,16,0.72)' }}
      >
        <h1 className="text-lg font-semibold">Worker 社会</h1>
        <p className="text-xs opacity-60">
          去中心化自治 · {workerCount} 成员 · {needCount} 个在途任务 · {relCount} 条关系
        </p>
      </div>

      <div
        className="pointer-events-auto flex items-center gap-2 rounded-md p-1.5 backdrop-blur"
        style={{ backgroundColor: 'rgba(5,5,16,0.72)' }}
      >
        {error && <span className="text-xs text-[#dc2626]">{error}</span>}
        {notice && <span className="text-xs text-[#7ee787]">{notice}</span>}
        {loading && <span className="text-xs opacity-60">同步中…</span>}
        <ToolbarButton onClick={onTogglePublish} active={showPublish} title="向广场发布一个需求">
          ＋发布
        </ToolbarButton>
        <ToolbarButton
          onClick={onToggleRegister}
          active={showRegister}
          title="注册一个新 worker（冷启动/演示）"
        >
          ＋注册
        </ToolbarButton>
        <button
          onClick={onTriggerAutonomy}
          disabled={tickBusy}
          className="rounded-md bg-[var(--color-text)] px-3 py-1 text-xs text-[var(--color-surface)] hover:opacity-90 disabled:opacity-50"
          title="让匹配的 worker 主动自荐 open 需求，并按适配度自动选派（去中心化自治，反派单）"
        >
          {tickBusy ? '自治中…' : '触发自治'}
        </button>
        <ToolbarButton onClick={onRefresh} title="重新拉取全部数据">
          刷新
        </ToolbarButton>
      </div>
    </div>
  );
}

/** 工具条次级按钮（描边）；active 时高亮表示弹层已展开。 */
function ToolbarButton(props: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  const { children, onClick, active, title } = props;
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-[var(--color-text)] bg-[var(--color-text)] text-[var(--color-surface)]'
          : 'border-[var(--color-border)] hover:opacity-80'
      }`}
    >
      {children}
    </button>
  );
}

/** 浮层公共容器：锚在右上工具条下方。 */
function PopoverShell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { title, onClose, children } = props;
  return (
    <div
      className="pointer-events-auto absolute right-3 top-16 z-40 w-72 rounded-lg border border-[var(--color-border)] p-3 shadow-xl"
      style={{ backgroundColor: 'rgba(10,10,15,0.97)' }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold opacity-80">{title}</h3>
        <button onClick={onClose} className="text-xs opacity-50 hover:opacity-100" title="关闭">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

/** 发布需求小弹层（postedBy 固定 'user'）。 */
function PublishPopover(props: {
  subject: string;
  caps: string;
  onSubject: (v: string) => void;
  onCaps: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { subject, caps, onSubject, onCaps, onClose, onSubmit } = props;
  return (
    <PopoverShell title="发布需求" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={subject}
          onChange={(e) => onSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder="需求主题…"
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
        <input
          value={caps}
          onChange={(e) => onCaps(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder="所需能力 (逗号分隔，如 react,css)"
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
        <button
          onClick={onSubmit}
          disabled={!subject.trim()}
          className="rounded-md bg-[var(--color-text)] px-3 py-1 text-xs text-[var(--color-surface)] hover:opacity-90 disabled:opacity-40"
        >
          发布
        </button>
      </div>
    </PopoverShell>
  );
}

/** 注册成员小弹层。 */
function RegisterPopover(props: {
  name: string;
  id: string;
  caps: string;
  onName: (v: string) => void;
  onId: (v: string) => void;
  onCaps: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { name, id, caps, onName, onId, onCaps, onClose, onSubmit } = props;
  return (
    <PopoverShell title="注册成员" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="名称（必填）"
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none"
          />
          <input
            value={id}
            onChange={(e) => onId(e.target.value)}
            placeholder="工号 (可选)"
            className="w-24 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none"
          />
        </div>
        <input
          value={caps}
          onChange={(e) => onCaps(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder="能力 (逗号分隔，如 code,review)"
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
        <button
          onClick={onSubmit}
          disabled={!name.trim()}
          className="rounded-md bg-[var(--color-text)] px-3 py-1 text-xs text-[var(--color-surface)] hover:opacity-90 disabled:opacity-40"
        >
          注册
        </button>
      </div>
    </PopoverShell>
  );
}
