/**
 * CreateTeamDialog — bindProject (项目标识) invariant tests.
 *
 * Regression guard for the false "该项目标识已存在" red-box flicker. The
 * auto-generated ASCII identifier must be collision-free against
 * `existingBindProjects` in EVERY rendered frame, so:
 *   - the "该项目标识已存在" error never appears for an auto value, and
 *   - the create button is never disabled by a phantom collision.
 *
 * The real `bindProjectSlug` generator is exercised (not mocked) so this
 * validates the dialog ↔ generator integration end to end.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateBindProject } from '@renderer/utils/bindProjectSlug';

import { CreateTeamDialog } from '../CreateTeamDialog';

// ── Mutable draft state (hoisted so the mocked hook can read it) ────────────
const draftState = vi.hoisted(() => ({
  teamName: '产品助手',
  cwdMode: 'custom' as 'project' | 'custom',
  customCwd: '/tmp/project',
}));

vi.mock('@renderer/hooks/useCreateTeamDraft', () => ({
  useCreateTeamDraft: () => ({
    teamName: draftState.teamName,
    setTeamName: () => undefined,
    cwdMode: draftState.cwdMode,
    setCwdMode: () => undefined,
    selectedProjectPath: '',
    setSelectedProjectPath: () => undefined,
    customCwd: draftState.customCwd,
    setCustomCwd: () => undefined,
    teamColor: '',
    setTeamColor: () => undefined,
    isLoaded: true,
    clearDraft: () => undefined,
  }),
}));

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ isLight: false }),
}));

vi.mock('@renderer/lib/utils', () => ({
  cn: (...args: Array<unknown>): string =>
    args.filter((a): a is string => typeof a === 'string' && a.length > 0).join(' '),
}));

vi.mock('@renderer/utils/pathNormalize', () => ({
  normalizePath: (p: string) => p,
}));

vi.mock('@shared/utils/ephemeralProjectPath', () => ({
  isEphemeralProjectPath: () => false,
}));

vi.mock('@renderer/api', () => ({
  api: { getProjects: async () => [] },
}));

vi.mock('@renderer/api/providers', () => ({
  providersApi: { list: async () => ({ providers: [] }) },
}));

vi.mock('@renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
  }) =>
    React.createElement(
      'button',
      { type: 'button', onClick, disabled: Boolean(disabled), 'data-testid': 'btn' },
      children
    ),
}));

vi.mock('@renderer/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('@renderer/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement('input', {
      id: props.id as string,
      value: (props.value as string) ?? '',
      onChange: props.onChange as React.ChangeEventHandler<HTMLInputElement>,
      className: props.className as string,
      placeholder: props.placeholder as string,
      'data-testid': props.id === 'team-bind-project' ? 'bind-project' : undefined,
    }),
}));

vi.mock('@renderer/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) =>
    React.createElement('label', null, children),
}));

vi.mock('../../HarnessCards', () => ({
  AGENT_TYPE_LABELS: {} as Record<string, string>,
}));

vi.mock('../../HarnessSelect', () => ({
  HarnessSelect: () => React.createElement('div'),
}));

vi.mock('../ProjectPathSelector', () => ({
  ProjectPathSelector: () => React.createElement('div'),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

interface RenderHandle {
  host: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  rerender: (props: Record<string, unknown>) => Promise<void>;
  unmount: () => Promise<void>;
}

async function renderDialog(props: Record<string, unknown>): Promise<RenderHandle> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  const renderOnce = async (p: Record<string, unknown>) => {
    await act(async () => {
      root.render(React.createElement(CreateTeamDialog, p as never));
      await Promise.resolve();
    });
  };

  await renderOnce(props);

  return {
    host,
    root,
    rerender: (p) => renderOnce(p),
    unmount: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
    },
  };
}

const baseProps = (existingBindProjects: string[]): Record<string, unknown> => ({
  open: true,
  canCreate: true,
  provisioningErrorsByTeam: {},
  clearProvisioningError: () => undefined,
  existingTeamNames: [],
  existingBindProjects,
  provisioningTeamNames: [],
  activeTeams: [],
  onClose: () => undefined,
  onCreate: async () => undefined,
  onOpenTeam: () => undefined,
});

const findCreateButton = (host: HTMLElement): HTMLButtonElement | null => {
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
  return buttons.find((b) => b.textContent?.includes('创建数字员工')) ?? null;
};

const findBindProjectInput = (host: HTMLElement): HTMLInputElement | null =>
  host.querySelector<HTMLInputElement>('[data-testid="bind-project"]');

describe('CreateTeamDialog bindProject invariant', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    draftState.teamName = '产品助手';
    draftState.cwdMode = 'custom';
    draftState.customCwd = '/tmp/project';
  });

  it('auto-generated id is collision-free and never shows "该项目标识已存在"', async () => {
    // Simulate a prior worker that already took the deterministic id for this name.
    const takenId = generateBindProject(draftState.teamName, new Set());
    const expectedNext = generateBindProject(draftState.teamName, new Set([takenId]));

    const { host, unmount } = await renderDialog(baseProps([takenId]));

    const input = findBindProjectInput(host);
    expect(input, 'bind-project input rendered').not.toBeNull();
    expect(input?.value).toBe(expectedNext);
    expect(host.textContent).not.toContain('该项目标识已存在');

    const createBtn = findCreateButton(host);
    expect(createBtn, 'create button rendered').not.toBeNull();
    expect(createBtn?.disabled).toBe(false);

    await unmount();
  });

  it('does NOT flicker "已存在" when the existing list loads after mount', async () => {
    // Teams load asynchronously: dialog first opens with an empty list, then the
    // list populates with an id that collides with the just-generated one. The
    // derived bindProject must jump straight to a free slot in the same render
    // — no transient "已存在" frame is ever produced.
    const { host, rerender, unmount } = await renderDialog(baseProps([]));

    const firstInput = findBindProjectInput(host);
    const firstValue = firstInput?.value ?? '';
    expect(firstValue).toBe(generateBindProject(draftState.teamName, new Set()));
    expect(host.textContent).not.toContain('该项目标识已存在');

    // Now the list populates with exactly the id that was just generated.
    await rerender(baseProps([firstValue]));

    const settledInput = findBindProjectInput(host);
    const expectedAfterLoad = generateBindProject(draftState.teamName, new Set([firstValue]));
    expect(settledInput?.value).toBe(expectedAfterLoad);
    expect(host.textContent).not.toContain('该项目标识已存在');
    expect(findCreateButton(host)?.disabled).toBe(false);

    await unmount();
  });

  it('uses the deterministic id when there is no collision', async () => {
    const { host, unmount } = await renderDialog(baseProps([]));

    const expected = generateBindProject(draftState.teamName, new Set());
    expect(findBindProjectInput(host)?.value).toBe(expected);
    expect(host.textContent).not.toContain('该项目标识已存在');

    await unmount();
  });
});
