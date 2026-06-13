import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getGlobalHermitWorkflowDir,
  listBuiltinWorkflowMetadata,
} from '@main/services/system-manager/BuiltinWorkflowSeeder';
import { validateOpenPathUserSelected } from '@main/utils/pathValidation';
import { createLogger } from '@shared/utils/logger';
import { KNOWN_SLASH_COMMANDS, isSupportedSlashCommandName } from '@shared/utils/slashCommands';

import type {
  CapabilityCommand,
  CapabilityCommandPromptRequest,
  CapabilityCommandPromptResult,
  CapabilityCommandSurface,
  CapabilityPackExportRequest,
  CapabilityPackImportRequest,
  CapabilityPackListResult,
  CapabilityPackManifest,
  CapabilityPackMutationResult,
  CapabilitySafety,
  CapabilityScope,
  CapabilitySkill,
  CapabilityWorkflow,
  LoadedCapabilityPack,
  RegisteredSlashCommand,
} from '@shared/types/extensions';

const logger = createLogger('Extensions:CapabilityPacks');
const MANIFEST_FILENAME = 'pack.json';
const MAX_PACK_FILE_COUNT = 500;
const MAX_PACK_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_COMMAND_PROMPT_BYTES = 512 * 1024;
const CAPABILITY_SCOPES = new Set<CapabilityScope>([
  'admin-loop',
  'team-loop',
  'kanban-card',
  'task-detail',
]);
const CAPABILITY_SURFACES = new Set<CapabilityCommandSurface>(['slash', 'quick-run']);
const CAPABILITY_SAFETY_VALUES = new Set<CapabilitySafety>([
  'read-only',
  'reporting',
  'proposal-only',
  'write',
  'audit',
]);
const RESERVED_SLASH_COMMANDS = new Set([
  ...KNOWN_SLASH_COMMANDS.map((command) => command.name.toLowerCase()),
  'help',
  'settings',
  'permissions',
  'login',
  'logout',
  'mcp',
  'agents',
  'hooks',
  'memory',
]);

const BUILTIN_HERMIT_OPS_PACK_ID = 'hermit-team-ops';
const BUILTIN_HERMIT_OPS_PACK_NAMESPACE = 'hermit';

function getHermitHome(): string {
  return process.env.HERMIT_HOME ?? path.join(os.homedir(), '.hermit');
}

function toCapabilitySafety(safety: string): CapabilitySafety {
  if (CAPABILITY_SAFETY_VALUES.has(safety as CapabilitySafety)) return safety as CapabilitySafety;
  return 'audit';
}

function createBuiltinHermitOpsPack(): LoadedCapabilityPack {
  const workflows = listBuiltinWorkflowMetadata();
  return {
    manifest: {
      schemaVersion: 1,
      id: BUILTIN_HERMIT_OPS_PACK_ID,
      name: 'Hermit Team Ops',
      namespace: BUILTIN_HERMIT_OPS_PACK_NAMESPACE,
      version: '1.0.0',
      author: 'Hermit',
      description:
        'Hermit 官方预装的团队运维检测包，安装到 ~/.claude/commands/hermit 后可被所有团队复用。',
      capabilities: {
        commands: workflows.map((workflow) => ({
          id: workflow.id,
          alias: workflow.id,
          title: workflow.label,
          description: workflow.description,
          scope: ['admin-loop', 'team-loop'],
          surfaces: ['slash', 'quick-run'],
          safety: toCapabilitySafety(workflow.safety),
          prompt: workflow.filename,
          workflow: workflow.filename,
          order: workflow.order,
          execution: { type: 'loop-session', reuse: true },
        })),
        workflows: workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.label,
          description: workflow.description,
          path: `workflows/${workflow.filename}`,
        })),
        skills: [],
      },
    },
    packDir: getGlobalHermitWorkflowDir(),
    source: 'builtin',
    enabled: true,
    warnings: [],
  };
}

function normalizeName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function sanitizePackId(packId: string): string {
  const sanitized = packId.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!sanitized) throw new Error('Capability pack id is required');
  return sanitized;
}

function isValidSlashToken(value: string): boolean {
  return isSupportedSlashCommandName(value) && !value.includes(':');
}

function requireValidSlashToken(value: string, fieldName: string): void {
  if (!isValidSlashToken(value)) {
    throw new Error(
      `${fieldName} must start with a letter and contain only letters, numbers, hyphens, and underscores`
    );
  }
}

function filterStringUnion<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fieldName: string,
  required: boolean
): T[] {
  const entries = asStringArray(value);
  const invalid = entries.find((entry) => !allowed.has(entry as T));
  if (invalid) {
    throw new Error(`${fieldName} contains unsupported value: ${invalid}`);
  }
  if (required && entries.length === 0) {
    throw new Error(`${fieldName} requires at least one value`);
  }
  return entries as T[];
}

