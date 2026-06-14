/**
 * SocietyNodeOverlay —— 纯图谱交互模型下，点开节点弹出的「操作卡片」。
 *
 * 删掉看板后，这是 worker/need 的唯一交互入口（图谱即界面）。引擎 GraphView 在节点
 * 被点击时以 renderOverlay({node, screenPos, onClose}) 调用本组件；引擎自身用 Floating UI
 * （computePosition + flip + shift + offset + autoUpdate）把包裹层定位到节点旁并夹进容器，
 * 故本组件**不再自行定位**——只渲染内容并把动作上抛。（曾用 clampOverlayPosition 自定位，
 * 与引擎 Floating UI 叠加成 double-offset、卡片飞出视口，已移除该冗余逻辑。）
 *
 * 按 node.domainRef.kind 分三种卡片：
 *   - member：worker 名片（声誉/能力/负载）+ 发消息（人→worker，from='user'）。
 *   - task：need 名片（状态/自荐者/执行者）+ 按 NeedStatus 出生命周期动作
 *     （动作集来自纯函数 needLifecycleActions；自荐改由「触发自治」自动完成，反派单）。
 *   - lead：广场 hub，仅展示社会概览，无动作。
 *
 * 本组件只做展示 + 把动作回调上抛；所有状态变更走 SocietyView 传入的 store 动作。
 */
import { useState } from 'react';

import { NEED_STATUS_LABEL, needStatusColor, reputationColor } from './societyViewUtils';
import { needLifecycleActions } from './societyOverlayActions';
import { classifyOpenNeedStall } from '../core/domain/policies/societyPolicies';
import type { GraphDomainRef, GraphNode } from '@claude-teams/agent-graph';
import type { PublishedNeed, WorkerProfile } from '../core/domain/models/society';

export interface SocietyNodeOverlayProps {
  node: GraphNode;
  screenPos: { x: number; y: number };
  onClose: () => void;
  /** workerId → profile 查找（member 卡片用）。 */
  workerById: Map<string, WorkerProfile>;
  /** needId → need 查找（task 卡片用）。 */
  needById: Map<string, PublishedNeed>;
  /** workerId → 显示名（回退到 id）。 */
  workerName: (id: string) => string;
  /** 全社会计数（lead 卡片用）。 */
  societyStats: { workerCount: number; needCount: number };
  // ── 动作回调（均由 SocietyView 绑定到 store 命令）──
  onSelectAssignee: (needId: string) => void;
  onStartNeed: (needId: string) => void;
  onDeliverNeed: (needId: string) => void;
  onAcceptDelivery: (needId: string) => void;
  onTriggerAutonomy: () => void;
  onSendMessage: (toWorkerId: string, text: string) => void;
}

export function SocietyNodeOverlay(props: SocietyNodeOverlayProps): React.JSX.Element {
  const { node, onClose, workerById, needById, societyStats } = props;

  const ref = node.domainRef as GraphDomainRef;

  return (
    <div
      className="pointer-events-auto relative w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-[var(--color-text)] shadow-xl"
      style={{ backgroundColor: 'rgba(10,10,15,0.96)' }}
    >
      <button
        onClick={onClose}
        className="absolute right-2 top-2 text-xs opacity-50 hover:opacity-100"
        title="关闭"
      >
        ✕
      </button>
      {ref.kind === 'member' ? (
        <WorkerCard workerId={ref.memberName} {...props} />
      ) : ref.kind === 'task' ? (
        <NeedCard needId={ref.taskId} {...props} />
      ) : (
        <LeadCard societyStats={societyStats} />
      )}
    </div>
  );
}

// ─── Worker 名片 ─────────────────────────────────────────────────────────────

/**
 * 名片副标题：去掉误导的「复合团队」——所有真实成员同 kind，零信息量。
 * 换成每个成员真正不同的属性：绑定的项目目录（会话实际工作的地方）。把家目录前缀
 * 折成 ~（既给完整相对路径又不泄露用户名）；无 workDir（飞书 / 未绑定）时回退载体 harness。
 */
function workerSubtitle(worker: WorkerProfile): string {
  if (worker.workDir) {
    const tilde = worker.workDir.replace(/^\/(?:Users|home)\/[^/]+/, '~');
    return `📁 ${tilde}`;
  }
  return worker.harness ?? '';
}

