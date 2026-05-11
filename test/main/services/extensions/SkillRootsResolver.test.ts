import { describe, expect, it } from 'vitest';

import { SkillRootsResolver } from '@main/services/extensions/skills/SkillRootsResolver';

describe('SkillRootsResolver', () => {
  it('returns user roots when no project path is provided', () => {
    const resolver = new SkillRootsResolver();

    const roots = resolver.resolve();

    expect(roots).toHaveLength(1);
    expect(roots.every((root) => root.scope === 'user')).toBe(true);
    expect(roots[0].rootKind).toBe('hermit');
  });

  it('returns project and user roots when project path is provided', () => {
    const resolver = new SkillRootsResolver();

    const roots = resolver.resolve('/tmp/demo-project');

    expect(roots).toHaveLength(5);
    expect(roots.filter((root) => root.scope === 'project')).toHaveLength(4);
    expect(roots.filter((root) => root.scope === 'user')).toHaveLength(1);
    expect(roots.map((root) => root.rootKind)).toEqual(['hermit', 'claude', 'cursor', 'agents', 'codex']);
  });
});
