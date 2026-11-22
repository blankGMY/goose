/**
 * Pool extension client for the standalone Account Pool page.
 *
 * This file is an addition for the custom fork; it only talks to the
 * `pool` MCP extension through the standard ACP direct tool-call path
 * (the same one MCP apps use), inside a dedicated utility session. It
 * never touches chat sessions and never causes a model call.
 *
 * The utility session is created once and reused for the app's whole
 * lifetime, and it is never deleted while it is the newest session:
 * goose-serve reuses the id of a deleted newest session for the next
 * session/new, but the recreated session is not registered for tool
 * calls ("Resource not found / Session not found"). The previous
 * run's utility session is deleted only after a newer one exists,
 * which is safe. See probe_pool_cycle.py in the pool repo.
 */
import { callMcpAppTool } from './mcp-apps';
import { acpDeleteSession, acpNewSession } from './sessions';

const LAST_SESSION_KEY = 'goose.pool.utilitySession';

export interface PoolWindow {
  used: number | null;
  reset: number | null; // epoch seconds
}

export interface PoolAccount {
  id: string;
  account: string; // masked account id
  email: string | null;
  priority: number;
  state: string; // active | standby | parked
  is_active: boolean;
  park_reason: string | null;
  parked_until: number | null; // epoch seconds
  health: string | null;
  plan: string | null;
  primary: PoolWindow; // 5-hour window
  secondary: PoolWindow; // weekly window
}

export interface PoolData {
  active: string;
  accounts: PoolAccount[];
}

let utilitySessionId: string | null = null;
let creating: Promise<string> | null = null;

async function ensurePoolSession(): Promise<string> {
  if (utilitySessionId) {
    return utilitySessionId;
  }
  if (!creating) {
    creating = (async () => {
      const { sessionId } = await acpNewSession('/', undefined);
      utilitySessionId = sessionId;
      // Retire the previous app run's utility session: it is no longer
      // the newest session, so deleting it cannot poison this one.
      try {
        const prev = localStorage.getItem(LAST_SESSION_KEY);
        localStorage.setItem(LAST_SESSION_KEY, sessionId);
        if (prev && prev !== sessionId) {
          await acpDeleteSession(prev);
        }
      } catch {
        // best effort only
      }
      return sessionId;
    })();
  }
  try {
    return await creating;
  } finally {
    creating = null;
  }
}

/** Forget the utility session (e.g. after the backend restarted). */
export function resetPoolSession(): void {
  utilitySessionId = null;
}

/** Kept for the page's unmount hook: the utility session intentionally
 * stays alive and cached so returning to the page is instant and the
 * session is never deleted while newest (see the header note). */
export async function disposePoolSession(): Promise<void> {
  // no-op by design
}

function resultText(result: { content?: unknown }): string {
  const parts: string[] = [];
  const content = result.content as Array<{ type?: string; text?: string }> | undefined;
  for (const item of content ?? []) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

export async function fetchPoolData(): Promise<PoolData> {
  // One retry on a fresh session: the cached session can go stale when
  // the backend restarted (e.g. after an account switch).
  for (let attempt = 0; ; attempt++) {
    const sessionId = await ensurePoolSession();
    try {
      const result = await callMcpAppTool(sessionId, 'pool', 'pool_data', {});
      if (result.isError) {
        throw new Error(resultText(result) || 'pool_data failed');
      }
      const data = result.structuredContent as unknown as PoolData | undefined;
      if (!data || !Array.isArray(data.accounts)) {
        throw new Error('pool_data returned no account data');
      }
      return data;
    } catch (err) {
      if (attempt >= 1) throw err;
      resetPoolSession();
    }
  }
}

/**
 * Switch the active account. The pool restarts goose-serve as part of
 * the switch, so the current utility session dies with the server;
 * callers should poll fetchPoolData() afterwards until it succeeds.
 */
export async function switchPoolAccount(accountId: string): Promise<string> {
  const sessionId = await ensurePoolSession();
  const result = await callMcpAppTool(sessionId, 'pool', 'pool_switch', {
    account: accountId,
  });
  const text = resultText(result);
  if (result.isError) {
    throw new Error(text || 'pool_switch failed');
  }
  resetPoolSession();
  return text;
}
