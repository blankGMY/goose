/**
 * Skill management helpers for the custom SkillsManagerView.
 *
 * Wraps the ACP sources API (list/create/update/delete), which the
 * backend already implements; the stock desktop skills page only
 * lists. Kept separate from acp/sources.ts so upstream updates stay
 * painless.
 */
import type { SourceEntry } from '@aaif/goose-acp-client';
import { getAcpClient } from './acpConnection';
import { listSkillSources } from './sources';

export { listSkillSources };
export type { SourceEntry };

export function isSkillWritable(entry: SourceEntry): boolean {
  return entry.writable !== false && entry.type === 'skill';
}

export async function createSkill(
  name: string,
  description: string,
  content: string
): Promise<void> {
  const client = await getAcpClient();
  await client.goose.sourcesCreate_unstable({
    type: 'skill',
    name,
    description,
    content,
    target: { scope: 'global' },
  });
}

export async function updateSkill(
  entry: SourceEntry,
  name: string,
  description: string,
  content: string
): Promise<void> {
  const client = await getAcpClient();
  await client.goose.sourcesUpdate_unstable({
    type: entry.type,
    path: entry.path,
    name,
    description,
    content,
  });
}

export async function deleteSkill(entry: SourceEntry): Promise<void> {
  const client = await getAcpClient();
  await client.goose.sourcesDelete_unstable({
    type: entry.type,
    path: entry.path,
  });
}