export class CapabilityPackLoaderService {
  private readonly rootDir: string;

  constructor(rootDir = path.join(getHermitHome(), 'capability-packs')) {
    this.rootDir = rootDir;
  }

  async list(): Promise<CapabilityPackListResult> {
    const warnings: string[] = [];
    await fs.mkdir(this.rootDir, { recursive: true });

    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      logger.warn(`Failed to read capability pack root ${this.rootDir}`, error);
      return {
        packs: [],
        warnings: ['Unable to read capability pack directory.'],
        rootDir: this.rootDir,
      };
    }

    const loadedPacks = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(async (entry) => {
          const packDir = path.join(this.rootDir, entry.name);
          try {
            return await this.loadPackDir(packDir);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`${entry.name}: ${message}`);
            logger.warn(`Failed to load capability pack ${packDir}`, error);
            return null;
          }
        })
    );

    const packs: LoadedCapabilityPack[] = [createBuiltinHermitOpsPack()];
    const packIds = new Set<string>(packs.map((pack) => pack.manifest.id));
    for (const pack of loadedPacks) {
      if (!pack) continue;
      if (packIds.has(pack.manifest.id)) {
        warnings.push(
          `${path.basename(pack.packDir)}: Duplicate capability pack id ${pack.manifest.id}`
        );
        continue;
      }
      packIds.add(pack.manifest.id);
      packs.push(pack);
    }

    return {
      packs: packs.sort(
        (a, b) =>
          Number(a.source !== 'builtin') - Number(b.source !== 'builtin') ||
          a.manifest.name.localeCompare(b.manifest.name)
      ),
      warnings,
      rootDir: this.rootDir,
    };
  }

  async importPack(request: CapabilityPackImportRequest): Promise<CapabilityPackMutationResult> {
    const sourceDir = await this.validateSourceDir(request.sourceDir);
    const sourceManifest = await this.readManifest(path.join(sourceDir, MANIFEST_FILENAME));
    const targetDir = path.join(this.rootDir, sanitizePackId(sourceManifest.id));

    if (!request.overwrite && (await this.pathExists(targetDir))) {
      throw new Error(`Capability pack ${sourceManifest.id} already exists`);
    }

    await fs.mkdir(this.rootDir, { recursive: true });
    if (request.overwrite) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    await this.copyDirectory(sourceDir, targetDir);

    const pack = await this.loadPackDir(targetDir);
    return { pack, warnings: pack.warnings };
  }

  async exportPack(request: CapabilityPackExportRequest): Promise<CapabilityPackMutationResult> {
    const packId = sanitizePackId(request.packId);
    const sourceDir = path.join(this.rootDir, packId);
    if (!(await this.pathExists(sourceDir))) {
      throw new Error(`Capability pack ${packId} is not installed`);
    }

    const validatedDestination = validateOpenPathUserSelected(request.destinationDir);
    if (!validatedDestination.valid || !validatedDestination.normalizedPath) {
      throw new Error(validatedDestination.error ?? 'Invalid export destination');
    }

    const destinationRoot = validatedDestination.normalizedPath;
    const destination = path.join(destinationRoot, packId);
    if (!request.overwrite && (await this.pathExists(destination))) {
      throw new Error(`Export destination already contains ${packId}`);
    }

    if (request.overwrite) {
      await fs.rm(destination, { recursive: true, force: true });
    }
    await this.copyDirectory(sourceDir, destination);
    const pack = await this.loadPackDir(sourceDir);
    return { pack, warnings: [`Exported to ${destination}`] };
  }

  async getCommandPrompt(
    request: CapabilityCommandPromptRequest
  ): Promise<CapabilityCommandPromptResult> {
    const canonicalId = normalizeName(request.canonicalId);
    if (!canonicalId) throw new Error('Capability command canonicalId is required');

    const { packs } = await this.list();
    const registered = this.buildRegisteredCommands(packs, request.scope);
    const command = registered.find((entry) => entry.canonicalId === canonicalId);
    if (!command) {
      throw new Error(`Capability command ${canonicalId} not found`);
    }
    if (command.source === 'builtin') {
      throw new Error(
        `Built-in workflow command ${canonicalId} runs via Claude Code slash command`
      );
    }

    const pack = packs.find((entry) => entry.manifest.id === command.packId);
    if (!pack) {
      throw new Error(`Capability pack ${command.packId ?? ''} not found`);
    }

    const prompt = await this.readPromptFile(pack.packDir, command.command.prompt);
    return { command, prompt };
  }

  async loadPackDir(packDir: string): Promise<LoadedCapabilityPack> {
    const manifestPath = path.join(packDir, MANIFEST_FILENAME);
    const manifest = await this.readManifest(manifestPath);
    const warnings = await this.validateReferencedFiles(packDir, manifest);
    return {
      manifest,
      packDir,
      source: 'user',
      enabled: true,
      warnings,
    };
  }

  async validateSourceDir(sourceDir: string): Promise<string> {
    const validatedSource = validateOpenPathUserSelected(sourceDir);
    if (!validatedSource.valid || !validatedSource.normalizedPath) {
      throw new Error(validatedSource.error ?? 'Invalid import source');
    }

    const normalizedSourceDir = validatedSource.normalizedPath;
    const stat = await fs.stat(normalizedSourceDir);
    if (!stat.isDirectory()) {
      throw new Error('Import source must be a directory');
    }

    await this.readManifest(path.join(normalizedSourceDir, MANIFEST_FILENAME));
    return normalizedSourceDir;
  }

  private async readManifest(manifestPath: string): Promise<CapabilityPackManifest> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(
        error instanceof SyntaxError
          ? `Invalid ${MANIFEST_FILENAME}: ${error.message}`
          : `Missing ${MANIFEST_FILENAME}`
      );
    }

    return this.normalizeManifest(raw);
  }

  private normalizeManifest(raw: unknown): CapabilityPackManifest {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Capability pack manifest must be an object');
    }

    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== 1) {
      throw new Error('Unsupported capability pack schemaVersion');
    }

    const id = normalizeName(record.id);
    const name = normalizeName(record.name);
    const namespace = normalizeName(record.namespace);
    const version = normalizeName(record.version);
    if (!id || !name || !namespace || !version) {
      throw new Error('Capability pack manifest requires id, name, namespace, and version');
    }
    requireValidSlashToken(namespace, 'Capability pack namespace');

    const capabilities =
      record.capabilities && typeof record.capabilities === 'object'
        ? (record.capabilities as Record<string, unknown>)
        : {};

    return {
      schemaVersion: 1,
      id,
      name,
      namespace,
      version,
      author: normalizeName(record.author) ?? undefined,
      description: normalizeName(record.description) ?? undefined,
      capabilities: {
        commands: this.normalizeCommands(capabilities.commands),
        skills: this.normalizeSkills(capabilities.skills),
        workflows: this.normalizeWorkflows(capabilities.workflows),
      },
    };
  }

  private normalizeCommands(value: unknown): CapabilityCommand[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Command at index ${index} must be an object`);
      }
      const record = entry as Record<string, unknown>;
      const id = normalizeName(record.id);
      const alias = normalizeName(record.alias);
      const title = normalizeName(record.title);
      const prompt = normalizeName(record.prompt);
      const safety = normalizeName(record.safety);
      if (!id || !alias || !title || !prompt || !safety) {
        throw new Error(`Command at index ${index} requires id, alias, title, prompt, and safety`);
      }
      requireValidSlashToken(alias, `Command at index ${index} alias`);
      const scope = filterStringUnion(
        record.scope,
        CAPABILITY_SCOPES,
        `Command at index ${index} scope`,
        true
      );
      const surfaces = filterStringUnion(
        record.surfaces,
        CAPABILITY_SURFACES,
        `Command at index ${index} surfaces`,
        true
      );
      if (!CAPABILITY_SAFETY_VALUES.has(safety as CapabilitySafety)) {
        throw new Error(`Command at index ${index} has unsupported safety: ${safety}`);
      }

      const executionRecord =
        record.execution && typeof record.execution === 'object'
          ? (record.execution as Record<string, unknown>)
          : null;
      const executionType = normalizeName(executionRecord?.type);

      return {
        id,
        alias,
        title,
        description: normalizeName(record.description) ?? undefined,
        scope,
        surfaces,
        safety: safety as CapabilityCommand['safety'],
        prompt,
        usesSkills: asStringArray(record.usesSkills),
        workflow: record.workflow === null ? null : (normalizeName(record.workflow) ?? undefined),
        order: typeof record.order === 'number' ? record.order : undefined,
        execution:
          executionType === 'send-message' || executionType === 'loop-session'
            ? { type: executionType, reuse: executionRecord?.reuse === true }
            : undefined,
      };
    });
  }

  private buildRegisteredCommands(
    packs: readonly LoadedCapabilityPack[],
    scope?: CapabilityScope
  ): RegisteredSlashCommand[] {
    const registered: RegisteredSlashCommand[] = [];
    for (const pack of packs) {
      if (!pack.enabled) continue;
      const packId = pack.manifest.id;
      const namespace = pack.manifest.namespace.trim().toLowerCase();
      for (const rawCommand of pack.manifest.capabilities.commands ?? []) {
        if (scope && !rawCommand.scope.includes(scope)) continue;
        if (!rawCommand.surfaces.includes('slash')) continue;
        const alias = rawCommand.alias.trim().toLowerCase();
        registered.push({
          canonicalId: `${packId}.${rawCommand.id}`,
          alias,
          namespace,
          slash: `/${alias}`,
          namespacedSlash: `/${namespace}:${alias}`,
          source: pack.source === 'builtin' ? 'builtin' : 'pack',
          packId,
          command: {
            ...rawCommand,
            alias,
            execution: rawCommand.execution ?? {
              type: scope === 'admin-loop' ? 'loop-session' : 'send-message',
              reuse: true,
            },
          },
        });
      }
    }

    const byAlias = new Map<string, RegisteredSlashCommand[]>();
    for (const command of registered) {
      byAlias.set(command.alias, [...(byAlias.get(command.alias) ?? []), command]);
    }

    return registered.map((command) => {
      const aliasPeers = byAlias.get(command.alias) ?? [];
      const conflictsWith = [
        ...aliasPeers
          .filter((peer) => peer.canonicalId !== command.canonicalId)
          .map((peer) => peer.canonicalId),
        ...(RESERVED_SLASH_COMMANDS.has(command.alias) ? [`official.${command.alias}`] : []),
      ];
      return conflictsWith.length ? { ...command, conflictsWith } : command;
    });
  }

  private normalizeSkills(value: unknown): CapabilitySkill[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Skill at index ${index} must be an object`);
      }
      const record = entry as Record<string, unknown>;
      const id = normalizeName(record.id);
      const name = normalizeName(record.name);
      const skillPath = normalizeName(record.path);
      if (!id || !name || !skillPath) {
        throw new Error(`Skill at index ${index} requires id, name, and path`);
      }
      return {
        id,
        name,
        description: normalizeName(record.description) ?? undefined,
        path: skillPath,
      };
    });
  }

  private normalizeWorkflows(value: unknown): CapabilityWorkflow[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Workflow at index ${index} must be an object`);
      }
      const record = entry as Record<string, unknown>;
      const id = normalizeName(record.id);
      const name = normalizeName(record.name);
      const workflowPath = normalizeName(record.path);
      if (!id || !name || !workflowPath) {
        throw new Error(`Workflow at index ${index} requires id, name, and path`);
      }
      return {
        id,
        name,
        description: normalizeName(record.description) ?? undefined,
        path: workflowPath,
      };
    });
  }

  private async readPromptFile(packDir: string, relativePath: string): Promise<string> {
    if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
      throw new Error(`Unsafe capability command prompt path: ${relativePath}`);
    }

    const absolutePath = path.join(packDir, relativePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Capability command prompt must be a file: ${relativePath}`);
    }
    if (stat.size > MAX_COMMAND_PROMPT_BYTES) {
      throw new Error('Capability command prompt is too large');
    }
    return fs.readFile(absolutePath, 'utf8');
  }

  private async validateReferencedFiles(
    packDir: string,
    manifest: CapabilityPackManifest
  ): Promise<string[]> {
    const warnings: string[] = [];
    const references = [
      ...(manifest.capabilities.commands ?? []).map((command) => command.prompt),
      ...(manifest.capabilities.skills ?? []).map((skill) => skill.path),
      ...(manifest.capabilities.workflows ?? []).map((workflow) => workflow.path),
    ];

    for (const relativePath of references) {
      if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
        warnings.push(`Ignored unsafe path reference: ${relativePath}`);
        continue;
      }
      if (!(await this.pathExists(path.join(packDir, relativePath)))) {
        warnings.push(`Missing referenced file or folder: ${relativePath}`);
      }
    }

    return warnings;
  }

  private async copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
    const files = await this.walkDirectory(sourceDir);
    await fs.mkdir(targetDir, { recursive: true });
    for (const file of files) {
      const targetPath = path.join(targetDir, file.relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(file.absolutePath, targetPath);
    }
  }

  private async walkDirectory(rootDir: string): Promise<
    Array<{
      absolutePath: string;
      relativePath: string;
    }>
  > {
    const allFiles: Array<{ absolutePath: string; relativePath: string }> = [];
    let totalBytes = 0;

    const visit = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) {
          throw new Error('Capability pack cannot contain symbolic links');
        }

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }

        const stat = await fs.stat(fullPath);
        totalBytes += stat.size;
        if (allFiles.length + 1 > MAX_PACK_FILE_COUNT) {
          throw new Error(`Capability pack has too many files (max ${MAX_PACK_FILE_COUNT})`);
        }
        if (totalBytes > MAX_PACK_TOTAL_BYTES) {
          throw new Error(
            `Capability pack is too large (max ${Math.floor(MAX_PACK_TOTAL_BYTES / (1024 * 1024))} MB)`
          );
        }

        allFiles.push({
          absolutePath: fullPath,
          relativePath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
        });
      }
    };

    await visit(rootDir);
    return allFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
