/**
 * SkillsLibraryPanel — global user skills library management.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatSkillRootKind, getSkillAudienceLabel } from '@shared/utils/skillRoots';
import { AlertCircle, Edit, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { SearchInput } from '../common/SearchInput';

import { SkillEditorDialog } from './SkillEditorDialog';

import type { SkillCatalogItem, SkillDetail } from '@shared/types/extensions';

interface SkillsLibraryPanelProps {
  projectPath: string | null;
  projectLabel: string | null;
}

type EditorState =
  | { mode: 'create'; detail: null }
  | { mode: 'edit'; detail: SkillDetail | null; skillId: string };

function formatScope(scope: SkillCatalogItem['scope']): string {
  return scope === 'project' ? '项目' : '个人';
}

function formatInvocationMode(mode: SkillCatalogItem['invocationMode']): string {
  return mode === 'manual-only' ? '手动调用' : '自动触发';
}

function matchesSearch(skill: SkillCatalogItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [skill.name, skill.description, skill.folderName, skill.rootKind, skill.scope]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

interface SkillLibraryCardProps {
  skill: SkillCatalogItem;
  isLoadingDetail: boolean;
  isDeleting: boolean;
  onEdit: (skill: SkillCatalogItem) => void;
  onDelete: (skill: SkillCatalogItem) => void;
}

const SkillLibraryCard = ({
  skill,
  isLoadingDetail,
  isDeleting,
  onEdit,
  onDelete,
}: SkillLibraryCardProps): React.JSX.Element => {
  const statusBadge = skill.isValid ? (
    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400" variant="outline">
      可用
    </Badge>
  ) : (
    <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300" variant="outline">
      需检查
    </Badge>
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white/[0.025] p-4 transition-colors hover:border-border-emphasis hover:bg-white/[0.045]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-text-muted" />
            <h3 className="truncate text-sm font-semibold text-text">{skill.name}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[11px]">
              {formatSkillRootKind(skill.rootKind)}
            </Badge>
            <Badge
              variant="outline"
              className="bg-surface-raised/60 border-border text-[11px] text-text-secondary"
            >
              {formatScope(skill.scope)}
            </Badge>
            <Badge
              variant="outline"
              className="bg-surface-raised/60 border-border text-[11px] text-text-secondary"
            >
              {getSkillAudienceLabel(skill.rootKind)}
            </Badge>
            <Badge
              variant="outline"
              className="bg-surface-raised/60 border-border text-[11px] text-text-secondary"
            >
              {formatInvocationMode(skill.invocationMode)}
            </Badge>
            {statusBadge}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onEdit(skill)}
            disabled={isLoadingDetail || isDeleting}
            title="编辑 Skill"
          >
            <Edit className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-red-300 hover:text-red-200"
            onClick={() => onDelete(skill)}
            disabled={isDeleting || isLoadingDetail}
            title="删除 Skill"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <p className="line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-text-secondary">
        {skill.description || '没有描述。'}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
        <span className="truncate">{skill.folderName}</span>
        {skill.flags.hasScripts ? <Badge variant="outline">脚本</Badge> : null}
        {skill.flags.hasReferences ? <Badge variant="outline">参考资料</Badge> : null}
        {skill.flags.hasAssets ? <Badge variant="outline">资源</Badge> : null}
        {skill.issues.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <AlertCircle className="size-3" />
            {skill.issues.length} 个提示
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const SkillsLibraryPanel = ({
  projectPath,
  projectLabel,
}: SkillsLibraryPanelProps): React.JSX.Element => {
  const fetchSkillDetail = useStore((s) => s.fetchSkillDetail);
  const deleteSkill = useStore((s) => s.deleteSkill);
  const skillDetailsById = useStore((s) => s.skillsDetailsById);
  const skillDetailLoadingById = useStore((s) => s.skillsDetailLoadingById);

  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [openingSkillId, setOpeningSkillId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);

  const loadSkills = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const nextSkills = (await api.skills?.list()) ?? [];
      setSkills(nextSkills);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载全局 Skill 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const filteredSkills = useMemo(
    () => skills.filter((skill) => matchesSearch(skill, search)),
    [skills, search]
  );

  const openCreateDialog = useCallback(() => {
    setEditorState({ mode: 'create', detail: null });
  }, []);

  const openEditDialog = useCallback(
    (skill: SkillCatalogItem) => {
      const cachedDetail = skillDetailsById[skill.id];
      if (cachedDetail) {
        setEditorState({ mode: 'edit', skillId: skill.id, detail: cachedDetail });
        return;
      }

      setOpeningSkillId(skill.id);
      setError(null);
      void fetchSkillDetail(skill.id)
        .then(() => {
          setEditorState({ mode: 'edit', skillId: skill.id, detail: null });
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : '加载 Skill 详情失败');
        })
        .finally(() => {
          setOpeningSkillId((current) => (current === skill.id ? null : current));
        });
    },
    [fetchSkillDetail, skillDetailsById]
  );

  const handleDelete = useCallback(
    (skill: SkillCatalogItem) => {
      void (async () => {
        const confirmed = await confirm({
          title: '删除 Skill',
          message: `确认删除全局 Skill「${skill.name}」？此操作会删除对应的 Skill 文件。`,
          confirmLabel: '删除',
          cancelLabel: '取消',
          variant: 'danger',
        });
        if (!confirmed) return;

        setDeletingSkillId(skill.id);
        setError(null);
        try {
          await deleteSkill({ skillId: skill.id });
          await loadSkills();
        } catch (err) {
          setError(err instanceof Error ? err.message : '删除 Skill 失败');
        } finally {
          setDeletingSkillId(null);
        }
      })();
    },
    [deleteSkill, loadSkills]
  );

  const handleSaved = useCallback(
    (_skillId: string | null) => {
      setEditorState(null);
      void loadSkills();
    },
    [loadSkills]
  );

  const editorDetail = useMemo(() => {
    if (!editorState) return null;
    if (editorState.mode === 'create') return null;
    return skillDetailsById[editorState.skillId] ?? editorState.detail;
  }, [editorState, skillDetailsById]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">全局 Skill 库</h2>
          <p className="text-xs text-text-muted">
            管理个人范围 Skill。创建和编辑会保存到全局用户范围，不会写入当前项目。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {skills.length} 个 Skill
          </Badge>
          {projectPath ? (
            <Badge variant="outline" className="font-normal text-text-muted">
              当前项目：{projectLabel ?? projectPath}
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void loadSkills()} disabled={loading}>
            <RefreshCw className={loading ? 'mr-2 size-3.5 animate-spin' : 'mr-2 size-3.5'} />
            刷新
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="mr-2 size-3.5" />
            新建 Skill
          </Button>
        </div>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索 Skill..."
        debounceMs={120}
      />

      {error ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          {error}
        </div>
      ) : null}

      {loading && skills.length === 0 ? (
        <div className="rounded-xl border border-border bg-white/[0.025] px-4 py-8 text-center text-sm text-text-muted">
          正在加载全局 Skill...
        </div>
      ) : filteredSkills.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredSkills.map((skill) => (
            <SkillLibraryCard
              key={skill.id}
              skill={skill}
              isLoadingDetail={
                openingSkillId === skill.id || Boolean(skillDetailLoadingById[skill.id])
              }
              isDeleting={deletingSkillId === skill.id}
              onEdit={openEditDialog}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-white/[0.025] px-4 py-8 text-center text-sm text-text-muted">
          {search ? '没有匹配的 Skill。' : '全局 Skill 库为空，点击“新建 Skill”创建第一个 Skill。'}
        </div>
      )}

      <SkillEditorDialog
        open={Boolean(editorState)}
        mode={editorState?.mode ?? 'create'}
        projectPath={null}
        projectLabel={projectLabel}
        detail={editorDetail}
        onClose={() => setEditorState(null)}
        onSaved={handleSaved}
      />
    </div>
  );
};
