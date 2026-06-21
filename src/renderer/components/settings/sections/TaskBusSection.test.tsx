import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskBusConfig } from '@shared/types/team';

import { TaskBusSection } from './TaskBusSection';

interface TelemetryProjectFixture {
  cwd: string;
  displayName: string;
  teamSlug?: string;
  bindProject?: string;
  deletedAt?: string;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
}

function telemetryProjects(projectCount: number): TelemetryProjectFixture[] {
  return Array.from({ length: projectCount }, (_, index) => ({
    cwd: `/tmp/throughput-entry-${index + 1}`,
    displayName: index === 10 ? 'zz-last-project' : `throughput-entry-${index + 1}`,
    sessions: 1,
    messages: projectCount - index,
    tokensIn: 10,
    tokensOut: 20,
    tokensTotal: 30,
  }));
}

function telemetryStatus(projects: TelemetryProjectFixture[]) {
  return {
    connected: false,
    lastScan: '2026-06-15T00:00:00.000Z',
    sessions: projects.length,
    messages: projects.length * 10,
    tokensIn: 100,
    tokensOut: 200,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 300,
    activeDays: 1,
    hourly: new Array(24).fill(0),
    projects,
    workSecondsByDay: {},
    localUsers: [],
    externalUsers: [],
    unresolvedUsage: { sessions: 0, messages: 0, tokensTotal: 0 },
  };
}

function mockFetch(
  projectCountOrProjects: number | TelemetryProjectFixture[],
  telemetryOverrides: Record<string, unknown> = {},
  settingsOverrides: Partial<TaskBusConfig> = {}
): ReturnType<typeof vi.fn> {
  const projects = Array.isArray(projectCountOrProjects)
    ? projectCountOrProjects
    : telemetryProjects(projectCountOrProjects);
  const status = { ...telemetryStatus(projects), ...telemetryOverrides };
  const settings: TaskBusConfig = {
    enabled: false,
    redis: { host: '127.0.0.1', port: 6379 },
    telemetry: { enabled: true, platform: 'claudecode' },
    collaboration: false,
    ...settingsOverrides,
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/settings/task-bus')) {
      if (init?.method === 'PUT') {
        return Promise.resolve(new Response('{"ok":true,"connected":true}', { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(settings), { status: 200 }));
    }
    if (url.includes('/api/telemetry/status')) {
      return Promise.resolve(new Response(JSON.stringify(status), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderTaskBusSection() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(React.createElement(TaskBusSection));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return { host, root };
}

describe('TaskBusSection project throughput', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders every project in the throughput list instead of truncating at ten', async () => {
    mockFetch(11);

    const { host, root } = await renderTaskBusSection();

    expect(host.textContent).toContain('项目吞吐');
    expect(host.textContent).toContain('throughput-entry-10');
    expect(host.textContent).toContain('zz-last-project');

    await act(async () => {
      root.unmount();
    });
  });

  it('hides soft-deleted teams from project throughput', async () => {
    mockFetch([
      ...telemetryProjects(1),
      {
        cwd: '/tmp/deleted-team',
        displayName: 'deleted-team',
        teamSlug: 'deleted-team',
        bindProject: 'deleted-team',
        deletedAt: '2026-06-15T00:00:00.000Z',
        sessions: 1,
        messages: 99,
        tokensIn: 10,
        tokensOut: 20,
        tokensTotal: 30,
      },
    ]);

    const { host, root } = await renderTaskBusSection();

    expect(host.textContent).toContain('throughput-entry-1');
    expect(host.textContent).not.toContain('deleted-team');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders external IM user usage and unresolved usage warnings', async () => {
    mockFetch(1, {
      externalUsers: [
        {
          key: 'lark:user:ou_123',
          kind: 'external-im',
          identity: {
            platform: 'lark',
            type: 'person',
            displayName: 'Alice',
            confidence: 'exact-id',
          },
          teamDisplayName: 'Team Alpha',
          projectName: 'team-alpha',
          sessions: 1,
          messages: 12,
          tokensTotal: 3456,
        },
      ],
      unresolvedUsage: { sessions: 2, messages: 8, tokensTotal: 900 },
    });

    const { host, root } = await renderTaskBusSection();

    expect(host.textContent).toContain('外部 IM 用户用量');
    expect(host.textContent).toContain('Alice');
    expect(host.textContent).toContain('lark');
    expect(host.textContent).toContain('3.5K');
    expect(host.textContent).toContain('未映射会话：2 sessions');

    await act(async () => {
      root.unmount();
    });
  });

  it('defaults data upload to Redis when saved telemetry has no explicit opt-out', async () => {
    const fetchMock = mockFetch(1, {}, { enabled: true });

    const { host, root } = await renderTaskBusSection();
    const uploadToggle = Array.from(host.querySelectorAll('[role="switch"]')).at(2);

    expect(uploadToggle?.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('IM 桥接的每轮 token 用量上报到 Redis');
    expect(host.textContent).toContain('不会上传 IM 消息正文');

    await act(async () => {
      root.unmount();
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps explicit data upload opt-out disabled', async () => {
    mockFetch(
      1,
      {},
      { enabled: true, telemetry: { enabled: true, uploadEnabled: false, platform: 'claudecode' } }
    );

    const { host, root } = await renderTaskBusSection();
    const uploadToggle = Array.from(host.querySelectorAll('[role="switch"]')).at(2);

    expect(uploadToggle?.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      root.unmount();
    });
  });
});
