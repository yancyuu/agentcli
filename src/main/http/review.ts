/**
 * HTTP routes for code review / diff view operations in standalone mode.
 *
 * Routes delegate to ChangeExtractorService, ReviewApplierService,
 * and FileContentResolver — the same services used by the Electron IPC handlers.
 */

import { validateFilePath } from '@main/utils/pathValidation';
import { getErrorMessage } from '@shared/utils/errorHandling';
import { createLogger } from '@shared/utils/logger';

import type { HttpServices } from './index';
import type { ApplyReviewRequest, SnippetDiff } from '@shared/types/review';
import type { TaskChangeStateBucket } from '@shared/utils/taskChangeState';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:review');

function getChangeExtractor(services: HttpServices) {
  if (!services.changeExtractorService) {
    throw new Error('Change extractor service is not available');
  }
  return services.changeExtractorService;
}

function getReviewApplier(services: HttpServices) {
  if (!services.reviewApplierService) {
    throw new Error('Review applier service is not available');
  }
  return services.reviewApplierService;
}

function getFileContentResolver(services: HttpServices) {
  if (!services.fileContentResolverService) {
    throw new Error('File content resolver service is not available');
  }
  return services.fileContentResolverService;
}

export function registerReviewRoutes(app: FastifyInstance, services: HttpServices): void {
  // Get agent changes (all file changes by a specific member)
  app.get<{
    Params: { teamName: string; memberName: string };
  }>('/api/teams/:teamName/review/agent-changes/:memberName', async (request, reply) => {
    try {
      const result = await getChangeExtractor(services).getAgentChanges(
        request.params.teamName,
        request.params.memberName
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/review/agent-changes/${request.params.memberName}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get task changes (all file changes for a specific task)
  app.get<{
    Params: { teamName: string; taskId: string };
    Querystring: {
      owner?: string;
      status?: string;
      since?: string;
      stateBucket?: string;
      summaryOnly?: string;
      forceFresh?: string;
    };
  }>('/api/teams/:teamName/review/task-changes/:taskId', async (request, reply) => {
    try {
      const { owner, status, since, stateBucket, summaryOnly, forceFresh } = request.query;
      const opts =
        owner || status || since || stateBucket || summaryOnly || forceFresh
          ? {
              owner: owner || undefined,
              status: status || undefined,
              since: since || undefined,
              stateBucket:
                stateBucket === 'approved' ||
                stateBucket === 'review' ||
                stateBucket === 'completed' ||
                stateBucket === 'active'
                  ? (stateBucket as TaskChangeStateBucket)
                  : undefined,
              summaryOnly: summaryOnly === 'true',
              forceFresh: forceFresh === 'true',
            }
          : undefined;
      const result = await getChangeExtractor(services).getTaskChanges(
        request.params.teamName,
        request.params.taskId,
        opts
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/review/task-changes/${request.params.taskId}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get change stats for a member
  app.get<{
    Params: { teamName: string; memberName: string };
  }>('/api/teams/:teamName/review/change-stats/:memberName', async (request, reply) => {
    try {
      const result = await getChangeExtractor(services).getChangeStats(
        request.params.teamName,
        request.params.memberName
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/review/change-stats/${request.params.memberName}:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Apply review decisions (approve/reject hunks)
  app.post<{
    Params: { teamName: string };
    Body: ApplyReviewRequest;
  }>('/api/teams/:teamName/review/apply-decisions', async (request, reply) => {
    try {
      const req = request.body;
      if (!req || !Array.isArray(req.decisions)) {
        return reply.status(400).send({ error: 'decisions array is required' });
      }

      const applier = getReviewApplier(services);
      const resolver = services.fileContentResolverService;
      const fileContents = new Map();

      if (resolver) {
        for (const d of req.decisions) {
          if (d.originalFullContent !== undefined || d.modifiedFullContent !== undefined) {
            fileContents.set(d.filePath, {
              filePath: d.filePath,
              relativePath: d.filePath.split(/[\\/]/).filter(Boolean).slice(-3).join('/'),
              snippets: d.snippets ?? [],
              linesAdded: 0,
              linesRemoved: 0,
              isNewFile: d.isNewFile ?? false,
              originalFullContent: d.originalFullContent ?? null,
              modifiedFullContent: d.modifiedFullContent ?? null,
              contentSource: 'unavailable',
            });
          } else {
            const resolved = await resolver.getFileContent(
              req.teamName,
              req.memberName ?? '',
              d.filePath,
              d.snippets ?? []
            );
            fileContents.set(d.filePath, resolved);
          }
        }
      }

      const result = await applier.applyReviewDecisions(req, fileContents);

      // Invalidate resolver cache
      if (resolver) {
        try {
          for (const d of req.decisions) {
            resolver.invalidateFile(d.filePath);
          }
        } catch {
          /* best effort */
        }
      }

      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in POST /api/teams/${request.params.teamName}/review/apply-decisions:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Get file content for review diff
  app.get<{
    Params: { teamName: string };
    Querystring: { memberName: string; filePath: string };
  }>('/api/teams/:teamName/review/file-content', async (request, reply) => {
    try {
      const { memberName, filePath } = request.query;
      if (!filePath) {
        return reply.status(400).send({ error: 'filePath is required' });
      }
      const result = await getFileContentResolver(services).getFileContent(
        request.params.teamName,
        memberName || '',
        filePath
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in GET /api/teams/${request.params.teamName}/review/file-content:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Save edited file from review
  app.post<{
    Body: { filePath: string; content: string; projectPath?: string };
  }>('/api/teams/review/save-edited-file', async (request, reply) => {
    try {
      const { filePath, content, projectPath } = request.body ?? {};
      if (!filePath || typeof content !== 'string') {
        return reply.status(400).send({ error: 'filePath and content are required' });
      }
      const pathCheck = validateFilePath(filePath, projectPath || null);
      if (!pathCheck.valid) {
        return reply.status(400).send({ error: `Path validation failed: ${pathCheck.error}` });
      }
      const result = await getReviewApplier(services).saveEditedFile(
        pathCheck.normalizedPath!,
        content
      );
      // Invalidate cached content
      if (services.fileContentResolverService) {
        services.fileContentResolverService.invalidateFile(pathCheck.normalizedPath!);
      }
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error('Error in POST /api/teams/review/save-edited-file:', getErrorMessage(error));
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Reject hunks
  app.post<{
    Params: { teamName: string };
    Body: {
      filePath: string;
      original: string;
      modified: string;
      hunkIndices: number[];
      snippets: SnippetDiff[];
    };
  }>('/api/teams/:teamName/review/reject-hunks', async (request, reply) => {
    try {
      const { filePath, original, modified, hunkIndices, snippets } = request.body ?? {};
      if (!filePath) {
        return reply.status(400).send({ error: 'filePath is required' });
      }
      const result = await getReviewApplier(services).rejectHunks(
        request.params.teamName,
        filePath,
        original ?? '',
        modified ?? '',
        hunkIndices ?? [],
        snippets ?? []
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in POST /api/teams/${request.params.teamName}/review/reject-hunks:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });

  // Reject entire file
  app.post<{
    Params: { teamName: string };
    Body: { filePath: string; original: string; modified: string };
  }>('/api/teams/:teamName/review/reject-file', async (request, reply) => {
    try {
      const { filePath, original, modified } = request.body ?? {};
      if (!filePath) {
        return reply.status(400).send({ error: 'filePath is required' });
      }
      const result = await getReviewApplier(services).rejectFile(
        request.params.teamName,
        filePath,
        original ?? '',
        modified ?? ''
      );
      return reply.send(result);
    } catch (error) {
      if (shouldLogError(error)) {
        logger.error(
          `Error in POST /api/teams/${request.params.teamName}/review/reject-file:`,
          getErrorMessage(error)
        );
      }
      return reply.status(getStatusCode(error)).send({ error: getErrorMessage(error) });
    }
  });
}

function shouldLogError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return !msg.includes('not available') && !msg.includes('not initialized');
}

function getStatusCode(error: unknown): number {
  const msg = getErrorMessage(error);
  if (msg.includes('required') || msg.includes('must be')) return 400;
  if (msg.includes('not found') || msg.includes('ENOENT')) return 404;
  return 500;
}
