/**
 * Pool extension client for the standalone Account Pool page.
 *
 * This file is an addition for the custom fork; it only talks to the
 * `pool` MCP extension through the standard ACP direct tool-call path
 * (the same one MCP apps use), inside a dedicated utility session that
 * the page creates on mount and deletes on unmount. It never touches
 * chat sessions and never causes a model call.
 */
import { callMcpAppTool } from './mcp-apps';
import { acpCloseSession, acpDeleteSession, acpNewSession } from './sessions';

export interface PoolWindow {
  used: number | null;
  reset: number | null; // epoch seconds
}

export interface PoolAccount {
  id: string;
  account: string; // masked account id
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

/** Close and delete the utility session so it leaves no history behind. */
export async function disposePoolSession(): Promise<void> {
  const sessionId = utilitySessionId;
  utilitySessionId = null;
  if (!sessionId) {
    return;
  }
  try {
    await acpCloseSession(sessionId);
  } catch {
    // best effort only
  }
  try {
    await acpDeleteSession(sessionId);
  } catch {
    // best effort only
  }
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
  const sessionId = await ensurePoolSession();
  const result = await callMcpAppTool(sessionId, 'pool', 'pool_data', {});
  if (result.isError) {
    throw new Error(resultText(result) || 'pool_data failed');
  }
  const data = result.structuredContent as unknown as PoolData | undefined;
  if (!data || !Array.isArray(data.accounts)) {
    throw new Error('pool_data returned no account data');
  }
  return data;
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
