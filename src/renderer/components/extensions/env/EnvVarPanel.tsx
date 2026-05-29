/**
 * EnvVarPanel — manage global and project-level environment variables.
 * Auto-scans skills for required-env declarations, shows what needs to be filled.
 * Variables are injected into agent sessions via resolveAgentEnv.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';

import type { SkillEnvVarDef } from '@shared/types/extensions';

type Scope = 'global' | 'project';

interface EnvVarSource {
  name: string;
  description?: string;
  isRequired: boolean;
  from: string[];
}

interface EnvEntry {
  key: string;
  value: string;
  source?: EnvVarSource;
  isNew?: boolean;
}

export const EnvVarPanel = ({ projectPath }: { projectPath: string | null }): React.JSX.Element => {
  const [scope, setScope] = useState<Scope>('global');
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState<Record<number, boolean>>({});
  const [dirty, setDirty] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      // Load saved values
      const rawSaved: Record<string, any> =
        scope === 'global'
          ? api.credentials
            ? await api.credentials.getSkillGlobalEnv('__global__')
            : {}
          : projectPath && api.credentials
            ? await api.credentials.getProjectEnv(projectPath)
            : {};
      const saved: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawSaved)) {
        if (typeof v === 'string') saved[k] = v;
      }

      // Scan skills for required-env declarations
      const sourceMap = new Map<string, EnvVarSource>();
      if (api.skills) {
        try {
          const skills = await api.skills.list(projectPath ?? undefined);
          for (const skill of skills) {
            if (!skill.requiredEnv?.length) continue;
            for (const v of skill.requiredEnv) {
              const existing = sourceMap.get(v.name);
              if (existing) {
                existing.from.push(skill.name);
                if (v.isRequired !== false) existing.isRequired = true;
              } else {
                sourceMap.set(v.name, {
                  name: v.name,
                  description: v.description,
                  isRequired: v.isRequired !== false,
                  from: [skill.name],
                });
              }
            }
          }
        } catch {
          /* non-critical */
        }
      }

      // Merge: sources + saved values + custom entries
      const allKeys = new Set([...Object.keys(saved), ...sourceMap.keys()]);
      const parsed: EnvEntry[] = [];

      // First: required vars from skills (with source info)
      for (const [, src] of sourceMap) {
        parsed.push({
          key: src.name,
          value: saved[src.name] ?? '',
          source: src,
        });
      }

      // Then: custom saved vars not declared by any skill
      for (const key of Object.keys(saved)) {
        if (!sourceMap.has(key)) {
          parsed.push({ key, value: saved[key] });
        }
      }

      setEntries(parsed);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
      setDirty(false);
    }
  }, [scope, projectPath]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const addEntry = () => {
    setEntries((prev) => [...prev, { key: '', value: '', isNew: true }]);
    setDirty(true);
  };

  const removeEntry = (i: number) => {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const updateEntry = (i: number, field: 'key' | 'value', val: string) => {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
    setDirty(true);
  };

  const toggleShow = (i: number) => {
    setShowValues((prev) => ({ ...prev, [i]: !prev[i] }));
  };

  const handleSave = async () => {
    const vars: Record<string, string> = {};
    for (const entry of entries) {
      const key = entry.key.trim();
      if (key) {
        vars[key] = entry.value;
      }
    }

    setSaving(true);
    try {
      if (scope === 'global') {
        await api.credentials?.saveSkillGlobalEnv('__global__', vars);
      } else if (projectPath) {
        await api.credentials?.saveProjectEnv(projectPath, vars);
      }
      await loadEntries();
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  };

  const requiredEntries = entries.filter((e) => e.source?.isRequired);
  const missingRequired = requiredEntries.filter((e) => !e.value.trim());
  const filledCount = entries.filter((e) => e.key.trim() && e.value.trim()).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label className="text-sm">环境变量</Label>
          <p className="text-xs text-text-muted">
            配置运行时环境变量，启动 agent 时自动注入。
            {scope === 'global' ? '全局变量所有项目生效。' : '项目变量仅当前项目生效并可覆盖全局。'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => void loadEntries()}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">全局</SelectItem>
              <SelectItem value="project" disabled={!projectPath}>
                {projectPath ? '当前项目' : '无项目'}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-text-muted">扫描环境变量需求...</div>
      ) : (
        <>
          {/* Missing required banner */}
          {missingRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>缺少必填变量：{missingRequired.map((e) => e.key).join(', ')}</span>
            </div>
          )}

          {/* Entries */}
          <div className="space-y-3">
            {entries.map((entry, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={entry.key}
                    onChange={(e) => updateEntry(i, 'key', e.target.value)}
                    className="h-8 w-48 font-mono text-xs"
                    placeholder="ENV_VAR_NAME"
                    disabled={!!entry.source}
                  />
                  <div className="relative flex-1">
                    <Input
                      type={showValues[i] ? 'text' : 'password'}
                      value={entry.value}
                      onChange={(e) => updateEntry(i, 'value', e.target.value)}
                      className="h-8 pr-8 text-xs"
                      placeholder={entry.source?.isRequired ? '必填' : '可选'}
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow(i)}
                      className="hover:text-text-default absolute right-2 top-1/2 -translate-y-1/2 text-text-muted"
                    >
                      {showValues[i] ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-red-400 hover:bg-red-500/10"
                    onClick={() => removeEntry(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                {/* Source info */}
                {entry.source && (
                  <div className="flex items-center gap-2 pl-1 text-[11px] text-text-muted">
                    <span
                      className={`rounded px-1 py-0.5 font-medium ${
                        entry.source.isRequired
                          ? entry.value.trim()
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-red-500/10 text-red-400'
                          : 'bg-surface-raised text-text-muted'
                      }`}
                    >
                      {entry.source.isRequired ? (entry.value.trim() ? '已配置' : '必填') : '可选'}
                    </span>
                    <span>来自 {entry.source.from.join(', ')}</span>
                    {entry.source.description && <span>— {entry.source.description}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add button */}
          <Button variant="outline" size="sm" onClick={addEntry} className="h-8 gap-1.5 text-xs">
            <Plus className="size-3.5" />
            添加变量
          </Button>

          {/* Status bar */}
          {entries.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3 text-green-500" />
                {filledCount} 已配置
              </span>
              {missingRequired.length > 0 && (
                <span className="flex items-center gap-1">
                  <XCircle className="size-3 text-red-400" />
                  {missingRequired.length} 缺失
                </span>
              )}
            </div>
          )}

          {entries.length === 0 && (
            <div className="py-6 text-center text-xs text-text-muted">
              未检测到需要的环境变量。安装的 Skills 如果声明了所需变量，会自动出现在这里。
              <br />
              也可以手动添加。
            </div>
          )}

          {/* Save */}
          {dirty && (
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={loadEntries}>
                取消
              </Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
