import { useEffect, useState } from 'react';
import { fetchPoolData, type PoolData } from '../../acp/pool';

/**
 * Compact GPT quota readout for the chat bottom bar, mirroring the web
 * client: "GPT 5h x% · 周 y%" for the pool's active account. Data comes
 * from the pool extension over ACP (no model calls). Renders nothing
 * when the pool extension is unavailable.
 */
export default function PoolQuotaBadge() {
  const [data, setData] = useState<PoolData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const d = await fetchPoolData();
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setData(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const active = data?.accounts.find((a) => a.is_active);
  if (!active || active.primary?.used == null || active.secondary?.used == null) {
    return null;
  }

  return (
    <span
      className="ml-3 text-xs text-text-primary/70 whitespace-nowrap"
      title={`${active.id}${active.email ? ` · ${active.email}` : ''}`}
    >
      GPT 5h {active.primary.used}% · 周 {active.secondary.used}%
    </span>
  );
}
