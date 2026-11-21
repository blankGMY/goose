import { useCallback, useEffect, useRef, useState } from 'react';
import { MainPanelLayout } from '../Layout/MainPanelLayout';
import { Button } from '../ui/button';
import { RefreshCw } from 'lucide-react';
import {
  disposePoolSession,
  fetchPoolData,
  switchPoolAccount,
  type PoolAccount,
  type PoolData,
  type PoolWindow,
} from '../../acp/pool';

function formatReset(reset: number | null): string {
  if (!reset) return '—';
  return new Date(reset * 1000).toLocaleString();
}

function barColor(used: number): string {
  if (used >= 100) return 'bg-red-500';
  if (used >= 85) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function QuotaBar({ label, win }: { label: string; win: PoolWindow }) {
  const used = win.used;
  return (
    <div>
      <div className="flex justify-between text-xs text-text-secondary">
        <span>{label}</span>
        <span>
          {used === null ? '—' : `${Math.round(used)}%`} · 重置 {formatReset(win.reset)}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-background-tertiary overflow-hidden">
        <div
          className={`h-full rounded-full ${used === null ? '' : barColor(used)}`}
          style={{ width: `${used === null ? 0 : Math.min(100, Math.max(0, used))}%` }}
        />
      </div>
    </div>
  );
}

function stateBadge(account: PoolAccount): { text: string; className: string } {
  if (account.is_active) {
    return { text: '使用中', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' };
  }
  if (account.state === 'parked') {
    return { text: '已停泊', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
  }
  return { text: '待命', className: 'bg-background-tertiary text-text-secondary' };
}

export default function PoolView() {
  const [data, setData] = useState<PoolData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchPoolData();
      if (!mountedRef.current) return;
      setData(fresh);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      void disposePoolSession();
    };
  }, [load]);

  const handleSwitch = useCallback(
    async (accountId: string) => {
      setConfirmId(null);
      setSwitching(accountId);
      try {
        await switchPoolAccount(accountId);
      } catch {
        // The switch restarts goose-serve, so the call itself may drop
        // with the connection even when the switch is proceeding.
      }
      // Poll until the restarted backend answers with the new active
      // account (or give up after ~2 minutes and show what we have).
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (!mountedRef.current) return;
        try {
          const fresh = await fetchPoolData();
          if (!mountedRef.current) return;
          setData(fresh);
          setError(null);
          if (fresh.active === accountId) break;
        } catch {
          // backend still restarting; keep polling
        }
      }
      if (mountedRef.current) setSwitching(null);
    },
    []
  );

  return (
    <MainPanelLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">账号池</h1>
              <p className="text-sm text-text-secondary mt-1">
                ChatGPT 账号与订阅额度。切换账号会短暂重启后端，会话不会丢失。
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              disabled={loading || switching !== null}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>

          {error && !data && (
            <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              读不到号池数据：{error}
              <div className="mt-1 text-text-secondary">
                请确认 pool 扩展已在后端启用，然后点刷新重试。
              </div>
            </div>
          )}

          {loading && !data && (
            <div className="mt-6 text-sm text-text-secondary">正在读取账号与额度…</div>
          )}

          {switching && (
            <div className="mt-6 rounded-lg border border-border-primary bg-background-secondary px-4 py-3 text-sm text-text-primary">
              正在切换到 {switching}，后端重启中，页面会自动刷新…
            </div>
          )}

          <div className="mt-6 grid gap-4">
            {data?.accounts.map((account) => {
              const badge = stateBadge(account);
              return (
                <div
                  key={account.id}
                  className="rounded-xl border border-border-primary bg-background-secondary px-5 py-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-text-primary">{account.id}</span>
                      <span className="text-sm text-text-secondary">
                        {account.email ?? account.account}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${badge.className}`}
                      >
                        {badge.text}
                      </span>
                      {account.plan && (
                        <span className="text-xs text-text-secondary uppercase">
                          {account.plan}
                        </span>
                      )}
                    </div>
                    {!account.is_active &&
                      (confirmId === account.id ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleSwitch(account.id)}
                            disabled={switching !== null}
                          >
                            确认切换
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmId(null)}
                            disabled={switching !== null}
                          >
                            取消
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmId(account.id)}
                          disabled={switching !== null}
                        >
                          切换到此账号
                        </Button>
                      ))}
                  </div>

                  {account.state === 'parked' && account.parked_until && (
                    <div className="mt-2 text-xs text-text-secondary">
                      停泊至 {formatReset(account.parked_until)}
                      {account.park_reason ? `（${account.park_reason}）` : ''}
                    </div>
                  )}

                  <div className="mt-3 grid gap-3">
                    <QuotaBar label="5 小时额度" win={account.primary} />
                    <QuotaBar label="每周额度" win={account.secondary} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </MainPanelLayout>
  );
}
