/**
 * Windows-MCP client for the standalone Assistant page.
 *
 * Fork addition, same pattern as acp/pool.ts: talks to the `windows`
 * MCP extension through the standard ACP direct tool-call path inside
 * a dedicated utility session, so the page can show and drive the PC
 * the desktop app runs on without any model call.
 */
import { callMcpAppTool } from './mcp-apps';
import { acpDeleteSession, acpNewSession } from './sessions';

const LAST_SESSION_KEY = 'goose.windows.utilitySession';

export interface WinEntry {
  name: string;
  isDir: boolean;
  size: string | null;
}

export interface ControlState {
  state: string;
  enabled: boolean;
  policy: string;
  uiBusy: boolean;
}

export interface DisplayInfo {
  index: number;
  primary: boolean;
  resolution: string;
  scale: number;
}

export interface ScreenshotResult {
  imageDataUrl: string | null;
  summary: string;
}

let utilitySessionId: string | null = null;
let creating: Promise<string> | null = null;

async function ensureWinSession(): Promise<string> {
  if (utilitySessionId) {
    return utilitySessionId;
  }
  if (!creating) {
    creating = (async () => {
      const { sessionId } = await acpNewSession('/', undefined);
      utilitySessionId = sessionId;
      // Retire the previous app run's utility session: deleting the
      // newest session would make goose-serve reuse its id for the
      // next session, which then fails tool calls ("Session not
      // found"), so a utility session is only ever deleted once a
      // newer session exists. Same pattern as acp/pool.ts.
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

export function resetWinSession(): void {
  utilitySessionId = null;
}

/** Kept for the page's unmount hook: the utility session intentionally
 * stays alive and cached (see ensureWinSession). */
export async function disposeWinSession(): Promise<void> {
  // no-op by design
}

interface ToolOutcome {
  text: string;
  imageDataUrl: string | null;
}

async function callWinOnce(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sessionId = await ensureWinSession();
  const result = await callMcpAppTool(sessionId, 'windows', name, args);
  const content = result.content as
    | Array<{ type?: string; text?: string; data?: string; mimeType?: string }>
    | undefined;
  const texts: string[] = [];
  let imageDataUrl: string | null = null;
  for (const item of content ?? []) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      texts.push(item.text);
    } else if (item?.type === 'image' && typeof item.data === 'string') {
      imageDataUrl = `data:${item.mimeType ?? 'image/png'};base64,${item.data}`;
    }
  }
  const text = texts.join('\n');
  if (result.isError) {
    throw new Error(text || `${name} failed`);
  }
  return { text, imageDataUrl };
}

async function callWin(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  // One retry on a fresh session if the cached one went stale (e.g.
  // the backend restarted).
  for (let attempt = 0; ; attempt++) {
    try {
      return await callWinOnce(name, args);
    } catch (err) {
      if (attempt >= 1) throw err;
      resetWinSession();
    }
  }
}

export async function fetchControlStatus(): Promise<ControlState> {
  const { text } = await callWin('ControlStatus', {});
  const raw = JSON.parse(text) as {
    state?: string;
    enabled?: boolean;
    policy?: string;
    ui_busy?: boolean;
  };
  return {
    state: raw.state ?? 'unknown',
    enabled: !!raw.enabled,
    policy: raw.policy ?? '',
    uiBusy: !!raw.ui_busy,
  };
}

export async function releaseControl(): Promise<void> {
  await callWin('ControlStatus', { release: true });
}

export async function fetchDisplays(): Promise<DisplayInfo[]> {
  const { text } = await callWin('DisplayInventory', {});
  const raw = JSON.parse(text) as Array<{
    index?: number;
    primary?: boolean;
    resolution?: string;
    scale?: number;
  }>;
  return raw.map((d) => ({
    index: d.index ?? 0,
    primary: !!d.primary,
    resolution: d.resolution ?? '',
    scale: d.scale ?? 1,
  }));
}

const ENTRY_RE = /^\s*\[(DIR |FILE)\]\s+(.*)$/;
const SIZE_RE = /\s+([\d.]+\s?(?:B|KB|MB|GB))$/;

export async function listDirectory(path: string): Promise<WinEntry[]> {
  const { text } = await callWin('FileSystem', { mode: 'list', path });
  const entries: WinEntry[] = [];
  for (const line of text.split('\n')) {
    const m = ENTRY_RE.exec(line);
    if (!m) continue;
    const isDir = m[1].startsWith('DIR');
    let name = m[2].trim();
    let size: string | null = null;
    if (!isDir) {
      const sm = SIZE_RE.exec(name);
      if (sm) {
        size = sm[1];
        name = name.slice(0, sm.index).trim();
      }
    }
    if (name) entries.push({ name, isDir, size });
  }
  entries.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
  );
  return entries;
}

const APPS_COMMAND =
  'Get-ChildItem "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",' +
  '"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs" -Recurse -Filter *.lnk | ' +
  'Select-Object -ExpandProperty BaseName | Sort-Object -Unique';
const APP_NOISE_PREFIX = ['卸载', '修复', '检查更新', '备份'];

export async function fetchApps(): Promise<string[]> {
  const { text } = await callWin('PowerShell', { command: APPS_COMMAND, timeout: 30 });
  const body = text.replace(/^Response:\s*/, '').replace(/\n?Status Code:.*$/s, '');
  const seen = new Set<string>();
  const apps: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const name = line.trim();
    if (!name || seen.has(name)) continue;
    if (APP_NOISE_PREFIX.some((p) => name.startsWith(p))) continue;
    seen.add(name);
    apps.push(name);
  }
  apps.sort((a, b) => a.localeCompare(b, 'zh'));
  return apps;
}

export async function launchApp(name: string): Promise<void> {
  await callWin('App', { mode: 'launch', name });
}

export async function openFolder(path: string): Promise<void> {
  await callWin('App', {
    mode: 'launch_executable',
    executable: 'explorer.exe',
    args: [path],
  });
}

export async function launchExecutable(executable: string): Promise<void> {
  await callWin('App', { mode: 'launch_executable', executable });
}

export async function captureScreenshot(): Promise<ScreenshotResult> {
  const { text, imageDataUrl } = await callWin('Screenshot', {});
  return { imageDataUrl, summary: text.trim() };
}
