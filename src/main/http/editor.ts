/**
 * HTTP routes for editor/file operations in standalone mode.
 *
 * All routes accept a `root` query parameter to specify the project root.
 * This is the stateless equivalent of the Electron IPC `activeProjectRoot`.
 */

import {
  checkFileConflict,
  FileSearchService,
  GitStatusService,
  ProjectFileService,
} from '../services/editor';

import { getErrorMessage } from '@shared/utils/errorHandling';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { SearchInFilesOptions } from '@shared/types/editor';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:editor');

const projectFileService = new ProjectFileService();
const fileSearchService = new FileSearchService();
const gitStatusServiceMap = new Map<string, GitStatusService>();

function getGitStatusService(root: string): GitStatusService {
  let svc = gitStatusServiceMap.get(root);
  if (!svc) {
    svc = new GitStatusService();
    svc.init(root);
    gitStatusServiceMap.set(root, svc);
  }
  return svc;
}

function validateRoot(root: string | undefined): string {
  if (!root || typeof root !== 'string' || !root.trim()) {
    throw new Error('root query parameter is required');
  }
  const normalized = path.resolve(path.normalize(root));
  if (!path.isAbsolute(normalized)) {
    throw new Error('root must be an absolute path');
  }
  return normalized;
}

export function registerEditorRoutes(app: FastifyInstance): void {
  // Read directory listing
  app.get<{
    Querystring: { root: string; dirPath?: string; maxEntries?: string };
  }>('/api/editor/readDir', async (request, reply) => {
    try {
      const root = validateRoot(request.query.root);
      const dirPath = request.query.dirPath ?? '';
      const maxEntries = request.query.maxEntries
        ? parseInt(request.query.maxEntries, 10)
        : undefined;
      const result = await projectFileService.readDir(root, dirPath, maxEntries);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/editor/readDir:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Read file content
  app.get<{
    Querystring: { root: string; filePath: string };
  }>('/api/editor/readFile', async (request, reply) => {
    try {
      const root = validateRoot(request.query.root);
      const filePath = request.query.filePath;
      if (!filePath) throw new Error('filePath is required');
      const result = await projectFileService.readFile(root, filePath);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/editor/readFile:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Write file content
  app.post<{
    Body: { root: string; filePath: string; content: string; baselineMtimeMs?: number };
  }>('/api/editor/writeFile', async (request, reply) => {
    try {
      const { root: rawRoot, filePath, content, baselineMtimeMs } = request.body ?? {};
      const root = validateRoot(rawRoot);
      if (!filePath) throw new Error('filePath is required');
      if (typeof content !== 'string') throw new Error('content must be a string');

      if (baselineMtimeMs !== undefined && baselineMtimeMs > 0) {
        const conflict = await checkFileConflict(filePath, baselineMtimeMs);
        if (conflict.hasConflict) {
          throw new Error(conflict.deleted ? 'CONFLICT_DELETED' : 'CONFLICT');
        }
      }

      const result = await projectFileService.writeFile(root, filePath, content);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/editor/writeFile:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Create file
  app.post<{
    Body: { root: string; parentDir: string; fileName: string };
  }>('/api/editor/createFile', async (request, reply) => {
    try {
      const { root: rawRoot, parentDir, fileName } = request.body ?? {};
      const root = validateRoot(rawRoot);
      if (!parentDir || !fileName) throw new Error('parentDir and fileName are required');
      const result = await projectFileService.createFile(root, parentDir, fileName);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/editor/createFile:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Create directory
  app.post<{
    Body: { root: string; parentDir: string; dirName: string };
  }>('/api/editor/createDir', async (request, reply) => {
    try {
      const { root: rawRoot, parentDir, dirName } = request.body ?? {};
      const root = validateRoot(rawRoot);
      if (!parentDir || !dirName) throw new Error('parentDir and dirName are required');
      const result = await projectFileService.createDir(root, parentDir, dirName);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/editor/createDir:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Delete file/directory
  app.post<{
    Body: { root: string; filePath: string };
  }>('/api/editor/deleteFile', async (request, reply) => {
    try {
      const { root: rawRoot, filePath } = request.body ?? {};
      const root = validateRoot(rawRoot);
      if (!filePath) throw new Error('filePath is required');
      const result = await projectFileService.deleteFile(root, filePath);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/editor/deleteFile:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Move file
  app.post<{
    Body: { root: string; sourcePath: string; destDir: string };
  }>('/api/editor/moveFile', async (request, reply) => {
    try {
      const { root: rawRoot, sourcePath, destDir } = request.body ?? {};
      const root = validateRoot(rawRoot);
      if (!sourcePath || !destDir) throw new Error('sourcePath and destDir are required');
      const result = await projectFileService.moveFile(root, sourcePath, destDir);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/editor/moveFile:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Rename file
  app.post<{
    Body: { root: string; sourcePath: string; newName: string };
  }>('/api/editor/renameFile', async (request, reply) => {
    try {
      const { root: rawRoot, sourcePath, newName } = request.body ?? {};
      const root = validateRoot(rawRoot);
      if (!sourcePath || !newName) throw new Error('sourcePath and newName are required');
      const result = await projectFileService.renameFile(root, sourcePath, newName);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/editor/renameFile:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Search in files
  app.get<{
    Querystring: {
      root: string;
      query: string;
      caseSensitive?: string;
      maxFiles?: string;
      maxMatches?: string;
    };
  }>('/api/editor/search', async (request, reply) => {
    try {
      const root = validateRoot(request.query.root);
      const query = request.query.query;
      if (!query) throw new Error('query is required');
      const options: SearchInFilesOptions = {
        query,
        caseSensitive: request.query.caseSensitive === 'true',
        maxFiles: request.query.maxFiles ? parseInt(request.query.maxFiles, 10) : undefined,
        maxMatches: request.query.maxMatches ? parseInt(request.query.maxMatches, 10) : undefined,
      };
      const controller = new AbortController();
      const result = await fileSearchService.searchInFiles(root, options, controller.signal);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/editor/search:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // List all files (Quick Open)
  app.get<{
    Querystring: { root: string };
  }>('/api/editor/listFiles', async (request, reply) => {
    try {
      const root = validateRoot(request.query.root);
      const result = await fileSearchService.listFiles(root);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/editor/listFiles:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Read binary preview (images)
  app.get<{
    Querystring: { root: string; filePath: string };
  }>('/api/editor/readBinaryPreview', async (request, reply) => {
    try {
      const root = validateRoot(request.query.root);
      const filePath = request.query.filePath;
      if (!filePath) throw new Error('filePath is required');
      const result = await projectFileService.readBinaryPreview(root, filePath);
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/editor/readBinaryPreview:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Git status
  app.get<{
    Querystring: { root: string };
  }>('/api/editor/gitStatus', async (request, reply) => {
    try {
      const root = validateRoot(request.query.root);
      const result = getGitStatusService(root).getStatus();
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in GET /api/editor/gitStatus:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });
}

function shouldLogError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return !msg.includes('not initialized') && !msg.includes('required');
}

function getStatusCode(error: unknown): number {
  const msg = getErrorMessage(error);
  if (msg.includes('required') || msg.includes('must be')) return 400;
  if (msg.includes('not found') || msg.includes('ENOENT')) return 404;
  if (msg.includes('CONFLICT')) return 409;
  return 500;
}