function WorkerCard(props: SocietyNodeOverlayProps & { workerId: string }): React.JSX.Element {
  const { workerId, workerById, onSendMessage } = props;
  const worker = workerById.get(workerId);
  const [draft, setDraft] = useState('');

  if (!worker) {
    return (
      <div className="py-2 text-xs opacity-70">
        未找到成员 <span className="font-mono">{workerId}</span>。
      </div>
    );
  }

  const loadPct =
    worker.maxConcurrent > 0
      ? Math.min(100, (worker.activeTaskCount / worker.maxConcurrent) * 100)
      : 0;

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    onSendMessage(worker.workerId, text);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {props.node.avatarUrl ? (
          <img
            src={props.node.avatarUrl}
            alt=""
            className="size-8 rounded-full object-cover"
            style={{ outline: `2px solid ${reputationColor(worker.reputation)}` }}
          />
        ) : (
          <span
            className="flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: reputationColor(worker.reputation) }}
          >
            {worker.name.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{worker.name}</p>
          <p className="truncate text-[10px] opacity-50">{workerSubtitle(worker)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <span
          className="inline-block size-2 rounded-full"
          style={{ backgroundColor: reputationColor(worker.reputation) }}
        />
        <span>声誉 {worker.reputation}</span>
        <span className="opacity-40">·</span>
        <span>
          负载 {worker.activeTaskCount}/{worker.maxConcurrent}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded bg-[var(--color-border)] opacity-60">
        <div className="h-full bg-[var(--color-text)]" style={{ width: `${loadPct}%` }} />
      </div>

      {worker.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {worker.capabilities.map((c) => (
            <span
              key={c.skill}
              className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]"
            >
              {c.skill}
            </span>
          ))}
        </div>
      )}

      {/* 发消息：人 → worker（from='user'） */}
      <div className="mt-1 flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={`给 ${worker.name} 发消息…`}
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md bg-[var(--color-text)] px-2 py-1 text-xs text-[var(--color-surface)] hover:opacity-90 disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}

// ─── Need 名片 ───────────────────────────────────────────────────────────────

function NeedCard(props: SocietyNodeOverlayProps & { needId: string }): React.JSX.Element {
  const {
    needId,
    needById,
    workerById,
    workerName,
    onSelectAssignee,
    onStartNeed,
    onDeliverNeed,
    onAcceptDelivery,
    onTriggerAutonomy,
  } = props;
  const need = needById.get(needId);
  // 开放且无人自荐时，归因「为何卡住」给用户可操作反馈（复用策略层 classifyOpenNeedStall）。
  const stall = need ? classifyOpenNeedStall(need, [...workerById.values()]) : null;

  if (!need) {
    return (
      <div className="py-2 text-xs opacity-70">
        未找到需求 <span className="font-mono">{needId}</span>。
      </div>
    );
  }

  const actions = needLifecycleActions(need.status, need.volunteers.length > 0);
  const color = needStatusColor(need.status);

  const act = (key: string): void => {
    switch (key) {
      case 'selectAssignee':
        onSelectAssignee(need.needId);
        return;
      case 'triggerAutonomy':
        onTriggerAutonomy();
        return;
      case 'startNeed':
        onStartNeed(need.needId);
        return;
      case 'deliverNeed':
        onDeliverNeed(need.needId);
        return;
      case 'acceptDelivery':
        onAcceptDelivery(need.needId);
        return;
      default:
        return;
    }
  };

  const actionLabel: Record<string, string> = {
    selectAssignee: '选派最优',
    triggerAutonomy: '触发自治',
    startNeed: '▶ 开始执行',
    deliverNeed: '✓ 标记交付',
    acceptDelivery: '✓ 通过审核',
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2 pr-5">
        <span className="text-sm font-medium leading-snug">{need.subject}</span>
      </div>
      <span
        className="w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        {NEED_STATUS_LABEL[need.status]}
      </span>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] opacity-70">
        <span>发布者：{workerName(need.postedBy)}</span>
        <span>优先级 {need.priority}</span>
      </div>
      {need.requiredCapabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {need.requiredCapabilities.map((cap) => (
            <span
              key={cap}
              className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]"
            >
              {cap}
            </span>
          ))}
        </div>
      )}
      {need.assignee && (
        <div className="text-[11px] opacity-80">执行者：{workerName(need.assignee)}</div>
      )}
      {need.volunteers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {need.volunteers.map((v) => (
            <span
              key={v.workerId}
              className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]"
              title={`fitScore=${v.fitScore.toFixed(2)}`}
            >
              {workerName(v.workerId)}
            </span>
          ))}
        </div>
      )}

      {/* 停滞归因：open 且无人能自荐时，告诉用户为何不进展（而非沉默卡死）。 */}
      {stall && (
        <div className="rounded border border-[var(--color-border)] bg-[rgba(240,198,116,0.1)] px-2 py-1 text-[11px] leading-snug text-[#f5d68a]">
          {stall === 'no_matching_worker'
            ? '暂无匹配能力的成员——补能力或取消该需求'
            : '匹配的成员均已满载，待其释放并发后自荐'}
        </div>
      )}

      {/* 生命周期动作（去中心化：worker 自主推进，反派单） */}
      {actions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {actions.map((key) => (
            <button
              key={key}
              onClick={() => act(key)}
              className="rounded-md bg-[var(--color-text)] px-2 py-1 text-[11px] text-[var(--color-surface)] hover:opacity-90"
            >
              {actionLabel[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 广场 Hub 概览 ───────────────────────────────────────────────────────────

function LeadCard({
  societyStats,
}: {
  societyStats: { workerCount: number; needCount: number };
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 py-1">
      <p className="text-sm font-semibold">广场 · Agora</p>
      <p className="text-[11px] opacity-60">
        去中心化自治社会。{societyStats.workerCount} 个成员 · {societyStats.needCount} 个在途需求。
      </p>
      <p className="mt-1 text-[10px] opacity-40">
        点击成员节点发消息；点击需求节点推进生命周期；点「触发自治」让 worker 自荐与选派。
      </p>
    </div>
  );
}
