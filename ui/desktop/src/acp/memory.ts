/**
 * Memory helpers for the custom MemoryView.
 *
 * Talks to the built-in `memory` extension's tools directly over ACP
 * (`_goose/unstable/tools/call`) from a dedicated utility session, so
 * viewing and editing memories costs no model calls. Mirrors the
 * pool.ts approach: the utility session is reused for the app's whole
 * lifetime and never deleted while it is the newest session (deleting
 * the newest session makes goose-serve hand its id to the next
 * session, which then fails tool calls with "Session not found").
 * The previous run's session is retired after a newer one exists.
 */
import { acpDeleteSession, acpNewSession } from './sessions';
import { callMcpAppTool } from './mcp-apps';

const LAST_SESSION_KEY = 'goose.memory.utilitySession';

export type MemoryMap = Record<string, string[]>;

const EXTENSION = 'memory';

let utilitySessionId: string | null = null;

async function getUtilitySession(): Promise<string> {
  if (utilitySessionId) return utilitySessionId;
  const session = await acpNewSession('/', undefined);
  utilitySessionId = session.sessionId;
  // Retire the previous app run's utility session (safe: no longer newest).
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
export async function closeMemorySession(): Promise<void> {
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

async function callMemoryTool(name: string, args: Record<string, unknown>): Promise<string> {
  // One retry on a fresh session if the cached one went stale (e.g.
  // the backend restarted).
  for (let attempt = 0; ; attempt++) {
    const sessionId = await getUtilitySession();
    try {
      const result = await callMcpAppTool(sessionId, EXTENSION, name, args);
      if ((result as { isError?: boolean })?.isError) {
        throw new Error(extractText(result) || `memory tool ${name} failed`);
      }
      return extractText(result);
    } catch (err) {
      if (attempt >= 1) throw err;
      utilitySessionId = null;
    }
  }
}

export async function fetchMemories(): Promise<MemoryMap> {
  const text = await callMemoryTool('retrieve_memories', {
    category: '*',
    is_global: true,
  });
  const prefix = 'Retrieved memories: ';
  const json = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const out: MemoryMap = {};
  for (const [category, entries] of Object.entries(parsed)) {
    if (Array.isArray(entries)) {
      out[category] = entries.filter((e): e is string => typeof e === 'string');
    }
  }
  return out;
}

export async function addMemory(category: string, data: string): Promise<void> {
  await callMemoryTool('remember_memory', {
    category,
    data,
    is_global: true,
    tags: [],
  });
}

export async function removeMemory(category: string, content: string): Promise<void> {
  await callMemoryTool('remove_specific_memory', {
    category,
    memory_content: content,
    is_global: true,
  });
}

export async function editMemory(
  category: string,
  oldContent: string,
  newContent: string
): Promise<void> {
  await removeMemory(category, oldContent);
  await addMemory(category, newContent);
}

export async function clearCategory(category: string): Promise<void> {
  await callMemoryTool('remove_memory_category', {
    category,
    is_global: true,
  });
}

// ---------------------------------------------------------------------------
// Memory versions (memver extension): the live store is git-versioned.
// History, restore and the nightly changelog come from the `memver`
// extension's tools over the same utility session - still no model calls.

const MEMVER_EXTENSION = 'memver';

export interface MemoryVersion {
  sha: string;
  date: string;
  message: string;
}

async function callMemverTool(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const sessionId = await getUtilitySession();
    try {
      const result = await callMcpAppTool(sessionId, MEMVER_EXTENSION, name, args);
      if ((result as { isError?: boolean })?.isError) {
        throw new Error(extractText(result) || `memver tool ${name} failed`);
      }
      const structured = (result as { structuredContent?: Record<string, unknown> })
        ?.structuredContent;
      if (structured) return structured;
      return JSON.parse(extractText(result)) as Record<string, unknown>;
    } catch (err) {
      if (attempt >= 1) throw err;
      utilitySessionId = null;
    }
  }
}

export async function fetchMemoryHistory(limit = 30): Promise<MemoryVersion[]> {
  const data = await callMemverTool('memver_history', { limit });
  return (data.versions as MemoryVersion[]) ?? [];
}

export async function restoreMemoryVersion(sha: string): Promise<void> {
  const data = await callMemverTool('memver_restore', { sha });
  if (!data.ok) {
    throw new Error(String(data.error ?? 'restore failed'));
  }
}

export async function fetchMemoryChangelog(): Promise<string> {
  const data = await callMemverTool('memver_changelog', {});
  return String(data.text ?? '');
}
