import { motion } from 'framer-motion';

export function HealthFactorGauge({ hf, hasLoans }: { hf: number; hasLoans: boolean }) {
  if (!hasLoans) {
    return (
      <div className="hf-row">
        <span className="hf-row__label">Health Factor:</span>
        <span className="hf-badge hf-badge--brand">No Active Loans</span>
      </div>
    );
  }

  let color = '#4FD1C5';
  let bgClass = 'hf-badge--safe';
  if (hf < 1.1) {
    color = '#E5484D';
    bgClass = 'hf-badge--danger';
  } else if (hf < 1.5) {
    color = '#E8B54C';
    bgClass = 'hf-badge--warning';
  }

  const isDanger = hf < 1.1;

  return (
    <div className="hf-row">
      <span className="hf-row__label">Health Factor:</span>
      <motion.span
        className={`hf-badge ${bgClass}`}
        animate={isDanger ? { boxShadow: ['0 0 0px rgba(229,72,77,0)', '0 0 16px rgba(229,72,77,0.6)', '0 0 0px rgba(229,72,77,0)'] } : {}}
        transition={isDanger ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : {}}
        style={{ color }}
      >
        {hf.toFixed(2)}
      </motion.span>
    </div>
  );
}
