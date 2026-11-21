import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MainPanelLayout } from '../Layout/MainPanelLayout';
import { Button } from '../ui/button';
import {
  AppWindow,
  ArrowUp,
  Camera,
  File as FileIcon,
  Folder,
  FolderOpen,
  Hand,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  captureScreenshot,
  disposeWinSession,
  fetchApps,
  fetchControlStatus,
  fetchDisplays,
  launchApp,
  launchExecutable,
  listDirectory,
  openFolder,
  releaseControl,
  type ControlState,
  type DisplayInfo,
  type ScreenshotResult,
  type WinEntry,
} from '../../acp/windows';

const USER_HOME = 'C:\\Users\\10547';
const QUICK_PATHS: Array<{ label: string; path: string }> = [
  { label: '桌面', path: `${USER_HOME}\\Desktop` },
  { label: '文档', path: `${USER_HOME}\\Documents` },
  { label: '下载', path: `${USER_HOME}\\Downloads` },
  { label: 'D 盘', path: 'D:\\' },
  { label: 'C 盘', path: 'C:\\' },
];

function parentOf(path: string): string | null {
  const trimmed = path.replace(/\\+$/, '');
  const idx = trimmed.lastIndexOf('\\');
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  return parent.endsWith(':') ? `${parent}\\` : parent;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('\\') ? `${dir}${name}` : `${dir}\\${name}`;
}

