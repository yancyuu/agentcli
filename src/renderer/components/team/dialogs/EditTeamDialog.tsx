import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Loader2 } from 'lucide-react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

interface EditTeamDialogProps {
  open: boolean;
  teamName: string;
  onClose: () => void;
  onDeleteTeam?: (() => void) | undefined;
}

// ── Shared input class ───────────────────────────────────────
const inputCls =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]';

const labelCls = 'mb-1 block text-xs font-medium text-[var(--color-text-secondary)]';

// ── Main component ───────────────────────────────────────────
export const EditTeamDialog = ({
  open,
  teamName,
  onClose,
  onDeleteTeam,
}: EditTeamDialogProps): React.JSX.Element => {
  const { data, fetchTeams, selectTeam } = useStore((s) => ({
    data: s.selectedTeamName === teamName ? s.selectedTeamData : null,
    fetchTeams: s.fetchTeams,
    selectTeam: s.selectTeam,
  }));

  // ── Derived defaults ─────────────────────────────────────────
  const rawSettings = useMemo(
    () => (data?.settings ?? {}) as Record<string, unknown>,
    [data?.settings]
  );

  const defaults = useMemo(() => {
    const cfg = data?.config;
    return {
      name: cfg?.name ?? '',
      description: cfg?.description ?? '',
      color: cfg?.color ?? '',
      language:
        cfg?.language ?? (typeof rawSettings.language === 'string' ? rawSettings.language : 'zh'),
      managedSources:
        cfg?.managedSources ??
        (typeof rawSettings.admin_from === 'string' ? rawSettings.admin_from : '*'),
      platformAllowFrom:
        cfg?.platformAllowFrom ??
        (typeof rawSettings.platform_allow_from === 'object' &&
        rawSettings.platform_allow_from !== null &&
        !Array.isArray(rawSettings.platform_allow_from)
          ? (rawSettings.platform_allow_from as Record<string, string>)
          : {}),
      platformAllowChat:
        cfg?.platformAllowChat ??
        (typeof (rawSettings as Record<string, unknown>).platform_allow_chat === 'object' &&
        (rawSettings as Record<string, unknown>).platform_allow_chat !== null &&
        !Array.isArray((rawSettings as Record<string, unknown>).platform_allow_chat)
          ? ((rawSettings as Record<string, unknown>).platform_allow_chat as Record<string, string>)
          : {}),
      showContextIndicator:
        cfg?.showContextIndicator ??
        (typeof rawSettings.show_context_indicator === 'boolean'
          ? rawSettings.show_context_indicator
          : true),
      replyFooter:
        cfg?.replyFooter ??
        (typeof rawSettings.reply_footer === 'boolean' ? rawSettings.reply_footer : true),
      injectSender:
        cfg?.injectSender ??
        (typeof rawSettings.inject_sender === 'boolean' ? rawSettings.inject_sender : false),
    };
  }, [data, rawSettings]);

  // ── Local form state ─────────────────────────────────────────
  const [name, setName] = useState(defaults.name);
  const [description, setDescription] = useState(defaults.description);
  const [language, setLanguage] = useState(defaults.language);
  const [managedSources, setManagedSources] = useState(defaults.managedSources);
  const [feishuAllowFrom, setFeishuAllowFrom] = useState(defaults.platformAllowFrom.feishu ?? '*');
  const [feishuAllowChat, setFeishuAllowChat] = useState(defaults.platformAllowChat.feishu ?? '*');
  const [showContextIndicator, setShowContextIndicator] = useState(defaults.showContextIndicator);
  const [replyFooter, setReplyFooter] = useState(defaults.replyFooter);
  const [injectSender, setInjectSender] = useState(defaults.injectSender);
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const saving = savePhase === 'saving';

  const defaultsRef = useRef(defaults);
  if (defaults.name) defaultsRef.current = defaults;

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (!open || prevOpenRef.current) {
      prevOpenRef.current = open;
      return;
    }
    prevOpenRef.current = true;
    const d = defaultsRef.current;
    setSavePhase('idle');
    setError(null);
    setName(d.name);
    setDescription(d.description);
    setLanguage(d.language);
    setManagedSources(d.managedSources);
    setFeishuAllowFrom(d.platformAllowFrom.feishu ?? '*');
    setFeishuAllowChat(d.platformAllowChat.feishu ?? '*');
    setShowContextIndicator(d.showContextIndicator);
    setReplyFooter(d.replyFooter);
    setInjectSender(d.injectSender);
  }, [open]);

  const handleSave = (): void => {
    if (!name.trim()) {
      setError('团队名称不能为空');
      return;
    }
    if (savePhase !== 'idle') return;
    setSavePhase('saving');
    setError(null);

    const feishu = feishuAllowFrom.trim();
    const feishuChat = feishuAllowChat.trim();

    void (async () => {
      try {
        await api.teams.updateConfig(teamName, {
          name: name.trim(),
          description: description.trim(),
          color: defaultsRef.current.color,
          language: language.trim() || undefined,
          managedSources: managedSources.trim() || undefined,
          platformAllowFrom: feishu ? { feishu } : {},
          platformAllowChat: feishuChat ? { feishu: feishuChat } : {},
          showContextIndicator,
          replyFooter,
          injectSender,
        });
        await Promise.all([fetchTeams(), selectTeam(teamName)]);
        setSavePhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败');
        setSavePhase('idle');
      }
    })();
  };

  const saveLabel =
    savePhase === 'done' ? '保存成功' : savePhase === 'saving' ? '保存中...' : '保存';

  return (
    <Dialog
      open={saving ? true : open}
      onOpenChange={(nextOpen) => {
        if (saving) return;
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑团队</DialogTitle>
          <DialogDescription>修改团队信息和消息设置（无需重启）</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basic info */}
          <div>
            <label htmlFor="edit-team-name" className={labelCls}>
              名称
            </label>
            <input
              id="edit-team-name"
              type="text"
              value={name}
              onChange={(e) => {
                setError(null);
                setName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving && name.trim()) handleSave();
              }}
              className={inputCls}
              placeholder="团队名称"
            />
          </div>
          <div>
            <label htmlFor="edit-team-description" className={labelCls}>
              描述
            </label>
            <textarea
              id="edit-team-description"
              value={description}
              onChange={(e) => {
                setError(null);
                setDescription(e.target.value);
              }}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="团队描述（可选）"
            />
          </div>

          {/* Messaging settings */}
          <div className="rounded-md border border-[var(--color-border)] p-3">
            <h3 className="text-xs font-medium text-[var(--color-text)]">消息设置</h3>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={labelCls}>语言</label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => {
                      setError(null);
                      setLanguage(e.target.value);
                    }}
                    className={inputCls}
                    placeholder="zh"
                  />
                </div>
                <div>
                  <label className={labelCls}>管理来源</label>
                  <input
                    type="text"
                    value={managedSources}
                    onChange={(e) => {
                      setError(null);
                      setManagedSources(e.target.value);
                    }}
                    className={inputCls}
                    placeholder="user1,user2 或 *"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={labelCls}>飞书私聊权限</label>
                  <input
                    type="text"
                    value={feishuAllowFrom}
                    onChange={(e) => {
                      setError(null);
                      setFeishuAllowFrom(e.target.value);
                    }}
                    className={inputCls}
                    placeholder="ou_xxx 或 *"
                  />
                </div>
                <div>
                  <label className={labelCls}>飞书群聊权限</label>
                  <input
                    type="text"
                    value={feishuAllowChat}
                    onChange={(e) => {
                      setError(null);
                      setFeishuAllowChat(e.target.value);
                    }}
                    className={inputCls}
                    placeholder="oc_xxx 或 *"
                  />
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  <Checkbox
                    checked={showContextIndicator}
                    onCheckedChange={(c) => {
                      setError(null);
                      setShowContextIndicator(c === true);
                    }}
                  />
                  上下文指示
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  <Checkbox
                    checked={replyFooter}
                    onCheckedChange={(c) => {
                      setError(null);
                      setReplyFooter(c === true);
                    }}
                  />
                  回复尾部信息
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  <Checkbox
                    checked={injectSender}
                    onCheckedChange={(c) => {
                      setError(null);
                      setInjectSender(c === true);
                    }}
                  />
                  注入发送者
                </label>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {savePhase === 'done' ? '关闭' : '取消'}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || savePhase === 'done' || !name.trim()}
          >
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
