/**
 * SocietyNodeLabels — 常驻可读的 HTML 节点标签层，叠在 society 图谱 canvas 之上。
 *
 * 为什么需要它：引擎（packages/agent-graph）把节点标签画在 <canvas> 上，字号固定且在
 * fit 缩放下对人类不可读（「纯图谱」若读不出谁是谁即失能）。SocietyGraph 因此抑制掉
 * canvas 标签、改由本层用可读 HTML 渲染。定位完全复用引擎自己的 getNodeWorldPosition
 * + worldToScreen（不重复算节点坐标 = 动态规划、复用而非重写）。
 *
 * 单个 requestAnimationFrame 循环每帧重定位 chip，使标签跟随相机平移/缩放与 d3-force
 * 模拟。pointer-events-none 让点击穿透回 canvas 节点（选中弹卡链路不变）。超出视口的
 * chip 隐藏（性能 + 不遮挡）。
 */
import { useEffect, useRef } from 'react';

import type { GraphNode, GraphNodeState } from '@claude-teams/agent-graph';

export interface SocietyLabelNode {
  id: string;
  label: string;
  kind: GraphNode['kind'];
  state: GraphNodeState;
}

export interface SocietyNodeLabelsProps {
  nodes: SocietyLabelNode[];
  getNodeWorldPosition: (nodeId: string) => { x: number; y: number } | null;
  worldToScreen: (x: number, y: number) => { x: number; y: number };
  getViewportSize: () => { width: number; height: number };
  /**
   * 引擎焦点集合（选中某节点时 = 该节点 + 其邻接任务/关系成员）。提供时，焦点内标签全亮、
   * 其余压低，让被选簇独占注意力；为 null（未选中）时走分层 ambient（见 OPACITY）。复用引擎
   * 算好的焦点，不在此处重算邻接（动态规划、复用而非重写）。
   */
  focusNodeIds?: ReadonlySet<string> | null;
}

/** chip 落在节点图标正下方（对齐引擎 canvas 标签槽位）。 */
const LABEL_OFFSET_Y = 24;

/**
 * 按 kind/state 给标签上色（worker 青、task 按生命周期）。只给文本上色，不再加描边——
 * 去掉每个节点上的硬边框盒，缓解「满图突兀标签」的拥挤感（底色 + 投影保证可读，见下方 className/style）。
 */
function chipClass(kind: GraphNode['kind'], state: GraphNodeState): string {
  if (kind === 'lead') return 'text-[#9fd8ff]';
  if (kind === 'task') {
    if (state === 'active') return 'text-[#9eeaad]'; // in_progress
    if (state === 'complete') return 'text-[#c4a7fa]'; // delivered
    return 'text-[#f5d68a]'; // waiting（open/assigned）
  }
  return 'text-[#c9d8ff]'; // member（worker）
}

/**
 * 标签不透明度分层 —— 解决「满图字符串、没有重点」：把视觉重量交给节点本身（发光六边形 /
 * 头像 / 边），文字标签按重要性退到背景，选中时整簇高亮。
 *   - lead（广场）：恒亮，作为唯一视觉锚点。
 *   - 进行中（state==='active'）：第二焦点，半亮。
 *   - 其余（idle / waiting / complete）：ambient，在场但不抢戏。
 * focusNodeIds 非空（选中某节点）时，焦点内全亮、其余压到 dimmed，让被选簇独占注意力。
 */
const OPACITY = {
  lead: 1,
  active: 0.82,
  ambient: 0.34,
  dimmed: 0.2,
} as const;

function labelOpacity(node: SocietyLabelNode, focus: ReadonlySet<string> | null): number {
  if (focus) return focus.has(node.id) ? 1 : OPACITY.dimmed;
  if (node.kind === 'lead') return OPACITY.lead;
  if (node.state === 'active') return OPACITY.active;
  return OPACITY.ambient;
}

export function SocietyNodeLabels({
  nodes,
  getNodeWorldPosition,
  worldToScreen,
  getViewportSize,
  focusNodeIds,
}: SocietyNodeLabelsProps): React.JSX.Element {
  // nodeId → chip DOM，单 RAF 批量更新 transform，避免每帧 React 重渲染。
  const chipRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  // 焦点集合随渲染更新到 ref，RAF 直接读最新值——选中切换不必重启循环。
  const focusRef = useRef<ReadonlySet<string> | null>(null);
  focusRef.current = focusNodeIds ?? null;

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const vp = getViewportSize();
      const map = chipRefs.current;
      for (const node of nodes) {
        const el = map.get(node.id);
        if (!el) continue;
        const world = getNodeWorldPosition(node.id);
        if (!world) {
          el.style.visibility = 'hidden';
          continue;
        }
        const s = worldToScreen(world.x, world.y);
        const offX = s.x < -100 || s.x > vp.width + 100;
        const offY = s.y < -20 || s.y > vp.height + 60;
        if (offX || offY) {
          el.style.visibility = 'hidden';
        } else {
          el.style.visibility = 'visible';
          el.style.opacity = String(labelOpacity(node, focusRef.current));
          el.style.transform = `translate(-50%, 0) translate(${s.x}px, ${s.y + LABEL_OFFSET_Y}px)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodes, getNodeWorldPosition, worldToScreen, getViewportSize]);

  return (
    <>
      {nodes.map((node) => (
        <span
          key={node.id}
          ref={(el) => {
            if (el) chipRefs.current.set(node.id, el);
            else chipRefs.current.delete(node.id);
          }}
          className={`pointer-events-none absolute left-0 top-0 max-w-[150px] truncate rounded bg-[rgba(5,5,16,0.5)] px-1.5 py-0.5 text-[11px] font-medium leading-tight ${chipClass(
            node.kind,
            node.state
          )}`}
          style={{ visibility: 'hidden', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
        >
          {node.label}
        </span>
      ))}
    </>
  );
}
