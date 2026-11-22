/**
 * Assistant page (fork addition, replaces the former console view).
 *
 * A chat front-end for the goose-bot task layer on the Pi, driven over
 * ACP through the `bot` extension (see acp/bot.ts) — the same pattern
 * as the pool and memory pages. Conversations run server-side in their
 * own sessions, so they keep working while this page is closed and can
 * be continued from here or the web client.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Send, Settings2, Square, Trash2 } from 'lucide-react';
import { MainPanelLayout } from '../Layout/MainPanelLayout';
import MarkdownContent from '../MarkdownContent';
import { Button } from '../ui/button';
import {
  botCreate,
  botDelete,
  botGet,
  botList,
  botPermission,
  botSendMessage,
  botSettingsGet,
  botSettingsSave,
  botStop,
  closeBotSession,
  type BotGoal,
  type BotSettings,
} from '../../acp/bot';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'bg-background-tertiary text-text-secondary' },
  running: { label: '执行中', className: 'bg-blue-500/15 text-blue-500' },
  waiting_confirmation: { label: '待确认', className: 'bg-amber-500/15 text-amber-500' },
  done: { label: '已完成', className: 'bg-green-500/15 text-green-600' },
  failed: { label: '失败', className: 'bg-red-500/15 text-red-500' },
  stopped: { label: '已停止', className: 'bg-background-tertiary text-text-secondary' },
  interrupted: { label: '已中断', className: 'bg-background-tertiary text-text-secondary' },
};

function formatTime(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BotView() {
  const [goals, setGoals] = useState<BotGoal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BotGoal | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await botList();
      setGoals(list);
      setError(null);
      const current = selectedIdRef.current;
      if (current) {
        setDetail(await botGet(current));
      }
    } catch (err) {
      setError(
        `读不到助手数据：${err instanceof Error ? err.message : String(err)}。请确认 bot 扩展已在后端启用，然后点刷新重试。`
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    botSettingsGet()
      .then(setSettings)
      .catch(() => {
        // settings are optional chrome; the chat itself still works
      });
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      clearInterval(timer);
      void closeBotSession();
    };
  }, [refresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [detail]);

  const selectGoal = async (id: string) => {
    setSelectedId(id);
    stickBottomRef.current = true;
    try {
      setDetail(await botGet(id));
    } catch {
      // the poll loop will surface the error
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (selectedId) {
        await botSendMessage(selectedId, text);
      } else {
        const goal = await botCreate(text);
        setSelectedId(goal.id);
      }
      setDraft('');
      stickBottomRef.current = true;
      await refresh();
    } catch (err) {
      setError(`发送失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => setConfirmingDeleteId(null), 3000);
      return;
    }
    setConfirmingDeleteId(null);
    try {
      await botDelete(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await refresh();
    } catch {
      // the poll loop will surface the error
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      setSettings(await botSettingsSave(settings));
    } catch {
      // keep the local values; the next open re-reads
    }
  };

  const status = detail ? STATUS_LABELS[detail.status] : undefined;
  const isRunning = detail?.status === 'running' || detail?.status === 'queued';

  return (
    <MainPanelLayout>
      <div className="flex flex-1 min-h-0">
        <aside className="w-72 flex-shrink-0 border-r border-border-secondary flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <h2 className="text-base font-semibold text-text-primary flex-1">助手</h2>
            <button
              type="button"
              title="刷新"
              className="rounded-full p-1 text-text-secondary hover:text-text-primary"
              onClick={() => void refresh()}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="设置"
              className="rounded-full p-1 text-text-secondary hover:text-text-primary"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
          {settingsOpen && settings && (
            <div className="mx-3 mb-2 rounded-xl border border-border-secondary p-3 flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2 text-text-secondary">
                <span className="w-14 flex-shrink-0">权限</span>
                <select
                  className="flex-1 rounded-md border border-border-secondary bg-background-primary px-2 py-1 text-text-primary"
                  value={settings.permission}
                  onChange={(e) => setSettings({ ...settings, permission: e.target.value })}
                >
                  <option value="cautious">谨慎（敏感操作先问我）</option>
                  <option value="full">完全权限（直接执行）</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-text-secondary">
                <span className="w-14 flex-shrink-0">模型</span>
                <input
                  className="flex-1 rounded-md border border-border-secondary bg-background-primary px-2 py-1 text-text-primary"
                  value={settings.model}
                  placeholder="留空 = 默认"
                  onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-text-secondary">
                <span className="w-14 flex-shrink-0">强度</span>
                <select
                  className="flex-1 rounded-md border border-border-secondary bg-background-primary px-2 py-1 text-text-primary"
                  value={settings.effort}
                  onChange={(e) => setSettings({ ...settings, effort: e.target.value })}
                >
                  <option value="">留空 = 默认</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="max">极高</option>
                </select>
              </label>
              <Button size="sm" onClick={() => void saveSettings()}>
                保存（对新对话生效）
              </Button>
            </div>
          )}
          <div className="px-3 pb-2">
            <Button
              className="w-full"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
                setDraft('');
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> 新对话
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1">
            {goals.map((goal) => {
              const st = STATUS_LABELS[goal.status];
              const active = goal.id === selectedId;
              return (
                <div
                  key={goal.id}
                  onClick={() => void selectGoal(goal.id)}
                  className={`group rounded-xl px-3 py-2 cursor-pointer ${
                    active ? 'bg-background-tertiary' : 'hover:bg-background-tertiary/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm text-text-primary">{goal.text}</span>
                    <button
                      type="button"
                      title={confirmingDeleteId === goal.id ? '再点一次确认删除' : '删除对话'}
                      className={`flex-shrink-0 rounded-full p-0.5 ${
                        confirmingDeleteId === goal.id
                          ? 'text-red-500'
                          : 'opacity-0 group-hover:opacity-100 text-text-secondary hover:text-red-500'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(goal.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {st && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${st.className}`}>
                        {st.label}
                      </span>
                    )}
                    <span className="text-[11px] text-text-tertiary">
                      {formatTime(goal.updated_at)}
                    </span>
                  </div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <div className="px-3 py-4 text-sm text-text-secondary">
                还没有对话。在右边输入第一句话开始。
              </div>
            )}
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-4"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
          >
            <div className="max-w-3xl mx-auto flex flex-col gap-3">
              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                  {error}
                </div>
              )}
              {!detail && !error && (
                <div className="text-sm text-text-secondary py-8 text-center">
                  助手在树莓派上 24 小时待命：给它发一句话，它会自己动手做完再汇报；
                  关掉这个页面也不会中断。敏感操作会先停下来等你确认。
                </div>
              )}
              {detail?.messages?.map((msg, idx) =>
                msg.role === 'user' ? (
                  <div key={idx} className="self-end max-w-[85%]">
                    <div className="rounded-2xl bg-background-tertiary px-4 py-2.5 text-sm text-text-primary whitespace-pre-wrap">
                      {msg.text}
                    </div>
                    <div className="text-right text-[11px] text-text-tertiary mt-0.5">
                      {formatTime(msg.ts)}
                    </div>
                  </div>
                ) : (
                  <div key={idx} className="self-start max-w-[85%]">
                    <div className="rounded-2xl border border-border-secondary px-4 py-2.5 text-sm text-text-primary">
                      <MarkdownContent content={msg.text} />
                    </div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">
                      {formatTime(msg.ts)}
                    </div>
                  </div>
                )
              )}
              {detail && isRunning && detail.live_text && (
                <div className="self-start max-w-[85%]">
                  <div className="rounded-2xl border border-border-secondary px-4 py-2.5 text-sm text-text-primary opacity-80">
                    <MarkdownContent content={detail.live_text} />
                  </div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">正在执行…</div>
                </div>
              )}
              {detail && detail.events.length > 0 && (
                <details className="self-start max-w-[85%] text-xs text-text-secondary">
                  <summary className="cursor-pointer py-1">执行过程（{detail.events.length}）</summary>
                  <div className="flex flex-col gap-1 py-1">
                    {detail.events.map((ev, idx) => (
                      <div key={idx} className="whitespace-pre-wrap break-all">
                        {ev.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {detail?.error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                  {detail.error}
                </div>
              )}
            </div>
          </div>

          {detail?.pending && (
            <div className="mx-6 mb-2">
              <div className="max-w-3xl mx-auto rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
                <div className="text-sm text-text-primary whitespace-pre-wrap">
                  {detail.pending.text}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {detail.pending.type === 'permission' &&
                    (detail.pending.options ?? []).map((opt) => (
                      <Button
                        key={opt.id}
                        size="sm"
                        variant={opt.kind === 'allow' ? 'default' : 'outline'}
                        onClick={() => {
                          void botPermission(detail.id, opt.id).then(() => refresh());
                        }}
                      >
                        {opt.name}
                      </Button>
                    ))}
                  {detail.pending.type !== 'permission' && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => {
                          void botSendMessage(detail.id, '确认，请执行').then(() => refresh());
                        }}
                      >
                        确认执行
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void botSendMessage(detail.id, '跳过这个操作，继续其他部分').then(
                            () => refresh()
                          );
                        }}
                      >
                        跳过
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="px-6 pb-4">
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              <textarea
                className="flex-1 rounded-2xl border border-border-secondary bg-background-primary px-4 py-2.5 text-sm text-text-primary resize-none"
                rows={2}
                value={draft}
                placeholder={
                  selectedId ? '继续对话…（Enter 发送，Shift+Enter 换行）' : '给助手发第一句话…'
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              {isRunning && detail && (
                <Button
                  variant="outline"
                  onClick={() => {
                    void botStop(detail.id).then(() => refresh());
                  }}
                >
                  <Square className="w-4 h-4 mr-1" /> 停止
                </Button>
              )}
              <Button onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
                <Send className="w-4 h-4 mr-1" /> 发送
              </Button>
            </div>
            {detail && status && (
              <div className="max-w-3xl mx-auto mt-1.5 text-[11px] text-text-tertiary">
                当前对话：{status.label}
                {detail.model ? ` · 模型 ${detail.model}` : ''}
                {detail.permission ? ` · 权限 ${detail.permission === 'full' ? '完全' : '谨慎'}` : ''}
              </div>
            )}
          </div>
        </section>
      </div>
    </MainPanelLayout>
  );
}
