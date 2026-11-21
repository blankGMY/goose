import PoolQuotaBadge from './PoolQuotaBadge';
import ModelDisplaySettings from '../models/ModelDisplaySettings';

/** Custom chat bottom-bar extras: GPT quota readout + model display picker. */
export default function CustomBottomBarExtras() {
  return (
    <>
      <PoolQuotaBadge />
      <ModelDisplaySettings />
    </>
  );
}
