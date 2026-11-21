/**
 * Memory helpers for the custom MemoryView.
 *
 * Talks to the built-in `memory` extension's tools directly over ACP
 * (`_goose/unstable/tools/call`) from a dedicated utility session, so
 * viewing and editing memories costs no model calls. Mirrors the
 * pool.ts approach; sessions created here are closed and deleted on
 * page unmount so they never appear in the user's history.
 */
import { acpCloseSession, acpDeleteSession, acpNewSession } from './sessions';
import { callMcpAppTool } from './mcp-apps';

export type MemoryMap = Record<string, string[]>;

const EXTENSION = 'memory';

let utilitySessionId: string | null = null;

async function getUtilitySession(): Promise<string> {
  if (utilitySessionId) return utilitySessionId;
  const session = await acpNewSession('/', undefined);
  utilitySessionId = session.sessionId;
  return utilitySessionId;
}

export async function closeMemorySession(): Promise<void> {
  if (!utilitySessionId) return;
  const id = utilitySessionId;
  utilitySessionId = null;
  try {
    await acpCloseSession(id);
    await acpDeleteSession(id);
  } catch {
    // best effort cleanup
  }
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
  const sessionId = await getUtilitySession();
  const result = await callMcpAppTool(sessionId, EXTENSION, name, args);
  if ((result as { isError?: boolean })?.isError) {
    throw new Error(extractText(result) || `memory tool ${name} failed`);
  }
  return extractText(result);
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
