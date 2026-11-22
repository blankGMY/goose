/**
 * Quick model / thinking-effort switching inside the bottom-bar menu.
 *
 * Fork addition: renders the current provider's models and the
 * thinking-effort levels as direct menu items in ModelsBottomBar's
 * dropdown, so switching takes one extra click instead of a trip
 * through the full SwitchModelModal. Applying a choice uses the same
 * paths as the modal and the recent-model items (changeModel with
 * request_params.thinking_effort, plus the saved-effort preference).
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { ProviderInventoryModelDto } from '@aaif/goose-acp-client';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { useModelAndProvider } from '../ModelAndProviderContext';
import { getModelDisplayName } from '../settings/models/predefinedModelsUtils';
import { acpListProviderModels, acpSaveThinkingEffort } from '../../acp/providers';
import type { ThinkingEffort } from '../../types/providers';

const EFFORTS: { value: ThinkingEffort; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低 · low' },
  { value: 'medium', label: '中 · medium' },
  { value: 'high', label: '高 · high' },
  { value: 'max', label: '极高 · xhigh' },
];

interface QuickModelSectionsProps {
  sessionId: string | null;
  currentProvider: string | null;
  currentModel: string | null;
  effort: ThinkingEffort;
  onEffortChange: (effort: ThinkingEffort) => void;
  onPickModel: (provider: string, model: string) => void;
}

export default function QuickModelSections({
  sessionId,
  currentProvider,
  currentModel,
  effort,
  onEffortChange,
  onPickModel,
}: QuickModelSectionsProps) {
  const { changeModel } = useModelAndProvider();
  const [models, setModels] = useState<ProviderInventoryModelDto[]>([]);

  // The dropdown content mounts fresh on every open, so loading here
  // always reflects the latest provider model list.
  useEffect(() => {
    let cancelled = false;
    if (currentProvider) {
      acpListProviderModels(currentProvider)
        .then((list) => {
          if (!cancelled) setModels(list);
        })
        .catch(() => {
          if (!cancelled) setModels([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [currentProvider]);

  if (!currentProvider || models.length === 0) {
    return null;
  }

  const currentEntry = models.find((m) => m.id === currentModel);
  const showEffort = currentEntry?.reasoning === true;

  const handleEffort = async (next: ThinkingEffort) => {
    if (!currentModel || !currentProvider) return;
    onEffortChange(next);
    await acpSaveThinkingEffort(next).catch(() => {
      // the session apply below still carries the effort
    });
    await changeModel(sessionId, {
      name: currentModel,
      provider: currentProvider,
      request_params: { thinking_effort: next },
    });
  };

  return (
    <>
      <DropdownMenuSeparator />
      <h6 className="text-xs text-text-primary mt-2 ml-2">模型</h6>
      <div className="max-h-56 overflow-y-auto">
        {models.map((m) => {
          const isCurrent = m.id === currentModel;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => {
                if (!isCurrent) onPickModel(currentProvider, m.id);
              }}
            >
              {isCurrent ? (
                <Check className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <span className="mr-2 w-3.5 flex-shrink-0" />
              )}
              <span className="truncate">{m.name ?? getModelDisplayName(m.id)}</span>
            </DropdownMenuItem>
          );
        })}
      </div>
      {showEffort && (
        <>
          <h6 className="text-xs text-text-primary mt-2 ml-2">推理强度</h6>
          {EFFORTS.map((e) => (
            <DropdownMenuItem key={e.value} onClick={() => void handleEffort(e.value)}>
              {effort === e.value ? (
                <Check className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <span className="mr-2 w-3.5 flex-shrink-0" />
              )}
              <span>{e.label}</span>
            </DropdownMenuItem>
          ))}
        </>
      )}
    </>
  );
}
