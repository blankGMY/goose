import { useCallback, useEffect, useMemo, useState } from 'react';
import { MainPanelLayout } from '../Layout/MainPanelLayout';
import { Button } from '../ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import {
  createSkill,
  deleteSkill,
  isSkillWritable,
  listSkillSources,
  updateSkill,
  type SourceEntry,
} from '../../acp/skills';
import { getInitialWorkingDir } from '../../utils/workingDir';

interface Draft {
  name: string;
  description: string;
  content: string;
}

const EMPTY_DRAFT: Draft = { name: '', description: '', content: '' };

// Skills the agent created itself carry "origin: auto" in their
// frontmatter; the nightly job may optimize or delete only those.
function isAutoSkill(skill: { content?: string }): boolean {
  return /^origin:\s*auto\s*$/m.test(skill.content ?? '');
}

export default function SkillsManagerView() {
  const [skills, setSkills] = useState<SourceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const entries = await listSkillSources(getInitialWorkingDir());
      setSkills(entries);
      setError(null);
      setSelectedPath((prev) =>
        prev && entries.some((e) => e.path === prev) ? prev : (entries[0]?.path ?? null)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [skills, search]);

  const selected = skills.find((s) => s.path === selectedPath) ?? null;
  const writable = selected ? isSkillWritable(selected) : false;

  const startEdit = () => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      description: selected.description,
      content: selected.content,
    });
    setCreating(false);
    setEditing(true);
    setConfirmDelete(false);
  };

  const startCreate = () => {
    setDraft({
      ...EMPTY_DRAFT,
      content: '---\nname: new-skill\ndescription: \n---\n\n',
    });
    setCreating(true);
    setEditing(true);
    setConfirmDelete(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (creating) {
        await createSkill(draft.name.trim(), draft.description.trim(), draft.content);
      } else if (selected) {
        await updateSkill(selected, draft.name.trim(), draft.description.trim(), draft.content);
      }
      setEditing(false);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await deleteSkill(selected);
      setConfirmDelete(false);
      setSelectedPath(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainPanelLayout>
      <div className="flex-1 flex min-h-0">
        <div className="w-72 shrink-0 border-r border-border-primary flex flex-col">
          <div className="px-4 py-4 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-text-primary">技能管理</h1>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="ghost" size="sm" onClick={startCreate}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="px-4 pb-3">
            <input
              className="w-full rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary outline-none"
              placeholder="搜索技能…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loading && <div className="px-2 py-3 text-sm text-text-secondary">正在加载…</div>}
            {!loading && filtered.length === 0 && (
              <div className="px-2 py-3 text-sm text-text-secondary">没有技能</div>
            )}
            {filtered.map((skill) => (
              <button
                key={skill.path}
                className={`w-full text-left rounded-lg px-3 py-2 mb-1 ${
                  skill.path === selectedPath && !creating
                    ? 'bg-background-tertiary'
                    : 'hover:bg-background-secondary'
                }`}
                onClick={() => {
                  setSelectedPath(skill.path);
                  setEditing(false);
                  setCreating(false);
                  setConfirmDelete(false);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">
                    {skill.name}
                  </span>
                  {skill.type === 'builtinSkill' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-background-tertiary text-text-secondary">
                      内置
                    </span>
                  )}
                  {!isSkillWritable(skill) && skill.type === 'skill' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-background-tertiary text-text-secondary">
                      只读
                    </span>
                  )}
                  {isAutoSkill(skill) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                      自动维护
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-secondary truncate mt-0.5">
                  {skill.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6">
            {error && (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {editing ? (
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  {creating ? '新建技能' : `编辑技能：${selected?.name ?? ''}`}
                </h2>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs text-text-secondary">名称</span>
                    <input
                      className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary outline-none"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-text-secondary">描述</span>
                    <input
                      className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary outline-none"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-text-secondary">SKILL.md 内容</span>
                    <textarea
                      className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary outline-none font-mono min-h-[380px]"
                      value={draft.content}
                      onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    />
                  </label>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => void handleSave()} disabled={saving || !draft.name.trim()}>
                    {saving ? '保存中…' : '保存'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setCreating(false);
                    }}
                    disabled={saving}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : selected ? (
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-text-primary">{selected.name}</h2>
                    <p className="text-sm text-text-secondary mt-1">{selected.description}</p>
                    <p className="text-xs text-text-secondary mt-1 break-all">{selected.path}</p>
                  </div>
                  {writable && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={startEdit}>
                        编辑
                      </Button>
                      {confirmDelete ? (
                        <>
                          <Button size="sm" onClick={() => void handleDelete()} disabled={saving}>
                            确认删除
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmDelete(false)}
                            disabled={saving}
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmDelete(true)}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <pre className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-border-primary bg-background-secondary px-4 py-3 text-sm text-text-primary font-mono">
                  {selected.content}
                </pre>
              </div>
            ) : (
              <div className="text-sm text-text-secondary">
                从左侧选择一个技能查看内容，或点 + 新建。
              </div>
            )}
          </div>
        </div>
      </div>
    </MainPanelLayout>
  );
}
