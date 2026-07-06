import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReadContracts } from 'wagmi';
import { CONTRACTS, stakingVaultAbi } from '../config/contracts';
import { Reveal } from './Reveal';
import { CountUp } from './CountUp';

const SECONDS_PER_YEAR = 31_536_000n;
const BPS_DENOMINATOR = 10_000n;

function calcApy(baseRate: bigint, boostBps: bigint): number {
  const effectiveRate = baseRate + (baseRate * boostBps) / BPS_DENOMINATOR;
  const preciseAnnual = (Number(effectiveRate) * Number(SECONDS_PER_YEAR)) / 1e18;
  return preciseAnnual * 100;
}

function MarketsTable() {
  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'rewardRatePerSecond', args: [CONTRACTS.usdc] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'rewardRatePerSecond', args: [CONTRACTS.eurc] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'tierBoostBps', args: [0] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'tierBoostBps', args: [1] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'tierBoostBps', args: [2] },
    ],
  });

  if (isLoading || !data) {
    return <p className="text-secondary">Loading market data...</p>;
  }

  const usdcBase = (data[0].result as bigint) ?? 0n;
  const eurcBase = (data[1].result as bigint) ?? 0n;
  const flexibleBoost = (data[2].result as bigint) ?? 0n;
  const growthBoost = (data[3].result as bigint) ?? 0n;
  const diamondBoost = (data[4].result as bigint) ?? 0n;

  const rows = [
    { symbol: 'USDC', base: usdcBase },
    { symbol: 'EURC', base: eurcBase },
  ];

  return (
    <table className="markets-table">
      <thead>
        <tr>
          <th>Asset</th>
          <th>Total TVL</th>
          <th>APY Flexible</th>
          <th>APY Growth (6m)</th>
          <th>APY Diamond (12m)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.symbol}>
            <td className="asset-cell">{row.symbol}</td>
            <td className="text-secondary">Coming soon</td>
            <td><CountUp value={calcApy(row.base, flexibleBoost)} suffix="%" /></td>
            <td><CountUp value={calcApy(row.base, growthBoost)} suffix="%" /></td>
            <td><CountUp value={calcApy(row.base, diamondBoost)} suffix="%" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FAQ_ITEMS = [
  {
    q: 'What is Shiny?',
    a: 'Shiny is a stablecoin staking and lending protocol built on Arc Testnet. Stake USDC or EURC to earn real yield, and borrow across assets without unstaking your position.',
  },
  {
    q: 'What happens if I withdraw early?',
    a: 'Your principal is always returned 100%. Only unclaimed rewards are subject to a tiered penalty depending on how long you held the position — the longer you stake, the lower the penalty.',
  },
  {
    q: 'Can I borrow while staking?',
    a: 'Yes. Your staked position counts as collateral automatically — no need to unstake to take out a loan, as long as your Health Factor stays safe.',
  },
];

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="faq-list">
      {FAQ_ITEMS.map((item, i) => (
        <div key={item.q} className="faq-item">
          <button
            className="faq-question"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            <span>{item.q}</span>
            <span>{openIndex === i ? '−' : '+'}</span>
          </button>
          <AnimatePresence initial={false}>
            {openIndex === i && (
              <motion.div
                key="content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <p className="faq-answer">{item.a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export function LandingSections() {
  return (
    <div className="landing-sections">
      <Reveal>
        <section id="markets-section" className="landing-section">
          <h2>Markets</h2>
          <MarketsTable />
          <p className="markets-note">ⓘ APY values are estimated and may change based on lending demand.</p>
        </section>
      </Reveal>

      <Reveal>
        <section id="faq-section" className="landing-section">
          <h2>FAQs</h2>
          <FaqSection />
          <a
            href="https://docs.arc.io"
            target="_blank"
            rel="noreferrer"
            className="docs-link"
            style={{ display: 'inline-block', marginTop: '16px' }}
          >
            Read Docs ↗
          </a>
        </section>
      </Reveal>

      <Reveal>
      <footer className="landing-footer">
        <div className="footer-links">
          <a href="https://docs.arc.io" target="_blank" rel="noreferrer">Arc Docs ↗</a>
          <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">ArcScan ↗</a>
          <a href="#">Privacy Policy</a>
        </div>

        <div className="footer-brand-row">  
          <strong>Shiny</strong>
          <div className="footer-social">
            <a
              href="https://x.com/Shiny_xyz"
              target="_blank"
              rel="noreferrer"
              aria-label="Shiny on X"
              className="social-icon"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <span className="social-icon social-icon--disabled" title="Discord coming soon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.369a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              <span className="social-tooltip">coming soon</span>
            </span>
          </div>
        </div>

        <p className="text-secondary footer-tagline">Revenue-sharing lending protocol — no reward token.</p>
        <p className="text-secondary footer-copyright">© Shiny — built on Arc Testnet</p>
      </footer>
      </Reveal>
    </div>
  );
}