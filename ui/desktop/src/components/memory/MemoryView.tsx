import { useCallback, useEffect, useState } from 'react';
import { MainPanelLayout } from '../Layout/MainPanelLayout';
import { Button } from '../ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import {
  addMemory,
  clearCategory,
  closeMemorySession,
  editMemory,
  fetchMemories,
  fetchMemoryChangelog,
  fetchMemoryHistory,
  removeMemory,
  restoreMemoryVersion,
  type MemoryMap,
  type MemoryVersion,
} from '../../acp/memory';

const CATEGORY_LABELS: Record<string, string> = {
  user_preferences: '用户偏好',
  decisions: '决策记录',
  user_profile: '用户画像',
  lessons: '经验教训',
  project_facts: '项目事实',
  assistant: '助手记忆',
};

const KNOWN_CATEGORIES = Object.keys(CATEGORY_LABELS);

export default function MemoryView() {
  const [memories, setMemories] = useState<MemoryMap>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState(KNOWN_CATEGORIES[0]);
  const [newText, setNewText] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<MemoryVersion[]>([]);
  const [changelog, setChangelog] = useState('');
  const [showVersions, setShowVersions] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMemories();
      setMemories(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // Version history + nightly changelog are best-effort: the memver
    // extension may not be enabled on other backends.
    try {
      const [v, c] = await Promise.all([fetchMemoryHistory(), fetchMemoryChangelog()]);
      setVersions(v);
      setChangelog(c);
    } catch {
      setVersions([]);
      setChangelog('');
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      void closeMemorySession();
    };
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setConfirmKey(null);
      setEditingKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const categories = [
    ...KNOWN_CATEGORIES.filter((c) => c in memories || true),
    ...Object.keys(memories).filter((c) => !KNOWN_CATEGORIES.includes(c)),
  ];

  const total = Object.values(memories).reduce((n, arr) => n + arr.length, 0);

  return (
    <MainPanelLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">记忆管理</h1>
              <p className="text-sm text-text-secondary mt-1">
                Goose 的长期记忆（全局）{!loading && ` · 共 ${total} 条`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              加载失败：{error}
              <div className="mt-1 text-xs opacity-80">请确认 memory 扩展已启用。</div>
            </div>
          )}

          {changelog && (
            <div className="mt-6 rounded-lg border border-border-primary bg-background-secondary px-4 py-4">
              <div className="text-sm font-medium text-text-primary mb-2">最近一次夜间整理</div>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary max-h-56 overflow-y-auto">
                {changelog}
              </pre>
            </div>
          )}

          {versions.length > 0 && (
            <div className="mt-4 rounded-lg border border-border-primary bg-background-secondary px-4 py-4">
              <button
                type="button"
                className="text-sm font-medium text-text-primary"
                onClick={() => setShowVersions((v) => !v)}
              >
                版本历史（{versions.length}）{showVersions ? ' ▲' : ' ▼'}
              </button>
              {showVersions && (
                <div className="mt-2 space-y-1">
                  {versions.map((v) => {
                    const key = `restore:${v.sha}`;
                    return (
                      <div
                        key={v.sha}
                        className="flex items-center gap-2 text-xs text-text-secondary py-1 border-b border-border-primary/50 last:border-0"
                      >
                        <span className="shrink-0 tabular-nums">{v.date}</span>
                        <span className="flex-1 truncate" title={v.message}>
                          {v.message}
                        </span>
                        <span className="shrink-0 opacity-60">{v.sha}</span>
                        {confirmKey === key ? (
                          <>
                            <button
                              type="button"
                              className="shrink-0 text-red-500 font-medium"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await restoreMemoryVersion(v.sha);
                                })
                              }
                            >
                              确认恢复
                            </button>
                            <button
                              type="button"
                              className="shrink-0"
                              onClick={() => setConfirmKey(null)}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="shrink-0 text-text-primary"
                            disabled={busy}
                            onClick={() => setConfirmKey(key)}
                          >
                            恢复到此版本
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-text-secondary pt-1">
                    恢复前会自动存一份当前状态，恢复本身也可以再撤销。
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 rounded-lg border border-border-primary bg-background-secondary px-4 py-4">
            <div className="text-sm font-medium text-text-primary mb-2">新增记忆</div>
            <div className="flex gap-2 mb-2">
              <select
                className="rounded-md border border-border-primary bg-background-primary px-2 py-2 text-sm text-text-primary outline-none"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c] ?? c}（{c}）
                  </option>
                ))}
              </select>
            </div>
            <textarea
              className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none min-h-[72px]"
              placeholder="要记住的内容…"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
            />
            <div className="mt-2">
              <Button
                size="sm"
                disabled={busy || !newText.trim()}
                onClick={() =>
                  void run(async () => {
                    await addMemory(newCategory, newText.trim());
                    setNewText('');
                  })
                }
              >
                <Plus className="w-4 h-4 mr-1" />
                添加
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 text-sm text-text-secondary">正在加载…</div>
          ) : (
            categories.map((category) => {
              const entries = memories[category] ?? [];
              const clearKey = `clear:${category}`;
              return (
                <div key={category} className="mt-8">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-text-primary">
                      {CATEGORY_LABELS[category] ?? category}
                      <span className="ml-2 text-xs font-normal text-text-secondary">
                        {category} · {entries.length} 条
                      </span>
                    </h2>
                    {entries.length > 0 &&
                      (confirmKey === clearKey ? (
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void run(() => clearCategory(category))}
                          >
                            确认清空
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmKey(null)}
                            disabled={busy}
                          >
                            取消
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmKey(clearKey)}
                          disabled={busy}
                        >
                          清空本类
                        </Button>
                      ))}
                  </div>
                  {entries.length === 0 ? (
                    <div className="mt-2 text-sm text-text-secondary">暂无</div>
                  ) : (
                    <div className="mt-3 grid gap-2">
                      {entries.map((entry, idx) => {
                        const key = `${category}:${idx}`;
                        return (
                          <div
                            key={key}
                            className="rounded-lg border border-border-primary bg-background-secondary px-4 py-3"
                          >
                            {editingKey === key ? (
                              <div>
                                <textarea
                                  className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none min-h-[96px]"
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                />
                                <div className="mt-2 flex gap-2">
                                  <Button
                                    size="sm"
                                    disabled={busy || !editText.trim()}
                                    onClick={() =>
                                      void run(() => editMemory(category, entry, editText.trim()))
                                    }
                                  >
                                    保存
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingKey(null)}
                                    disabled={busy}
                                  >
                                    取消
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-4">
                                <div className="text-sm text-text-primary whitespace-pre-wrap break-words">
                                  {entry}
                                </div>
                                <div className="flex gap-2 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => {
                                      setEditingKey(key);
                                      setEditText(entry);
                                      setConfirmKey(null);
                                    }}
                                  >
                                    编辑
                                  </Button>
                                  {confirmKey === key ? (
                                    <>
                                      <Button
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                          void run(() => removeMemory(category, entry))
                                        }
                                      >
                                        确认删除
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setConfirmKey(null)}
                                        disabled={busy}
                                      >
                                        取消
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busy}
                                      onClick={() => setConfirmKey(key)}
                                    >
                                      删除
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </MainPanelLayout>
  );
}
