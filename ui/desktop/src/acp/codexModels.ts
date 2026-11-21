/**
 * Extra ChatGPT Codex models the account is entitled to but Goose's
 * built-in catalog does not list yet (it stops at the GPT-5.6 family).
 * The provider accepts these ids via session config, verified against
 * the account's Codex catalog (2026-11-19) — the same list the web
 * client merges. Dedupe by id makes this a no-op once Goose ships
 * them itself.
 */
import type { ProviderInventoryModelDto } from '@aaif/goose-acp-client';

const CODEX_EXTRA_MODELS: ProviderInventoryModelDto[] = [
  { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', reasoning: true },
  { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', reasoning: true },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', reasoning: true },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', reasoning: true },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', reasoning: true },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', reasoning: true },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', reasoning: true },
  { id: 'gpt-reserve', name: 'GPT-Reserve', reasoning: true },
];

export function mergeCodexExtraModels(
  providerId: string,
  models: ProviderInventoryModelDto[]
): ProviderInventoryModelDto[] {
  if (providerId !== 'chatgpt_codex') return models;
  const known = new Set(models.map((m) => m.id));
  const extra = CODEX_EXTRA_MODELS.filter((m) => !known.has(m.id));
  return extra.length ? [...extra, ...models] : models;
}
