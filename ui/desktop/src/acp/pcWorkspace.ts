/**
* PC workspace mapping for the custom fork.
*
* The desktop app talks to a goose-serve running on the Raspberry Pi,
* whose session cwd must be a Linux path — but the user's projects live
* on this PC. When the user picks a Windows folder as a session's
* working directory, the ACP layer substitutes a valid Pi-side cwd and
* remembers the real folder here. The next prompt sent in that session
* is prefixed with a short briefing (see acp/prompt.ts) telling the
* agent the project lives on the PC — use the windows extension for
* files and this path as the delegation workdir — so the folder
* behaves like a real workspace.
*/
const STORAGE_KEY = 'goose.pcWorkspaces.v1';

/** Pi-side cwd used in place of a Windows path; always exists. */
export const PC_FALLBACK_CWD = '/home/gmy';

export interface PcWorkspaceEntry {
path: string;
/** The path value the agent has already been briefed about. */
briefedPath: string | null;
}

type PcWorkspaceMap = Record<string, PcWorkspaceEntry>;

export function isWindowsAbsPath(p: string): boolean {
return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

function loadMap(): PcWorkspaceMap {
try {
const raw = localStorage.getItem(STORAGE_KEY);
if (!raw) return {};
const parsed = JSON.parse(raw) as PcWorkspaceMap;
return parsed && typeof parsed === 'object'? parsed: {};
} catch {
return {};
}
}

function saveMap(map: PcWorkspaceMap): void {
try {
localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
} catch {
// storage full/blocked: the feature degrades to Pi-side dirs only
}
}

export function setPcWorkspace(sessionId: string, path: string): void {
const map = loadMap();
const existing = map[sessionId];
map[sessionId] = {
path,
briefedPath: existing && existing.path === path? existing.briefedPath: null,
};
saveMap(map);
}

export function getPcWorkspace(sessionId: string): PcWorkspaceEntry | null {
return loadMap()[sessionId]?? null;
}

export function clearPcWorkspace(sessionId: string): void {
const map = loadMap();
if (sessionId in map) {
delete map[sessionId];
saveMap(map);
}
}

export function markPcWorkspaceBriefed(sessionId: string): void {
const map = loadMap();
const entry = map[sessionId];
if (entry) {
entry.briefedPath = entry.path;
saveMap(map);
}
}

export function pcWorkspaceBriefing(path: string): string {
return [
`本会话的工作区是用户电脑上的文件夹：${path}`,
'项目文件都在这台电脑上：读写文件、搜索、跑命令一律用 windows 扩展完成，以该目录为根目录，相对路径都相对于它；不要用树莓派本地的文件工具碰这个项目。',
'编程任务按既定委派政策办：委派 Codex 时，task.json 的 workdir 必须填这个路径。',
'动手前先用 windows 的 FileSystem（mode=list）看一眼该目录的内容再开始。',
'---',
].join('\n');
}
