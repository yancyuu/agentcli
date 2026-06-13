import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CapabilityPackLoaderService } from '@main/services/extensions/capability-packs/CapabilityPackLoaderService';

let tmpDir: string;
let rootDir: string;

function writePack(packDir: string, id = 'yancy-loop-ops'): void {
  fs.mkdirSync(path.join(packDir, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(packDir, 'skills/ops-diagnosis'), { recursive: true });
  fs.mkdirSync(path.join(packDir, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(packDir, 'commands/doctor.md'), '# Doctor\n', 'utf8');
  fs.writeFileSync(path.join(packDir, 'skills/ops-diagnosis/SKILL.md'), '# Skill\n', 'utf8');
  fs.writeFileSync(path.join(packDir, 'workflows/daily-hygiene.md'), '# Workflow\n', 'utf8');
  fs.writeFileSync(
    path.join(packDir, 'pack.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id,
        name: 'Yancy Loop Ops',
        namespace: 'yancy',
        version: '1.0.0',
        author: 'Yancy',
        description: 'Loop Engineering ops pack',
        capabilities: {
          commands: [
            {
              id: 'doctor',
              alias: 'doctor',
              title: 'Loop Doctor',
              description: 'Diagnose Hermit Loop runtime',
              scope: ['admin-loop'],
              surfaces: ['slash'],
              safety: 'read-only',
              prompt: 'commands/doctor.md',
              usesSkills: ['ops-diagnosis'],
              workflow: null,
              order: 10,
            },
          ],
          skills: [
            {
              id: 'ops-diagnosis',
              name: 'Ops Diagnosis',
              description: 'Runtime diagnostics',
              path: 'skills/ops-diagnosis',
            },
          ],
          workflows: [
            {
              id: 'daily-hygiene',
              name: 'Daily Folder Hygiene',
              description: 'Daily folder inspection',
              path: 'workflows/daily-hygiene.md',
            },
          ],
        },
      },
      null,
      2
    ),
    'utf8'
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-capability-packs-'));
  rootDir = path.join(tmpDir, 'capability-packs');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CapabilityPackLoaderService', () => {
  it('lists the built-in Hermit team ops pack by default', async () => {
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    expect(result.packs[0]).toMatchObject({
      source: 'builtin',
      enabled: true,
      manifest: {
        id: 'hermit-team-ops',
        name: 'Hermit Team Ops',
        namespace: 'hermit',
        capabilities: {
          commands: expect.arrayContaining([
            expect.objectContaining({
              id: 'daily-workflow-extraction',
              alias: 'daily-workflow-extraction',
              scope: ['admin-loop', 'team-loop'],
              execution: { type: 'loop-session', reuse: true },
            }),
          ]),
        },
      },
    });
  });

  it('loads local pack manifests from the capability-packs root', async () => {
    const packDir = path.join(rootDir, 'yancy-loop-ops');
    writePack(packDir);
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    expect(result.rootDir).toBe(rootDir);
    expect(result.warnings).toEqual([]);
    expect(result.packs[0]).toMatchObject({
      source: 'builtin',
      manifest: { id: 'hermit-team-ops', namespace: 'hermit' },
    });
    const userPack = result.packs.find((pack) => pack.manifest.id === 'yancy-loop-ops');
    expect(userPack).toMatchObject({
      packDir,
      source: 'user',
      enabled: true,
      manifest: {
        id: 'yancy-loop-ops',
        namespace: 'yancy',
        capabilities: {
          commands: [{ id: 'doctor', alias: 'doctor', safety: 'read-only' }],
        },
      },
    });
  });

  it('imports a source folder containing pack.json', async () => {
    const sourceDir = path.join(tmpDir, 'source-pack');
    writePack(sourceDir, 'source-pack');
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.importPack({ sourceDir });

    expect(result.pack?.manifest.id).toBe('source-pack');
    expect(fs.existsSync(path.join(rootDir, 'source-pack/commands/doctor.md'))).toBe(true);
  });

  it('returns warnings for missing referenced files without rejecting the pack', async () => {
    const packDir = path.join(rootDir, 'missing-ref');
    writePack(packDir, 'missing-ref');
    fs.rmSync(path.join(packDir, 'commands/doctor.md'));
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    const pack = result.packs.find((entry) => entry.manifest.id === 'missing-ref');
    expect(pack?.warnings).toContain('Missing referenced file or folder: commands/doctor.md');
  });

  it('reads a command prompt by canonical id', async () => {
    const packDir = path.join(rootDir, 'yancy-loop-ops');
    writePack(packDir);
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.getCommandPrompt({
      canonicalId: 'yancy-loop-ops.doctor',
      scope: 'admin-loop',
    });

    expect(result.command.canonicalId).toBe('yancy-loop-ops.doctor');
    expect(result.command.command.execution).toEqual({ type: 'loop-session', reuse: true });
    expect(result.prompt).toBe('# Doctor\n');
  });

  it('skips duplicate manifest ids', async () => {
    writePack(path.join(rootDir, 'first'), 'duplicate-pack');
    writePack(path.join(rootDir, 'second'), 'duplicate-pack');
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    expect(result.packs.filter((pack) => pack.manifest.id === 'duplicate-pack')).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('Duplicate capability pack id duplicate-pack'))).toBe(true);
  });

  it('rejects unsupported enum values in commands', async () => {
    const packDir = path.join(rootDir, 'bad-enum');
    writePack(packDir, 'bad-enum');
    const manifestPath = path.join(packDir, 'pack.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.capabilities.commands[0].safety = 'dangerous';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    expect(result.packs.some((pack) => pack.manifest.id === 'bad-enum')).toBe(false);
    expect(result.warnings[0]).toContain('unsupported safety');
  });

  it('rejects namespaces containing slash separators', async () => {
    const packDir = path.join(rootDir, 'bad-namespace');
    writePack(packDir, 'bad-namespace');
    const manifestPath = path.join(packDir, 'pack.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.namespace = 'bad:namespace';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    expect(result.packs.some((pack) => pack.manifest.id === 'bad-namespace')).toBe(false);
    expect(result.warnings[0]).toContain('Capability pack namespace');
  });

  it('rejects unsupported schema versions', async () => {
    const packDir = path.join(rootDir, 'bad-schema');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'pack.json'),
      JSON.stringify({ schemaVersion: 2, id: 'bad', name: 'Bad', namespace: 'bad', version: '1.0.0' }),
      'utf8'
    );
    const service = new CapabilityPackLoaderService(rootDir);

    const result = await service.list();

    expect(result.packs.some((pack) => pack.manifest.id === 'bad')).toBe(false);
    expect(result.warnings[0]).toContain('Unsupported capability pack schemaVersion');
  });
});
