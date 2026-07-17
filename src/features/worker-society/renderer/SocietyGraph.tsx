/**
 * SocietyGraph — mounts the reusable @claude-teams/agent-graph engine for the
 * worker society, replacing the old hand-rolled SVG canvas.
 *
 * Same input contract as the former AgentCanvas (workers / active needs /
 * relationships), but projected through projectSocietyGraph into the engine's
 * GraphDataPort and rendered with its 1:1 cyan/space holographic theme
 * (hexagon nodes, tapered glowing edges, flowing particles, bloom, hex grid +
 * star field, zoom/pan). Worker nodes carry hermit's own participant-avatars
 * (stable per workerId) so the society stays visually on-brand.
 *
 * A Fullscreen button (wired via onRequestFullscreen) pops the graph into a
 * full-viewport overlay, so the graph is never cramped.
 *
 * Pure projection (projectSocietyGraph) is unit-tested separately; this file
 * is a thin React mount with no logic of its own.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { GraphView } from '@claude-teams/agent-graph';
import { PARTICIPANT_AVATAR_URLS } from '@renderer/utils/memberAvatarCatalog';

import { projectSocietyGraph } from './societyGraphAdapter';
import { type SocietyLabelNode, SocietyNodeLabels } from './SocietyNodeLabels';
import { pickAvatarUrl } from './societyViewUtils';

import type { PublishedNeed, Relationship, WorkerProfile } from '../core/domain/models/society';
import type { GraphViewProps } from '@claude-teams/agent-graph';

export interface SocietyGraphProps {
  workers: WorkerProfile[];
  /** Active needs (open/assigned/in_progress/delivered). */
  needs: PublishedNeed[];
  relationships: Relationship[];
  /** Called when the user wants to bootstrap the empty society (add the first worker). */
  onAddFirstWorker?: () => void;
  /**
   * 自定义节点弹卡渲染器（透传给引擎 GraphView.renderOverlay）。点开 worker/need 节点时
   * 引擎以 {node, screenPos, onClose} 调用之；返回的卡片即「纯图谱」的唯一交互入口。
   * 省略则用引擎内置 GraphOverlay。类型直接取自 GraphViewProps 以保证契约一致。
   */
  renderOverlay?: GraphViewProps['renderOverlay'];
}

const GRAPH_CONFIG = {
  showHexGrid: true,
  showStarField: true,
  bloomIntensity: 0.6,
  animationEnabled: true,
} as const;

export function SocietyGraph({
  workers,
  needs,
  relationships,
  onAddFirstWorker,
  renderOverlay,
}: Readonly<SocietyGraphProps>): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState(false);

  const graphData = useMemo(
    () =>
      projectSocietyGraph(
        { workers, needs, relationships },
        { resolveAvatarUrl: (id) => pickAvatarUrl(id, PARTICIPANT_AVATAR_URLS) }
      ),
    [workers, needs, relationships]
  );

  // 引擎 canvas 标签字号固定、在 fit 缩放下对人类不可读 → 改用 HTML 标签层渲染。
  // 给引擎喂 label='' 抑制 canvas 文本；HTML 层（SocietyNodeLabels）用同一份 graphData
  // 的标签复用引擎 getNodeWorldPosition/worldToScreen 定位（不重算坐标）。两份视图同源。
  const engineData = useMemo(
    () => ({ ...graphData, nodes: graphData.nodes.map((n) => ({ ...n, label: '' })) }),
    [graphData]
  );
  const labelNodes = useMemo<SocietyLabelNode[]>(
    () => graphData.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, state: n.state })),
    [graphData]
  );
  const renderHud = useCallback<NonNullable<GraphViewProps['renderHud']>>(
    (hud) => (
      <SocietyNodeLabels
        nodes={labelNodes}
        getNodeWorldPosition={hud.getNodeWorldPosition}
        worldToScreen={hud.worldToScreen}
        getViewportSize={hud.getViewportSize}
        focusNodeIds={hud.focusNodeIds}
      />
    ),
    [labelNodes]
  );

  // An empty society (no agora hub, nothing to render) shows a guiding overlay
  // instead of a bare starfield void, so a first-run user is never stranded.
  const isEmpty = graphData.nodes.length === 0;

  // Lock background scroll while the fullscreen overlay is open.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  return (
    <>
      <div
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-[var(--color-border)]"
        style={{ background: '#050510' }}
      >
        {fullscreen ? null : (
          <GraphView
            data={engineData}
            className="society-graph-view size-full"
            isSurfaceActive
            onRequestFullscreen={() => setFullscreen(true)}
            config={GRAPH_CONFIG}
            renderOverlay={renderOverlay}
            renderHud={renderHud}
          />
        )}

        {isEmpty && !fullscreen && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="bg-[var(--color-surface-raised)]/95 pointer-events-auto mx-4 max-w-xs rounded-lg border border-[var(--color-border)] p-4 text-center">
              <p className="text-sm font-semibold opacity-80">社会尚未启动</p>
              <p className="mt-1 text-xs leading-relaxed opacity-60">
                还没有成员与需求。添加第一个 worker，或触发自治让真实团队流入广场。
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {onAddFirstWorker ? (
                  <button
                    onClick={onAddFirstWorker}
                    className="rounded-md bg-[var(--color-text)] px-3 py-1 text-xs text-[var(--color-surface)] hover:opacity-90"
                  >
                    去添加成员 →
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {fullscreen
        ? createPortal(
            <div className="fixed inset-0 z-[1000]" style={{ background: '#050510' }}>
              <GraphView
                data={engineData}
                className="society-graph-view size-full"
                isSurfaceActive
                onRequestClose={() => setFullscreen(false)}
                config={GRAPH_CONFIG}
                renderOverlay={renderOverlay}
                renderHud={renderHud}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
