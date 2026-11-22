/**
 * Assistant (goose-bot) helpers for the desktop assistant page.
 *
 * Talks to the Pi's `bot` MCP extension over ACP from a dedicated
 * utility session, so driving the assistant costs no model calls. The
 * extension is a thin face on the goose-bot task layer (127.0.0.1:8084
 * on the Pi), which runs each conversation in its own server-side
 * session: conversations keep working while this page is closed.
 *
 * Utility-session handling mirrors pool.ts / memory.ts: the session is
 * reused for the app's whole lifetime and never deleted while it is
 * the newest session (deleting the newest session makes goose-serve
 * hand its id to the next session, which then fails tool calls with
 * "Session not found"). The previous run's session is retired after a
 * newer one exists.
 */
import { acpDeleteSession, acpNewSession } from './sessions';
import { callMcpAppTool } from './mcp-apps';

const LAST_SESSION_KEY = 'goose.bot.utilitySession';

const EXTENSION = 'bot';

export interface BotGoalEvent {
  ts: number;
  kind: string;
  text: string;
}

export interface BotPending {
  type: string;
  text: string;
  options?: { id: string; name: string; kind: string }[];
}

export interface BotMessage {
  role: string;
  text: string;
  ts: number;
}

export interface BotGoal {
  id: string;
  text: string;
  status: string;
  created_at: number;
  updated_at: number;
  session_id: string | null;
  model: string;
  effort: string;
  permission: string;
  report: string;
  live_text: string;
  pending: BotPending | null;
  error: string | null;
  events: BotGoalEvent[];
  messages?: BotMessage[];
}

export interface BotSettings {
  permission: string;
  model: string;
  effort: string;
}

let utilitySessionId: string | null = null;

async function getUtilitySession(): Promise<string> {
  if (utilitySessionId) return utilitySessionId;
  const session = await acpNewSession('/', undefined);
  utilitySessionId = session.sessionId;
  try {
    const prev = localStorage.getItem(LAST_SESSION_KEY);
    localStorage.setItem(LAST_SESSION_KEY, utilitySessionId);
    if (prev && prev !== utilitySessionId) {
      await acpDeleteSession(prev);
    }
  } catch {
    // best effort only
  }
  return utilitySessionId;
}

/** Kept for the page's unmount hook: the utility session intentionally
 * stays alive and cached (see the header note). */
export async function closeBotSession(): Promise<void> {
  // no-op by design
}

function extractText(result: unknown): string {
  const content = (result as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        !!item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string'
    )
    .map((item) => item.text)
    .join('');
}

async function callBotTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  // One retry on a fresh session if the cached one went stale (e.g.
  // the backend restarted).
  for (let attempt = 0; ; attempt++) {
    const sessionId = await getUtilitySession();
    try {
      const result = await callMcpAppTool(sessionId, EXTENSION, name, args);
      if ((result as { isError?: boolean })?.isError) {
        throw new Error(extractText(result) || `bot tool ${name} failed`);
      }
      const structured = (result as { structuredContent?: unknown })?.structuredContent;
      if (structured !== undefined) {
        return structured as T;
      }
      return JSON.parse(extractText(result)) as T;
    } catch (err) {
      if (attempt >= 1) throw err;
      utilitySessionId = null;
    }
  }
}

export async function botList(): Promise<BotGoal[]> {
  const data = await callBotTool<{ goals: BotGoal[] }>('bot_list', {});
  return data.goals ?? [];
}

export async function botGet(id: string): Promise<BotGoal> {
  const data = await callBotTool<{ goal: BotGoal }>('bot_get', { id });
  return data.goal;
}

export async function botCreate(text: string): Promise<BotGoal> {
  const data = await callBotTool<{ goal: BotGoal }>('bot_create', { text });
  return data.goal;
}

export async function botSendMessage(id: string, text: string): Promise<void> {
  await callBotTool('bot_message', { id, text });
}

export async function botPermission(id: string, optionId: string): Promise<void> {
  await callBotTool('bot_permission', { id, option_id: optionId });
}

export async function botStop(id: string): Promise<void> {
  await callBotTool('bot_stop', { id });
}

export async function botDelete(id: string): Promise<void> {
  await callBotTool('bot_delete', { id });
}

export async function botSettingsGet(): Promise<BotSettings> {
  const data = await callBotTool<{ settings: BotSettings }>('bot_settings_get', {});
  return data.settings;
}

export async function botSettingsSave(settings: Partial<BotSettings>): Promise<BotSettings> {
  const data = await callBotTool<{ settings: BotSettings }>('bot_settings_save', {
    ...settings,
  });
  return data.settings;
}

export interface HandoffStatus {
  state: string;
  seed?: string;
  tokens?: number;
  occupancy?: number;
  window?: number;
  ratio?: number;
  l4_by?: string;
  error?: string;
}

/** Start generating a handoff package for any session (interactive or
 * bot). The bot service only generates the package; the caller owns
 * the session lifecycle (preview + successor creation). */
export async function botHandoffPackage(
  sessionId: string
): Promise<{ job: string; state: string }> {
  return callBotTool('bot_handoff_package', { session_id: sessionId });
}

export async function botHandoffStatus(job: string): Promise<HandoffStatus> {
  return callBotTool('bot_handoff_status', { job });
}
