import PoolQuotaBadge from './PoolQuotaBadge';
import ModelDisplaySettings from '../models/ModelDisplaySettings';
import HandoffButton from './HandoffButton';

interface CustomBottomBarExtrasProps {
  sessionId: string | null;
  sessionModel?: string | null;
  sessionProvider?: string | null;
}

/** Custom chat bottom-bar extras: GPT quota readout + model display
 * picker + session handoff. */
export default function CustomBottomBarExtras({
  sessionId,
  sessionModel,
  sessionProvider,
}: CustomBottomBarExtrasProps) {
  return (
    <>
      <PoolQuotaBadge />
      <ModelDisplaySettings />
      <HandoffButton
        sessionId={sessionId}
        sessionModel={sessionModel}
        sessionProvider={sessionProvider}
      />
    </>
  );
}
