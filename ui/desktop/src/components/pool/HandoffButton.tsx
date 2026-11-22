import { useState } from 'react';
import { useAcpChatSessionSnapshot } from '../../acp/chatSessionStore';
import { acpChatSessionController } from '../../acp/chatSessionController';
import { botHandoffPackage, botHandoffStatus, type HandoffStatus } from '../../acp/bot';
import { useModelAndProvider } from '../ModelAndProviderContext';
import { AppEvents } from '../../constants/events';
import { ChatState } from '../../types/chatState';
import { Button } from '../ui/button';

/**
 * Session handoff for the desktop chat (workspace-owned, like the web
 * UI): the bot service only *generates* a handoff package for the
 * current session; this component previews/edits it and creates the
 * successor session in the same workspace, reusing the fork
 * navigation flow (SESSION_FORKED + initialMessage) so the seed is
 * submitted as the new session's first message. The old session is
 * left untouched.
 *
 * Window policy mirrors bot_handoff: the GPT family is metered
 * against the 272K billing line, not the catalog window.
 */
function policyWindow(modelId: string): number {
  const m = (modelId || '').toLowerCase();
  if (m.startsWith('gpt-4')) return 128000;
  if (m.startsWith('gpt-')) return 272000;
  if (m.startsWith('deepseek')) return 128000;
  if (m.startsWith('claude')) return 200000;
  return 128000;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface HandoffButtonProps {
  sessionId: string | null;
  sessionModel?: string | null;
  sessionProvider?: string | null;
}

export default function HandoffButton({
  sessionId,
  sessionModel,
  sessionProvider,
}: HandoffButtonProps) {
  const snapshot = useAcpChatSessionSnapshot(sessionId ?? '');
  const { changeModel } = useModelAndProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seed, setSeed] = useState('');
  const [meta, setMeta] = useState<HandoffStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!sessionId) return null;

  const used = snapshot?.tokenState.inputTokens ?? 0;
  const ratio = used ? used / policyWindow(sessionModel ?? '') : 0;
  const suggested = ratio >= 0.75;
  const chatBusy =
    !!snapshot &&
    snapshot.chatState !== ChatState.Idle &&
    snapshot.chatState !== ChatState.WaitingForUserInput;

  async function startHandoff() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError('');
    setMeta(null);
    try {
      const { job } = await botHandoffPackage(sessionId);
      const deadline = Date.now() + 120000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await botHandoffStatus(job);
        if (st.state === 'done') {
          setMeta(st);
          setSeed(st.seed ?? '');
          setOpen(true);
          setBusy(false);
          return;
        }
        if (st.state === 'error') throw new Error(st.error || '生成失败');
        if (Date.now() > deadline) throw new Error('生成超时，请重试');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpen(true);
      setBusy(false);
    }
  }

  async function confirmHandoff() {
    const cur = snapshot?.session;
    const edited = seed.trim();
    if (!cur || !edited || confirming) return;
    setConfirming(true);
    try {
      const session = await acpChatSessionController.createSession(cur.working_dir, undefined);
      if (sessionModel && sessionProvider) {
        try {
          await changeModel(session.id, { name: sessionModel, provider: sessionProvider });
        } catch {
          // keep the new session's default model
        }
      }
      setOpen(false);
      window.dispatchEvent(
        new CustomEvent(AppEvents.SESSION_FORKED, {
          detail: {
            newSessionId: session.id,
            shouldStartAgent: true,
            editedMessage: edited,
            editedImages: [],
          },
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void startHandoff()}
        disabled={busy || chatBusy}
        title={
          suggested
            ? '上下文占用已过 75%，建议交接到新会话'
            : '交接到新会话（生成交接包，在同一工作区继续）'
        }
        className={`text-xs px-2 py-1 rounded-md border transition-colors ${
          suggested
            ? 'border-amber-500 text-amber-500 font-semibold'
            : 'border-border-primary text-text-secondary hover:text-text-default'
        } disabled:opacity-50`}
      >
        {busy ? '生成中…' : '交接'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background-primary border border-border-primary rounded-lg shadow-lg w-[680px] max-w-[92vw] max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline gap-3 px-4 py-3 border-b border-border-subtle flex-wrap">
              <h3 className="text-sm font-medium text-text-default">会话交接</h3>
              {meta && (
                <span className="text-xs text-text-secondary">
                  占用 {formatTokens(meta.occupancy ?? 0)} / {formatTokens(meta.window ?? 0)} ·
                  交接包约 {meta.tokens} token · 摘要 {meta.l4_by}
                </span>
              )}
            </div>
            <div className="px-4 py-3 flex flex-col gap-2 overflow-hidden">
              {error ? (
                <p className="text-sm text-red-500 m-0">{error}</p>
              ) : (
                <textarea
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  rows={16}
                  spellCheck={false}
                  className="w-full flex-1 min-h-[220px] resize-y font-mono text-xs leading-relaxed bg-background-secondary border border-border-primary rounded-md p-2 text-text-default"
                />
              )}
              <p className="text-xs text-text-secondary m-0">
                确认后将在同一工作区新建会话，并把这份交接记录作为第一条消息发过去；当前会话保留，可随时切回。
              </p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              {!error && (
                <Button onClick={() => void confirmHandoff()} disabled={confirming}>
                  {confirming ? '创建中…' : '在新会话继续'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
