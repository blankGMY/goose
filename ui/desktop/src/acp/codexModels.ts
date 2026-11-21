/**
 * User-controlled model picker contents for the ChatGPT Codex provider.
 *
 * Goose's built-in catalog stops at the GPT-5.6 family, but the provider
 * accepts any model id the account is entitled to (verified via session
 * set_config_option). This module merges the account's newer models into
 * the picker list and lets the user decide what is shown: catalog models
 * can be hidden, extra models can be toggled, and arbitrary custom ids
 * can be added. Preferences live in localStorage (renderer-only, no
 * upstream settings schema change) and are read on every list fetch, so
 * changes apply the next time the model picker opens. Dedupe by id makes
 * the defaults a no-op once Goose ships them itself.
 */
import type { ProviderInventoryModelDto } from '@aaif/goose-acp-client';
import { getAcpClient } from './acpConnection';

export interface CustomModelEntry {
  id: string;
  name: string;
}

export interface ModelDisplayPrefs {
  /** Catalog model ids the user chose not to show. */
  hidden: string[];
  /** Default extra model ids the user switched off. */
  disabledExtras: string[];
  /** User-added model ids, always shown unless also in `hidden`. */
  customs: CustomModelEntry[];
}

const PREFS_KEY = 'goose-custom:modelDisplayPrefs';

export const DEFAULT_EXTRA_MODELS: CustomModelEntry[] = [
  { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' },
  { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
  { id: 'gpt-reserve', name: 'GPT-Reserve' },
];

const EMPTY_PREFS: ModelDisplayPrefs = { hidden: [], disabledExtras: [], customs: [] };

export function loadModelDisplayPrefs(): ModelDisplayPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...EMPTY_PREFS };
    const parsed = JSON.parse(raw) as Partial<ModelDisplayPrefs>;
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      disabledExtras: Array.isArray(parsed.disabledExtras) ? parsed.disabledExtras : [],
      customs: Array.isArray(parsed.customs) ? parsed.customs : [],
    };
  } catch {
    return { ...EMPTY_PREFS };
  }
}

export function saveModelDisplayPrefs(prefs: ModelDisplayPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable; preferences simply won't persist
  }
}

/** The provider's own catalog, without any of our merging applied. */
export async function fetchRawProviderModels(
  providerId: string
): Promise<ProviderInventoryModelDto[]> {
  const client = await getAcpClient();
  const { entries } = await client.goose.providersList_unstable({ providerIds: [providerId] });
  return entries.find((e) => e.providerId === providerId)?.models ?? [];
}

export function mergeCodexExtraModels(
  providerId: string,
  models: ProviderInventoryModelDto[]
): ProviderInventoryModelDto[] {
  if (providerId !== 'chatgpt_codex') return models;
  const prefs = loadModelDisplayPrefs();
  const hidden = new Set(prefs.hidden);
  const visible = models.filter((m) => !hidden.has(m.id));
  const known = new Set(visible.map((m) => m.id));

  const additions: ProviderInventoryModelDto[] = [];
  const push = (entry: CustomModelEntry) => {
    if (hidden.has(entry.id) || known.has(entry.id)) return;
    known.add(entry.id);
    additions.push({ id: entry.id, name: entry.name, reasoning: true });
  };
  for (const entry of prefs.customs) push(entry);
  const disabled = new Set(prefs.disabledExtras);
  for (const entry of DEFAULT_EXTRA_MODELS) {
    if (!disabled.has(entry.id)) push(entry);
  }
  return additions.length ? [...additions, ...visible] : visible;
}
