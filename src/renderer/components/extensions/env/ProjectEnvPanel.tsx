/**
 * ProjectEnvPanel — manage project-level environment variables for Skills/MCP.
 * Scans required env vars from enabled MCP servers + Skills, shows fill status,
 * allows editing and encrypted saving.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Eye, EyeOff, Save, Shield } from 'lucide-react';

interface EnvVarEntry {
  name: string;
  isRequired: boolean;
  description?: string;
  source: string;
  value?: string;
}

interface ProjectEnvPanelProps {
  projectPath: string | null;
}

export const ProjectEnvPanel = ({ projectPath }: ProjectEnvPanelProps): React.JSX.Element => {
  const [entries, setEntries] = useState<EnvVarEntry[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const scanEnv = useCallback(async () => {
    if (!projectPath || !api.credentials) return;
    setLoading(true);
    setError(null);
    try {
      // Installed MCP entries do not carry env-var requirements (InstalledMcpEntry
      // only exposes name/scope/transport), so MCP env scanning is not available here.
      // Required env vars are sourced from skill declarations below.
      const mcpServers: {
        name: string;
        envVars?: { name: string; isRequired: boolean; description?: string };
      }[] = [];

      // Gather skills with required-env from catalog
      const skillReqs: {
        name: string;
        envVars: { name: string; isRequired?: boolean; description?: string }[];
      }[] = [];
      if (api.skills) {
        try {
          const skills = await api.skills.list(projectPath);
          for (const skill of skills) {
            const reqEnv = skill.requiredEnv ?? [];
            if (reqEnv.length > 0) {
              skillReqs.push({
                name: skill.name,
                envVars: reqEnv.map((v) => ({
                  name: v.name,
                  isRequired: v.isRequired ?? true,
                  description: v.description,
                })),
              });
            }
          }
        } catch {
          /* non-critical */
        }
      }

      const result = await api.credentials
        .scanRequired(projectPath, mcpServers, skillReqs)
        .catch(() => null);
      const required = (result as any)?.required ?? [];
      setEntries(required);

      const saved = await api.credentials
        .getProjectEnv(projectPath)
        .catch(() => ({}) as Record<string, string>);
      const initialValues: Record<string, string> = {};
      for (const entry of required) {
        initialValues[entry.name] = (saved as any)?.[entry.name] ?? entry.value ?? '';
      }
      setEditValues(initialValues);
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描环境变量失败');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void scanEnv();
  }, [scanEnv]);

  const handleSave = async () => {
    if (!projectPath || !api.credentials) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.credentials.saveProjectEnv(projectPath, editValues);
      setSuccessMsg('环境变量已加密保存');
      setTimeout(() => setSuccessMsg(null), 3000);
      await scanEnv();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleReveal = (name: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <Shield className="mb-3 size-10 opacity-40" />
        <p className="text-sm">请先选择一个项目以管理环境变量。</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <p className="text-sm">正在扫描项目所需的环境变量...</p>
      </div>
    );
  }

  const missingRequired = entries.filter((e) => e.isRequired && !editValues[e.name]?.trim());

  return (
    <div className="space-y-4 px-1">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text">项目环境变量</h3>
          <p className="text-xs text-text-muted">
            管理当前项目所需的环境变量，供 Skills 和 CLI 工具使用。值已加密存储。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void scanEnv()} disabled={loading}>
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          {successMsg}
        </div>
      )}

      {missingRequired.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          缺少必填变量：{missingRequired.map((e) => e.name).join(', ')}
        </div>
      )}

      {entries.length === 0 && !loading && (
        <div className="py-8 text-center text-xs text-text-muted">
          未检测到所需的环境变量。启用 MCP 服务器或 Skills 后会自动扫描。
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.name} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="font-mono text-xs text-text">{entry.name}</Label>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    entry.isRequired
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-surface-raised text-text-muted'
                  }`}
                >
                  {entry.isRequired ? '必填' : '可选'}
                </span>
                <span className="text-[10px] text-text-muted">来自 {entry.source}</span>
              </div>
              {entry.description && (
                <p className="text-[11px] text-text-muted">{entry.description}</p>
              )}
              <div className="flex gap-2">
                <Input
                  type={revealed.has(entry.name) ? 'text' : 'password'}
                  value={editValues[entry.name] ?? ''}
                  onChange={(e) =>
                    setEditValues((prev) => ({ ...prev, [entry.name]: e.target.value }))
                  }
                  placeholder={entry.isRequired ? '必填' : '可选'}
                  className="h-7 flex-1 font-mono text-xs"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  onClick={() => toggleReveal(entry.name)}
                >
                  {revealed.has(entry.name) ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}

          <div className="pt-2">
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              <Save className="mr-1.5 size-3.5" />
              {saving ? '保存中...' : '加密保存'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
