import { describe, expect, it } from 'vitest';

import {
  buildCapabilityPackCommandSuggestions,
  buildSlashCommandRegistry,
  collectSlashSuggestionAliases,
  resolveSlashCommand,
} from '@renderer/utils/slashCommandRegistry';

import type { LoadedCapabilityPack } from '@shared/types/extensions';

function makePack(overrides: Partial<LoadedCapabilityPack> = {}): LoadedCapabilityPack {
  return {
    packDir: '/tmp/yancy-loop-ops',
    source: 'user',
    enabled: true,
    warnings: [],
    manifest: {
      schemaVersion: 1,
      id: 'yancy-loop-ops',
      name: 'Yancy Loop Ops',
      namespace: 'yancy',
      version: '1.0.0',
      capabilities: {
        commands: [
          {
            id: 'doctor',
            alias: 'doctor',
            title: 'Loop Doctor',
            description: 'Diagnose Loop runtime',
            scope: ['admin-loop', 'team-loop'],
            surfaces: ['slash'],
            safety: 'read-only',
            prompt: 'commands/doctor.md',
            order: 10,
          },
        ],
        skills: [],
        workflows: [],
      },
    },
    ...overrides,
  };
}

describe('slashCommandRegistry', () => {
  it('registers scoped pack commands with canonical and namespaced slash ids', () => {
    const registry = buildSlashCommandRegistry({ packs: [makePack()], scope: 'admin-loop' });

    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({
      canonicalId: 'yancy-loop-ops.doctor',
      alias: 'doctor',
      namespace: 'yancy',
      slash: '/doctor',
      namespacedSlash: '/yancy:doctor',
      source: 'pack',
      packId: 'yancy-loop-ops',
    });
    expect(registry[0]?.command.execution).toEqual({ type: 'loop-session', reuse: true });
  });

  it('filters commands outside the requested scope', () => {
    const registry = buildSlashCommandRegistry({
      packs: [
        makePack({
          manifest: {
            ...makePack().manifest,
            capabilities: {
              commands: [
                {
                  id: 'card-only',
                  alias: 'card-only',
                  title: 'Card only',
                  scope: ['kanban-card'],
                  surfaces: ['slash'],
                  safety: 'proposal-only',
                  prompt: 'commands/card-only.md',
                },
              ],
            },
          },
        }),
      ],
      scope: 'team-loop',
    });

    expect(registry).toEqual([]);
  });

  it('marks alias conflicts and refuses typed ambiguous aliases', () => {
    const otherPack = makePack({
      packDir: '/tmp/other',
      manifest: {
        ...makePack().manifest,
        id: 'other-pack',
        namespace: 'other',
      },
    });
    const registry = buildSlashCommandRegistry({ packs: [makePack(), otherPack], scope: 'team-loop' });

    expect(registry.every((entry) => entry.conflictsWith?.length)).toBe(true);
    expect(resolveSlashCommand(registry, '/doctor').status).toBe('conflict');
    expect(resolveSlashCommand(registry, '/yancy:doctor')).toMatchObject({
      status: 'resolved',
      command: { canonicalId: 'yancy-loop-ops.doctor' },
    });
    expect(resolveSlashCommand(registry, '/yancy:doctor:prod').status).toBe('not-found');
  });

  it('filters namespaces containing namespaced slash separators', () => {
    const registry = buildSlashCommandRegistry({
      packs: [makePack({ manifest: { ...makePack().manifest, namespace: 'bad:namespace' } })],
      scope: 'team-loop',
    });

    expect(registry).toEqual([]);
  });

  it('protects official reserved aliases by suggesting the namespaced slash', () => {
    const pack = makePack({
      manifest: {
        ...makePack().manifest,
        capabilities: {
          commands: [
            {
              id: 'help',
              alias: 'help',
              title: 'Pack Help',
              scope: ['team-loop'],
              surfaces: ['slash'],
              safety: 'read-only',
              prompt: 'commands/help.md',
            },
          ],
        },
      },
    });

    const [suggestion] = buildCapabilityPackCommandSuggestions([pack], 'team-loop');

    expect(suggestion?.command).toBe('/yancy:help');
    expect(suggestion?.commandRef).toBe('yancy-loop-ops.help');
    expect(resolveSlashCommand(buildSlashCommandRegistry({ packs: [pack] }), '/help').status).toBe(
      'conflict'
    );
  });

  it('protects built-in runtime aliases beyond the manually reserved list', () => {
    const pack = makePack({
      manifest: {
        ...makePack().manifest,
        capabilities: {
          commands: [
            {
              id: 'loop',
              alias: 'loop',
              title: 'Pack Loop',
              scope: ['team-loop'],
              surfaces: ['slash'],
              safety: 'read-only',
              prompt: 'commands/loop.md',
            },
          ],
        },
      },
    });

    const [suggestion] = buildCapabilityPackCommandSuggestions([pack], 'team-loop');

    expect(suggestion?.command).toBe('/yancy:loop');
    expect(resolveSlashCommand(buildSlashCommandRegistry({ packs: [pack] }), '/loop').status).toBe(
      'conflict'
    );
  });

  it('uses namespaced suggestions when local commands shadow pack aliases', () => {
    const pack = makePack();
    const [suggestion] = buildCapabilityPackCommandSuggestions([pack], 'team-loop', {
      forceNamespacedAliases: new Set(['doctor']),
    });

    expect(suggestion?.command).toBe('/yancy:doctor');
    expect(suggestion?.insertText).toBe('yancy:doctor');
  });

  it('collects short aliases from local slash suggestions only', () => {
    const aliases = collectSlashSuggestionAliases([
      { id: 'local:doctor', name: 'doctor', type: 'command', command: '/doctor', insertText: 'doctor' },
      {
        id: 'pack:doctor',
        name: 'yancy:doctor',
        type: 'command',
        command: '/yancy:doctor',
        insertText: 'yancy:doctor',
        commandRef: 'yancy-loop-ops.doctor',
      },
      { id: 'local:summary', name: 'summary', type: 'command', command: '/summary fast', insertText: 'summary' },
    ]);

    expect([...aliases].sort()).toEqual(['doctor', 'summary']);
  });
});
