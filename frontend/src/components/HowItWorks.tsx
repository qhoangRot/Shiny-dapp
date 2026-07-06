import { motion } from 'framer-motion';
import { CountUp } from './CountUp';

interface TierBox {
  label: string;
  sublabel: string;
  color: string;
}

const TIERS: TierBox[] = [
  { label: 'Flexible', sublabel: 'No Lock', color: '#4FD1C5' },
  { label: 'Growth', sublabel: '6 Months', color: '#B57DEE' },
  { label: 'Diamond', sublabel: '12 Months', color: '#9B5DE5' },
];

interface HowItWorksProps {
  collateralValue?: number;
  healthFactor?: number;
}

/// @notice Component thuan hien thi (static props), chua noi logic that.
///         Truyen collateralValue / healthFactor that vao sau khi co du lieu tu contract.
export function HowItWorks({
  collateralValue = 10000,
  healthFactor = 1.85,
}: HowItWorksProps) {
  return (
    <section className="how-it-works">
      <h2 className="how-it-works__title">How it works: Earn Yield While Borrowing</h2>

      <div className="how-it-works__grid">
        {/* Left: stacked tier boxes, continuous auto-animation */}
        <div className="tier-stack">
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.label}
              className="tier-box glass-panel"
              style={{
                zIndex: i + 1,
                marginTop: i === 0 ? 0 : -28,
                borderColor: tier.color,
              }}
              initial={{ opacity: 0, y: 30 }}
              animate={{
                opacity: 1,
                y: [0, -10, 0],
                rotate: [0, i % 2 === 0 ? 2 : -2, 0],
              }}
              transition={{
                opacity: { duration: 0.6, delay: i * 0.15 },
                y: { duration: 4 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 },
                rotate: { duration: 5 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 },
              }}
            >
              <span className="tier-box__dot" style={{ background: tier.color }} />
              <div>
                <div className="tier-box__label">{tier.label}</div>
                <div className="tier-box__sublabel">{tier.sublabel}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Right: animated stats panel */}
        <div className="stats-panel glass-panel">
          <div className="stats-row">
            <span className="stats-label">Your Collateral Value</span>
            <span className="stats-value">
              $<CountUp value={collateralValue} duration={2} />
            </span>
          </div>

          <div className="stats-divider" />

          <div className="stats-row">
            <span className="stats-label">Health Factor</span>
            <motion.span
              className="stats-value stats-value--hf"
              animate={{
                textShadow: [
                  '0 0 8px rgba(79, 209, 197, 0.4)',
                  '0 0 20px rgba(79, 209, 197, 0.9)',
                  '0 0 8px rgba(79, 209, 197, 0.4)',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <CountUp value={healthFactor} duration={2} />
            </motion.span>
          </div>

          <p className="stats-caption">Staked position counts as collateral — no unstaking required.</p>
        </div>
      </div>
    </section>
  );
}
