import { useCallback, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { SYSTEM_MANAGER_TEAM_NAME } from '@shared/types/team';
import { useShallow } from 'zustand/react/shallow';

import type { LoopSendIntent } from './loopSendIntent';
import type { DiscoverableWorker, InboxMessage } from '@shared/types';

interface UseLoopConsoleControllerOptions {
  teamName: string;
  sessionKey?: string | null;
  onPendingReplyChange: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
}

interface UseLoopConsoleControllerResult {
  sending: boolean;
  statusMessage: string | null;
  submitIntent: (intent: LoopSendIntent) => Promise<boolean>;
}

function currentIso(): string {
  return new Date().toISOString();
}

function buildOptimisticSystemMessage(text: string): InboxMessage {
  return {
    from: 'system',
    to: 'user',
    text,
    timestamp: currentIso(),
    read: true,
    messageId: `loop-console-${Date.now().toString(36)}`,
    source: 'system_notification',
  };
}

function normalizeSessionKey(sessionKey?: string | null): string | undefined {
  return sessionKey && sessionKey !== '__unassigned__' ? sessionKey : undefined;
}

function formatWorkersList(workers: DiscoverableWorker[]): string {
  if (!workers.length) return '当前没有可用数字员工。';
  const lines = workers.map((worker) => {
    const status = worker.status === 'online' ? 'online' : 'offline';
    const harness = worker.harness ? ` · ${worker.harness}` : '';
    const description = worker.description ? ` — ${worker.description}` : '';
    return `- @${worker.workerId} ${worker.name} · ${status}${harness}${description}`;
  });
  return [
    '当前数字员工：',
    ...lines,
    '',
    '在 Admin Loop 输入 `@workerId 任务内容` 可直接调用对应员工。',
  ].join('\n');
}

export function useLoopConsoleController({
  teamName,
  sessionKey,
  onPendingReplyChange,
}: UseLoopConsoleControllerOptions): UseLoopConsoleControllerResult {
  const [localSending, setLocalSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { sendTeamMessage, addOptimisticTeamMessage, refreshTeamMessagesHead, sendingMessage } =
    useStore(
      useShallow((s) => ({
        sendTeamMessage: s.sendTeamMessage,
        addOptimisticTeamMessage: s.addOptimisticTeamMessage,
        refreshTeamMessagesHead: s.refreshTeamMessagesHead,
        sendingMessage: s.sendingMessage,
      }))
    );

  const submitIntent = useCallback(
    async (intent: LoopSendIntent): Promise<boolean> => {
      const routedSessionKey = normalizeSessionKey(sessionKey);
      setStatusMessage(null);

      if (intent.kind === 'message') {
        const sentAtMs = Date.now();
        onPendingReplyChange((prev) => ({ ...prev, [intent.recipient]: sentAtMs }));
        try {
          const result = await sendTeamMessage(teamName, {
            member: intent.recipient,
            text: intent.text,
            summary: intent.summary,
            attachments: intent.attachments,
            taskRefs: intent.taskRefs,
            slashCommand: intent.slashCommand,
            sessionKey: routedSessionKey,
          });
          if (
            result.runtimeDelivery?.attempted === true &&
            result.runtimeDelivery.delivered === false
          ) {
            onPendingReplyChange((prev) => {
              if (prev[intent.recipient] !== sentAtMs) return prev;
              const next = { ...prev };
              delete next[intent.recipient];
              return next;
            });
          }
          return true;
        } catch (error) {
          onPendingReplyChange((prev) => {
            if (prev[intent.recipient] !== sentAtMs) return prev;
            const next = { ...prev };
            delete next[intent.recipient];
            return next;
          });
          setStatusMessage(error instanceof Error ? error.message : '指令发送失败');
          return false;
        }
      }

      if (intent.kind === 'workers-list') {
        setLocalSending(true);
        try {
          const result = await api.workers.list();
          addOptimisticTeamMessage(
            teamName,
            buildOptimisticSystemMessage(formatWorkersList(result.workers))
          );
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : '获取数字员工列表失败';
          setStatusMessage(message);
          addOptimisticTeamMessage(teamName, buildOptimisticSystemMessage(message));
          return false;
        } finally {
          setLocalSending(false);
        }
      }

      if (intent.kind === 'cross-team-task') {
        const now = Date.now();
        const optimisticMessageId = `loop-cross-team-${now}`;
        addOptimisticTeamMessage(teamName, {
          from: 'user',
          to: intent.toTeam,
          text: `@${intent.toTeam} ${intent.subject}`,
          timestamp: new Date(now).toISOString(),
          read: true,
          messageId: optimisticMessageId,
          source: 'cross_team_sent',
          session: routedSessionKey ? { key: routedSessionKey } : undefined,
        });
        if (teamName === SYSTEM_MANAGER_TEAM_NAME) {
          try {
            const result = await api.workers.invoke(intent.toTeam, {
              fromTeam: teamName,
              text: intent.subject,
              summary: intent.summary,
              sessionName: intent.toTeam,
              reuse: true,
              sessionKey: routedSessionKey,
            });
            const verb = result.reused ? '已复用' : '已创建';
            addOptimisticTeamMessage(
              teamName,
              buildOptimisticSystemMessage(
                `${verb} ${result.worker.name} 的 Loop 会话并直接下发指令，无需审批。`
              )
            );
            await refreshTeamMessagesHead(teamName).catch(() => undefined);
            return true;
          } catch (error) {
            const message = error instanceof Error ? error.message : '调用数字员工失败';
            addOptimisticTeamMessage(
              teamName,
              buildOptimisticSystemMessage(`无法调用 ${intent.toTeam}：${message}`)
            );
            await refreshTeamMessagesHead(teamName).catch(() => undefined);
            setStatusMessage(message);
            return false;
          }
        }
        try {
          const result = await api.crossTeam.send({
            fromTeam: teamName,
            fromMember: 'user',
            toTeam: intent.toTeam,
            text: intent.text,
            summary: intent.summary,
            taskRefs: intent.taskRefs,
            messageId: optimisticMessageId,
            sessionKey: routedSessionKey,
          });
          if ('ok' in result && result.ok === false) {
            const errorMessage =
              'error' in result && typeof result.error === 'string'
                ? result.error
                : '跨团队任务派发失败';
            throw new Error(errorMessage);
          }
          window.dispatchEvent(new CustomEvent('collab:refresh'));
          await refreshTeamMessagesHead(teamName);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : '跨团队任务派发失败';
          addOptimisticTeamMessage(
            teamName,
            buildOptimisticSystemMessage(`无法派发给 ${intent.toTeam}：${message}`)
          );
          await refreshTeamMessagesHead(teamName).catch(() => undefined);
          setStatusMessage(message);
          return false;
        }
      }

      setLocalSending(true);
      try {
        if (intent.kind === 'runtime') {
          await api.teams.processSend(teamName, intent.text);
          addOptimisticTeamMessage(
            teamName,
            buildOptimisticSystemMessage(
              `已注入 runtime（不写入消息看板）：${intent.summary ?? intent.text}`
            )
          );
          return true;
        }

        const response = await api.teams.createLoopSession(teamName, {
          sessionName: intent.sessionName,
          message: intent.text,
          reuse: intent.reuse,
        });
        const verb = response.reused ? '已复用' : '已创建';
        addOptimisticTeamMessage(
          teamName,
          buildOptimisticSystemMessage(
            `${verb} Loop 会话「${response.session.title || response.session.sessionKey}」并下发初始指令。`
          )
        );
        await refreshTeamMessagesHead(teamName).catch(() => undefined);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Loop runtime 操作失败';
        setStatusMessage(message);
        addOptimisticTeamMessage(teamName, buildOptimisticSystemMessage(message));
        return false;
      } finally {
        setLocalSending(false);
      }
    },
    [
      addOptimisticTeamMessage,
      onPendingReplyChange,
      refreshTeamMessagesHead,
      sendTeamMessage,
      sessionKey,
      teamName,
    ]
  );

  return {
    sending: localSending || sendingMessage,
    statusMessage,
    submitIntent,
  };
}