export default function AssistantView() {
  const [control, setControl] = useState<ControlState | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [dir, setDir] = useState<string>(QUICK_PATHS[0].path);
  const [entries, setEntries] = useState<WinEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(true);
  const [dirError, setDirError] = useState<string | null>(null);

  const [apps, setApps] = useState<string[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appFilter, setAppFilter] = useState('');
  const [launching, setLaunching] = useState<string | null>(null);
  const [appNote, setAppNote] = useState<string | null>(null);

  const [shot, setShot] = useState<ScreenshotResult | null>(null);
  const [shotAt, setShotAt] = useState<string | null>(null);
  const [shotLoading, setShotLoading] = useState(false);

  const [releasing, setReleasing] = useState(false);
  const mountedRef = useRef(true);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const [c, d] = await Promise.all([fetchControlStatus(), fetchDisplays()]);
      if (!mountedRef.current) return;
      setControl(c);
      setDisplays(d);
      setStatusError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setStatusLoading(false);
    }
  }, []);

  const loadDir = useCallback(async (path: string) => {
    setDirLoading(true);
    try {
      const list = await listDirectory(path);
      if (!mountedRef.current) return;
      setDir(path);
      setEntries(list);
      setDirError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setDirError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setDirLoading(false);
    }
  }, []);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const list = await fetchApps();
      if (!mountedRef.current) return;
      setApps(list);
    } catch {
      if (!mountedRef.current) return;
      setApps([]);
    } finally {
      if (mountedRef.current) setAppsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadStatus();
    void loadDir(QUICK_PATHS[0].path);
    void loadApps();
    return () => {
      mountedRef.current = false;
      void disposeWinSession();
    };
  }, [loadStatus, loadDir, loadApps]);

  const takeShot = useCallback(async () => {
    setShotLoading(true);
    try {
      const result = await captureScreenshot();
      if (!mountedRef.current) return;
      setShot(result);
      setShotAt(new Date().toLocaleTimeString());
    } catch (err) {
      if (!mountedRef.current) return;
      setShot({ imageDataUrl: null, summary: err instanceof Error ? err.message : String(err) });
      setShotAt(null);
    } finally {
      if (mountedRef.current) setShotLoading(false);
    }
  }, []);

  const handleLaunch = useCallback(async (name: string) => {
    setLaunching(name);
    setAppNote(null);
    try {
      await launchApp(name);
      if (mountedRef.current) setAppNote(`已打开 ${name}`);
    } catch (err) {
      if (mountedRef.current) {
        setAppNote(`打开 ${name} 失败：${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (mountedRef.current) setLaunching(null);
    }
  }, []);

  const handleRelease = useCallback(async () => {
    setReleasing(true);
    try {
      await releaseControl();
      if (mountedRef.current) void loadStatus();
    } finally {
      if (mountedRef.current) setReleasing(false);
    }
  }, [loadStatus]);

  const filteredApps = useMemo(() => {
    const q = appFilter.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.toLowerCase().includes(q));
  }, [apps, appFilter]);

  const parent = parentOf(dir);
  const primaryDisplay = displays.find((d) => d.primary) ?? displays[0];

  return (
    <MainPanelLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">助手</h1>
              <p className="text-sm text-text-secondary mt-1">
                这台电脑的控制台。看文件、开软件、看屏幕，不用经过对话，直接点。
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadStatus();
                void loadDir(dir);
              }}
              disabled={statusLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${statusLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>

          {statusError ? (
            <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              连不上这台电脑的控制通道：{statusError}
              <div className="mt-1 text-text-secondary">
                请确认 windows 扩展已启用、电脑上的 windows-mcp 服务在运行，然后点刷新重试。
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-secondary">
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    control?.enabled ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-text-primary">
                  {control ? (control.enabled ? '控制通道已就绪' : '控制通道未启用') : '正在连接…'}
                </span>
                {control && <span>状态 {control.state} · 策略 {control.policy}</span>}
              </span>
              {primaryDisplay && (
                <span>
                  显示器 {primaryDisplay.resolution} · 缩放{' '}
                  {Math.round(primaryDisplay.scale * 100)}%
                  {displays.length > 1 ? ` · 共 ${displays.length} 台` : ''}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleRelease()}
                disabled={releasing || !control}
                className="flex items-center gap-1 text-text-secondary hover:text-text-primary disabled:opacity-50"
                title="把桌面控制权交还给你本人"
              >
                <Hand className="w-3.5 h-3.5" />
                {releasing ? '交还中…' : '交还控制'}
              </button>
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
            <section className="rounded-xl border border-border-primary bg-background-secondary px-5 py-4 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium text-text-primary">文件</h2>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {QUICK_PATHS.map((q) => (
                    <button
                      key={q.path}
                      type="button"
                      onClick={() => void loadDir(q.path)}
                      className={`text-xs px-2 py-1 rounded-full ${
                        dir === q.path
                          ? 'bg-background-tertiary text-text-primary'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => parent && void loadDir(parent)}
                  disabled={!parent || dirLoading}
                  className="flex items-center gap-1 text-text-secondary hover:text-text-primary disabled:opacity-40"
                >
                  <ArrowUp className="w-4 h-4" />
                  上级
                </button>
                <span className="text-text-primary break-all">{dir}</span>
                {dirLoading && <span className="text-text-secondary">读取中…</span>}
              </div>
              {dirError ? (
                <div className="mt-3 text-sm text-red-600 dark:text-red-400">
                  读不到这个文件夹：{dirError}
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-border-primary/60">
                  {entries.map((entry) => (
                    <li key={entry.name}>
                      {entry.isDir ? (
                        <button
                          type="button"
                          onClick={() => void loadDir(joinPath(dir, entry.name))}
                          className="w-full flex items-center gap-2.5 py-1.5 text-left text-sm text-text-primary hover:bg-background-tertiary/60 rounded px-1.5"
                        >
                          <Folder className="w-4 h-4 shrink-0 text-text-secondary" />
                          <span className="truncate">{entry.name}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2.5 py-1.5 text-sm px-1.5">
                          <FileIcon className="w-4 h-4 shrink-0 text-text-secondary" />
                          <span className="truncate text-text-primary">{entry.name}</span>
                          {entry.size && (
                            <span className="ml-auto text-xs text-text-secondary shrink-0">
                              {entry.size}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                  {!dirLoading && entries.length === 0 && (
                    <li className="py-3 text-sm text-text-secondary">这个文件夹是空的。</li>
                  )}
                </ul>
              )}
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openFolder(dir)}
                >
                  <FolderOpen className="w-4 h-4 mr-1" />
                  在资源管理器中打开
                </Button>
              </div>
            </section>

            <div className="grid gap-6 content-start">
              <section className="rounded-xl border border-border-primary bg-background-secondary px-5 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-text-primary">屏幕</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void takeShot()}
                    disabled={shotLoading}
                  >
                    <Camera className="w-4 h-4 mr-1" />
                    {shotLoading ? '截屏中…' : '看当前屏幕'}
                  </Button>
                </div>
                {shot?.imageDataUrl ? (
                  <div className="mt-3">
                    <img
                      src={shot.imageDataUrl}
                      alt="当前屏幕截图"
                      className="w-full rounded-lg border border-border-primary"
                    />
                    <div className="mt-2 text-xs text-text-secondary">
                      {shotAt} 截取 · 这是助手现在看到的画面
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-secondary">
                    {shot ? shot.summary.slice(0, 200) : '点一下按钮，看这台电脑现在的屏幕。'}
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-border-primary bg-background-secondary px-5 py-4">
                <h2 className="font-medium text-text-primary">快捷操作</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openFolder(`${USER_HOME}\\Desktop`)}
                  >
                    打开桌面
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void openFolder('D:\\')}>
                    打开 D 盘
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void launchExecutable('Taskmgr.exe')}
                  >
                    任务管理器
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void launchExecutable('notepad.exe')}
                  >
                    记事本
                  </Button>
                </div>
              </section>

              <section className="rounded-xl border border-border-primary bg-background-secondary px-5 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-text-primary">软件</h2>
                  <span className="text-xs text-text-secondary">
                    {appsLoading ? '读取中…' : `${filteredApps.length} 个`}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border-primary px-2.5 py-1.5">
                  <Search className="w-4 h-4 text-text-secondary shrink-0" />
                  <input
                    value={appFilter}
                    onChange={(e) => setAppFilter(e.target.value)}
                    placeholder="搜软件名"
                    className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
                  />
                </div>
                {appNote && <div className="mt-2 text-xs text-text-secondary">{appNote}</div>}
                <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-border-primary/60">
                  {filteredApps.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => void handleLaunch(name)}
                        disabled={launching !== null}
                        className="w-full flex items-center gap-2.5 py-1.5 px-1.5 text-left text-sm text-text-primary hover:bg-background-tertiary/60 rounded disabled:opacity-50"
                      >
                        <AppWindow className="w-4 h-4 shrink-0 text-text-secondary" />
                        <span className="truncate">{name}</span>
                        <span className="ml-auto text-xs text-text-secondary shrink-0">
                          {launching === name ? '打开中…' : '打开'}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!appsLoading && filteredApps.length === 0 && (
                    <li className="py-3 text-sm text-text-secondary">没有匹配的软件。</li>
                  )}
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>
    </MainPanelLayout>
  );
}
