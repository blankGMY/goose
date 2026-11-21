import { useEffect, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DEFAULT_EXTRA_MODELS,
  fetchRawProviderModels,
  loadModelDisplayPrefs,
  saveModelDisplayPrefs,
  type ModelDisplayPrefs,
} from '../../acp/codexModels';

/**
 * Lets the user choose which models the ChatGPT Codex picker shows:
 * catalog models can be hidden, the newer extra models can be toggled,
 * and custom model ids can be added. Preferences persist in
 * localStorage and apply the next time the model picker opens.
 */
export default function ModelDisplaySettings() {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<ModelDisplayPrefs>(() => loadModelDisplayPrefs());
  const [newId, setNewId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrefs(loadModelDisplayPrefs());
    setLoading(true);
    fetchRawProviderModels('chatgpt_codex')
      .then((models) => setCatalog(models.map((m) => m.id)))
      .catch(() => setCatalog([]))
      .finally(() => setLoading(false));
  }, [open ]);

  const toggleHidden = (id: string) =>
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(id) ? p.hidden.filter((h) => h !== id) : [...p.hidden, id],
    }));

  const toggleExtra = (id: string) =>
    setPrefs((p) => ({
      ...p,
      disabledExtras: p.disabledExtras.includes(id)
        ? p.disabledExtras.filter((h) => h !== id)
        : [...p.disabledExtras, id],
    }));

  const addCustom = () => {
    const id = newId.trim();
    if (!id) return;
    setPrefs((p) =>
      p.customs.some((c) => c.id === id) ? p : { ...p, customs: [...p.customs, { id, name: id }] }
    );
    setNewId('');
  };

  const removeCustom = (id: string) =>
    setPrefs((p) => ({ ...p, customs: p.customs.filter((c) => c.id !== id) }));

  const handleSave = () => {
    saveModelDisplayPrefs(prefs);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label="选择显示的模型"
        title="选择显示的模型"
        className="ml-2 text-text-primary/60 hover:text-text-primary transition-colors"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background-primary border border-border-primary rounded-lg shadow-lg w-[440px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
              <h3 className="text-sm font-medium text-text-primary">选择显示的模型（ChatGPT Codex）</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-text-secondary hover:text-text-primary text-lg leading-none"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <h4 className="text-xs font-medium text-text-secondary mb-2">扩展模型（账号可用、官方目录未收录）</h4>
              <div className="grid gap-1.5">
                {DEFAULT_EXTRA_MODELS.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={!prefs.disabledExtras.includes(m.id)}
                      onChange={() => toggleExtra(m.id)}
                    />
                    <span className="truncate">
                      {m.name} <span className="text-text-secondary text-xs">{m.id}</span>
                    </span>
                  </label>
                ))}
                {prefs.customs.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={!prefs.hidden.includes(m.id)}
                      onChange={() => toggleHidden(m.id)}
                    />
                    <span className="truncate flex-1">
                      {m.id} <span className="text-text-secondary text-xs">自定义</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`删除 ${m.id}`}
                      className="text-text-secondary hover:text-red-500"
                      onClick={() => removeCustom(m.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border-primary bg-background-secondary px-3 py-1.5 text-sm text-text-primary outline-none"
                  placeholder="添加模型 id，如 gpt-6.2-sol"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustom();
                  }}
                />
                <Button size="sm" variant="outline" onClick={addCustom} disabled={!newId.trim()}>
                  添加
                </Button>
              </div>

              <h4 className="text-xs font-medium text-text-secondary mt-5 mb-2">官方目录模型</h4>
              {loading ? (
                <div className="text-sm text-text-secondary">正在加载…</div>
              ) : catalog.length === 0 ? (
                <div className="text-sm text-text-secondary">未取得目录（后端未连接时为空）</div>
              ) : (
                <div className="grid gap-1.5">
                  {catalog.map((id) => (
                    <label key={id} className="flex items-center gap-2 text-sm text-text-primary">
                      <input
                        type="checkbox"
                        checked={!prefs.hidden.includes(id)}
                        onChange={() => toggleHidden(id)}
                      />
                      <span className="truncate">{id}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-text-secondary">
                保存后，下次打开切换模型窗口时生效。
              </p>
            </div>
            <div className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleSave}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
