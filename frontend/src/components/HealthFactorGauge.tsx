import { motion } from 'framer-motion';
import { InfoTip } from './InfoTip';

const MIN_GAUGE_HF = 1;
const MAX_GAUGE_HF = 3;

function gaugePosition(hf: number) {
  return Math.min(
    100,
    Math.max(0, ((hf - MIN_GAUGE_HF) / (MAX_GAUGE_HF - MIN_GAUGE_HF)) * 100),
  );
}

export function HealthFactorGauge({
  hf,
  hasLoans,
  label = 'Health Factor',
  unavailable = false,
}: {
  hf: number;
  hasLoans: boolean;
  label?: string;
  unavailable?: boolean;
}) {
  if (hasLoans && unavailable) {
    return (
      <section className="hf-gauge hf-gauge--unavailable glass-panel" aria-label={`${label} unavailable`}>
        <div className="hf-gauge__top">
          <span className="hf-gauge__label">
            {label}
            <InfoTip text="Health Factor cannot be calculated until the oracle price is refreshed." />
          </span>
          <span className="hf-gauge__status hf-gauge__status--neutral">Price refresh needed</span>
        </div>
        <div className="hf-gauge__value">—</div>
        <div className="hf-gauge__track hf-gauge__track--idle" aria-hidden="true" />
        <p className="hf-gauge__hint">Risk data will return after the oracle receives a fresh price.</p>
      </section>
    );
  }

  if (!hasLoans) {
    return (
      <section className="hf-gauge hf-gauge--empty glass-panel" aria-label="Health Factor">
        <div className="hf-gauge__top">
          <span className="hf-gauge__label">
            {label}
            <InfoTip text="Health Factor measures the safety of your borrow position. A value at or below 1.00 can be liquidated." />
          </span>
          <span className="hf-gauge__status hf-gauge__status--neutral">No active loans</span>
        </div>
        <div className="hf-gauge__value">—</div>
        <div className="hf-gauge__track hf-gauge__track--idle" aria-hidden="true" />
        <p className="hf-gauge__hint">Your Health Factor will appear after you open a borrow position.</p>
      </section>
    );
  }

  const isDanger = hf < 1.2;
  const isWarning = hf >= 1.2 && hf < 1.5;
  const status = isDanger ? 'Liquidation risk' : isWarning ? 'Needs attention' : 'Healthy';
  const statusClass = isDanger ? 'danger' : isWarning ? 'warning' : 'safe';
  const markerPosition = gaugePosition(hf);

  return (
    <motion.section
      className={`hf-gauge hf-gauge--${statusClass} glass-panel`}
      aria-label={`Health Factor ${hf.toFixed(2)}, ${status}`}
      animate={isDanger ? { boxShadow: ['0 0 0 rgba(229,72,77,0)', '0 0 28px rgba(229,72,77,0.18)', '0 0 0 rgba(229,72,77,0)'] } : {}}
      transition={isDanger ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : {}}
    >
      <div className="hf-gauge__top">
        <span className="hf-gauge__label">
          {label}
          <InfoTip text="Health Factor measures the safety of your borrow position. A value at or below 1.00 can be liquidated." />
        </span>
        <span className={`hf-gauge__status hf-gauge__status--${statusClass}`}>{status}</span>
      </div>
      <div className="hf-gauge__value">{hf.toFixed(2)}</div>
      <div
        className="hf-gauge__track"
        role="progressbar"
        aria-label="Distance from liquidation threshold"
        aria-valuemin={MIN_GAUGE_HF}
        aria-valuemax={MAX_GAUGE_HF}
        aria-valuenow={Math.min(MAX_GAUGE_HF, Math.max(MIN_GAUGE_HF, hf))}
      >
        <motion.span
          className="hf-gauge__marker"
          initial={false}
          animate={{ left: `${markerPosition}%` }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        />
      </div>
      <div className="hf-gauge__scale" aria-hidden="true">
        <span>1.00 · Liquidation</span>
        <span>1.50</span>
        <span>3.00+ · Healthy</span>
      </div>
    </motion.section>
  );
}
