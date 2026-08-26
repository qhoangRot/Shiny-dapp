import { useState, type ReactNode } from 'react';

const DOC_SECTIONS = [
  { label: 'Overview', id: 'overview', group: 'Introduction' },
  { label: 'Quickstart', id: 'quickstart', group: 'Introduction' },
  { label: 'Supported assets', id: 'supported-assets', group: 'Vaults' },
  { label: 'Staking', id: 'staking', group: 'Vaults' },
  { label: 'Rewards & withdrawal', id: 'rewards', group: 'Vaults' },
  { label: 'Borrowing', id: 'borrowing', group: 'Lending & risk' },
  { label: 'Repayment', id: 'repayment', group: 'Lending & risk' },
  { label: 'Risk & Health Factor', id: 'risk', group: 'Lending & risk' },
  { label: 'Revenue & transparency', id: 'revenue', group: 'Lending & risk' },
] as const;

const DOC_GROUPS = ['Introduction', 'Vaults', 'Lending & risk'] as const;
type DocsSectionId = (typeof DOC_SECTIONS)[number]['id'];

const PROTOCOL_REFERENCE = {
  stake: {
    label: 'Stake position',
    description: 'Create a Flexible USDC position. Use tier 1 or 2 for Growth or Diamond.',
    code: `await walletClient.writeContract({
  address: V2_CONTRACTS.stakingVault,
  abi: stakingVaultV2Abi,
  functionName: 'stake',
  args: [CONTRACTS.usdc, parseUnits('100', 6), 0],
  account,
});`,
  },
  borrow: {
    label: 'Borrow cross-asset',
    description: 'Use a USDC position as collateral to borrow EURC. The pool validates LTV and Health Factor on-chain.',
    code: `await walletClient.writeContract({
  address: V2_CONTRACTS.lendingPool,
  abi: lendingPoolV2Abi,
  functionName: 'borrow',
  args: [CONTRACTS.usdc, CONTRACTS.eurc, parseUnits('50', 6)],
  account,
});`,
  },
  repay: {
    label: 'Repay debt',
    description: 'Approve the exact EURC repayment amount, then reduce the EURC debt. Interest is settled before principal.',
    code: `await walletClient.writeContract({
  address: V2_CONTRACTS.lendingPool,
  abi: lendingPoolV2Abi,
  functionName: 'repay',
  args: [CONTRACTS.eurc, parseUnits('50', 6)],
  account,
});`,
  },
  risk: {
    label: 'Verify risk data',
    description: 'Confirm the testnet oracle is healthy before relying on a borrowing preview or risk calculation.',
    code: `const oracleHealthy = await publicClient.readContract({
  address: V2_CONTRACTS.oracleAdapter,
  abi: oracleAdapterV2Abi,
  functionName: 'isHealthy',
  args: [CONTRACTS.usdc],
});`,
  },
} as const;
type ProtocolReferenceTab = keyof typeof PROTOCOL_REFERENCE;

function ParameterTable({ children }: { children: ReactNode }) {
  return <div className="shiny-docs-page__table-wrap"><table className="shiny-docs-page__table">{children}</table></div>;
}

export function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocsSectionId>('overview');
  const [referenceTab, setReferenceTab] = useState<ProtocolReferenceTab>('stake');

  const selectSection = (section: DocsSectionId) => {
    setActiveSection(section);
  };

  const sectionClass = (section: DocsSectionId) =>
    `shiny-docs-page__section${activeSection === section ? ' is-active' : ''}`;

  return (
    <div className="shiny-docs-page">
      <section className="shiny-docs-page__hero">
        <p>// SHINY DOCUMENTATION</p>
        <h1>Know where<br />your capital goes</h1>
      </section>

      <div className="shiny-docs-page__layout">
        <aside className="shiny-docs-page__toc" aria-label="Documentation sections">
          <span>DOCUMENTATION</span>
          {DOC_GROUPS.map((group) => (
            <div className="shiny-docs-page__toc-group" key={group}>
              <b>{group}</b>
              {DOC_SECTIONS.filter((section) => section.group === group).map((section) => {
                const index = DOC_SECTIONS.findIndex(({ id }) => id === section.id) + 1;
                return <button
                  key={section.id}
                  type="button"
                  className={activeSection === section.id ? 'is-active' : undefined}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  onClick={() => selectSection(section.id)}
                >
                  <i>{String(index).padStart(2, '0')}</i>{section.label}
                </button>;
              })}
            </div>
          ))}
        </aside>

        <article className="shiny-docs-page__article">
          <section id="overview" className={sectionClass('overview')}>
            <p className="shiny-docs-page__eyebrow">OVERVIEW</p>
            <h2>Overview</h2>
            <p className="shiny-docs-page__lead">Shiny is a stablecoin staking and lending protocol on Arc Testnet. It lets USDC and EURC positions stay productive while their value supports liquidity.</p>
            <p>Traditional staking often turns liquidity into a binary choice: keep funds staked for rewards, or withdraw them before they can be used. Shiny separates those decisions. A stake remains a position inside the vault; the protocol can recognize its value as collateral without treating the deposited principal as an amount the user may simply withdraw and borrow at the same time.</p>
            <p>In practice, this means a user can retain an active staking position, borrow the other supported stablecoin against its value, and keep monitoring the resulting risk through LTV and Health Factor. The collateral remains committed to the position until debt is repaid or, if necessary, liquidation is executed.</p>
            <div className="shiny-docs-page__reference" aria-label="Shiny protocol quick reference">
              <div className="shiny-docs-page__reference-heading">
                <span>PROTOCOL QUICK REFERENCE</span>
                <p>Examples use Shiny’s deployed V2 contract configuration on Arc Testnet.</p>
              </div>
              <div className="shiny-docs-page__reference-tabs" role="tablist" aria-label="Shiny contract actions">
                {(Object.entries(PROTOCOL_REFERENCE) as [ProtocolReferenceTab, (typeof PROTOCOL_REFERENCE)[ProtocolReferenceTab]][]).map(([key, reference]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={referenceTab === key}
                    className={referenceTab === key ? 'is-active' : undefined}
                    onClick={() => setReferenceTab(key)}
                  >
                    {reference.label}
                  </button>
                ))}
              </div>
              <div className="shiny-docs-page__reference-code" role="tabpanel">
                <pre><code>{PROTOCOL_REFERENCE[referenceTab].code}</code></pre>
                <button type="button" className="shiny-docs-page__reference-copy" onClick={() => void navigator.clipboard?.writeText(PROTOCOL_REFERENCE[referenceTab].code)} aria-label="Copy code example">COPY</button>
              </div>
              <p className="shiny-docs-page__reference-description">{PROTOCOL_REFERENCE[referenceTab].description}</p>
              <div className="shiny-docs-page__reference-stack"><span>Arc Testnet</span><span>viem / wagmi</span><span>USDC + EURC</span></div>
            </div>
          </section>

          <section id="quickstart" className={sectionClass('quickstart')}>
            <div className="shiny-docs-page__section-head"><span>02</span><h2>Quickstart</h2></div>
            <p className="shiny-docs-page__lead">A minimal path through Shiny: create a position, use it as collateral if needed, and keep the account healthy.</p>
            <div className="shiny-docs-page__quickstart">
              <article><span>01</span><h3>Stake</h3><p>Choose USDC or EURC, choose a vault tier, approve the exact amount, then create a staking position.</p></article>
              <article><span>02</span><h3>Borrow</h3><p>Choose the opposite asset. Review the portfolio collateral, LTV, Health Factor, and borrow APR before signing.</p></article>
              <article><span>03</span><h3>Manage</h3><p>Repay part or all of the loan to reduce risk. Claim rewards or withdraw a position only when its conditions suit you.</p></article>
            </div>
            <div className="shiny-docs-page__example"><span>NOTE</span><p>New borrowing is limited by the portfolio's <b>75% maximum LTV</b>. Staking principal remains in the vault; it is collateral, not a second wallet balance.</p></div>
          </section>

          <section id="supported-assets" className={sectionClass('supported-assets')}>
            <div className="shiny-docs-page__section-head"><span>03</span><h2>Supported assets</h2></div>
            <p className="shiny-docs-page__lead">Shiny currently supports two native stablecoins on Arc Testnet. Every vault position, reward balance, and debt record remains denominated in its original asset.</p>
            <div className="shiny-docs-page__asset-grid">
              <article>
                <span>USDC</span>
                <h3>USD Coin</h3>
                <p>USDC can be staked in any vault tier. Its position may support an EURC loan, and any settled vault reward is paid in USDC.</p>
              </article>
              <article>
                <span>EURC</span>
                <h3>Euro Coin</h3>
                <p>EURC can be staked in any vault tier. Its position may support a USDC loan, and any settled vault reward is paid in EURC.</p>
              </article>
            </div>
            <div className="shiny-docs-page__example"><span>PAIR RULE</span><p>The active market configuration permits only <b>USDC → EURC</b> and <b>EURC → USDC</b> borrowing. Same-asset borrowing is not enabled.</p></div>
          </section>

          <section id="staking" className={sectionClass('staking')}>
            <div className="shiny-docs-page__section-head"><span>04</span><h2>Staking</h2></div>
            <p>Each stake creates an individual on-chain position. This preserves the position’s asset, tier, start time, lock condition, reward checkpoint, and withdrawal state instead of merging all deposits into one opaque balance.</p>
            <ParameterTable>
              <thead><tr><th>Tier</th><th>Voluntary lock</th><th>Reward weight</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td>Flexible</td><td>No lock</td><td>1.0×</td><td>Immediate voluntary withdrawal access</td></tr>
                <tr><td>Growth</td><td>180 days</td><td>1.2×</td><td>Higher reward weight with a six-month commitment</td></tr>
                <tr><td>Diamond</td><td>365 days</td><td>1.4×</td><td>Highest reward weight with a one-year commitment</td></tr>
              </tbody>
            </ParameterTable>
            <p>Rewards are not produced by a fixed emissions schedule. When borrow interest is repaid and settled, the staker allocation is added to a same-asset reward index, <code>accRewardPerWeightedShare</code>. A position’s claimable amount is calculated from its weighted principal and its stored reward checkpoint.</p>
            <div className="shiny-docs-page__example"><span>EXAMPLE</span><p>Staking <b>100 USDC</b> in Diamond gives the position a <b>140 USDC-equivalent reward weight</b> (100 × 1.4). It does not increase the principal available for collateral; it only changes that position’s share of newly settled USDC rewards.</p></div>
          </section>

          <section id="borrowing" className={sectionClass('borrowing')}>
            <div className="shiny-docs-page__section-head"><span>06</span><h2>Borrowing</h2></div>
            <p>Shiny supports cross-asset borrowing only. A USDC stake can support an EURC loan; an EURC stake can support a USDC loan. Borrowing the same asset as the selected collateral is not enabled by the current market configuration.</p>
            <ParameterTable>
              <thead><tr><th>Parameter</th><th>Current setting</th><th>Meaning</th></tr></thead>
              <tbody>
                <tr><td>Maximum LTV</td><td>75.0%</td><td>New debt cannot exceed 75% of total portfolio collateral value</td></tr>
                <tr><td>Liquidation threshold</td><td>83.3%</td><td>Risk-adjusted collateral used to calculate Health Factor</td></tr>
                <tr><td>Liquidation bonus</td><td>5.0%</td><td>Collateral incentive paid to a successful liquidator</td></tr>
                <tr><td>Borrow APR</td><td>USDC 4% · EURC 5%</td><td>Current Arc Testnet configuration; managed as protocol risk parameters</td></tr>
              </tbody>
            </ParameterTable>
            <p>Before signing, the interface previews total collateral, current debt, applicable borrow APR, maximum LTV, and the projected LTV and Health Factor. The protocol verifies the same constraints on-chain; the preview is informational, not a substitute for contract validation.</p>
          </section>

          <section id="repayment" className={sectionClass('repayment')}>
            <div className="shiny-docs-page__section-head"><span>07</span><h2>Repayment</h2></div>
            <p>Repayment can be partial or full. The pool first accrues interest to the current block, then applies a payment to accrued interest before reducing principal: <code>interestPaid = min(payment, accruedInterest)</code>. Any remaining payment reduces principal.</p>
            <p>A full repayment clears both principal and accrued interest for that debt asset. As outstanding debt falls, the account’s available borrowing capacity and Health Factor improve. Repayments are intentionally not pausable, so a user always retains a path to reduce risk even if new borrowing is temporarily suspended.</p>
          </section>

          <section id="risk" className={sectionClass('risk')}>
            <div className="shiny-docs-page__section-head"><span>08</span><h2>Risk & Health Factor</h2></div>
            <p>Health Factor measures the distance between risk-adjusted collateral and debt value:</p>
            <div className="shiny-docs-page__formula"><span>HEALTH FACTOR</span><b>=</b><span>(COLLATERAL VALUE × LIQUIDATION THRESHOLD) ÷ DEBT VALUE</span></div>
            <p>A Health Factor below 1.00 means the account is eligible for liquidation. Prices are sourced from the protocol’s configured testnet oracle, so risk calculations are unavailable while that oracle is unhealthy rather than silently using stale values.</p>
            <ParameterTable>
              <thead><tr><th>Health Factor</th><th>Risk state</th><th>Interpretation</th></tr></thead>
              <tbody>
                <tr><td>Below 1.00</td><td>Liquidation</td><td>The position may be liquidated permissionlessly</td></tr>
                <tr><td>1.00–1.20</td><td>Critical</td><td>Very limited buffer; repaying or adding collateral should be considered</td></tr>
                <tr><td>1.20–1.50</td><td>Moderate</td><td>Position remains open but has a narrower safety margin</td></tr>
                <tr><td>1.50–3.00</td><td>Healthy</td><td>Normal operating range</td></tr>
                <tr><td>3.00+</td><td>Strong</td><td>Large collateral buffer relative to debt</td></tr>
              </tbody>
            </ParameterTable>
            <p>Liquidation is permissionless: any eligible caller may repay debt and receive seized collateral plus the 5% liquidation bonus. The standard close factor is 50%; when Health Factor falls below 0.95, the pool allows up to 100% of the eligible debt to be covered in one liquidation. If every eligible collateral position is exhausted and debt remains, the residual is recorded as protocol deficit and may later be covered from the Insurance Fund.</p>
          </section>

          <section id="rewards" className={sectionClass('rewards')}>
            <div className="shiny-docs-page__section-head"><span>05</span><h2>Rewards & withdrawal</h2></div>
            <p>Principal is always returned in full on a successful withdrawal. The early-exit rule affects only unclaimed rewards, and it applies consistently across Flexible, Growth, and Diamond positions. Selecting a different withdrawal path does not bypass reward vesting.</p>
            <ParameterTable>
              <thead><tr><th>Holding period</th><th>Unclaimed reward penalty</th><th>Result</th></tr></thead>
              <tbody>
                <tr><td>0–90 days</td><td>100%</td><td>All unclaimed reward is forfeited; principal remains whole</td></tr>
                <tr><td>90–365 days</td><td>Linear decline from 100% to 0%</td><td>The longer the position is held, the more accrued reward is kept</td></tr>
                <tr><td>365+ days</td><td>0%</td><td>All accrued reward is paid with principal</td></tr>
              </tbody>
            </ParameterTable>
            <p><code>withdraw()</code> enforces the Growth or Diamond lock before allowing a voluntary exit. <code>emergencyWithdraw()</code> bypasses that lock, but both paths use the exact same holding-duration penalty formula. Any forfeited reward is transferred to the Insurance Fund rather than disappearing from the system.</p>
          </section>

          <section id="revenue" className={sectionClass('revenue')}>
            <div className="shiny-docs-page__section-head"><span>09</span><h2>Revenue & transparency</h2></div>
            <p>Borrow interest becomes protocol revenue only after it is repaid. Settlement routes that same asset through the Revenue Router; Shiny does not swap USDC revenue into EURC or vice versa. Rounding remainder is assigned to stakers so every settlement conserves the full amount received.</p>
            <ParameterTable>
              <thead><tr><th>Destination</th><th>Share of settled interest</th><th>Role</th></tr></thead>
              <tbody>
                <tr><td>Stakers</td><td>65%</td><td>Funds same-asset vault rewards through the reward index</td></tr>
                <tr><td>Treasury</td><td>15%</td><td>Protocol treasury reserve</td></tr>
                <tr><td>Insurance Fund</td><td>10%</td><td>Reserve available to help cover finalized bad debt</td></tr>
                <tr><td>Credit Bonus reserve</td><td>10%</td><td>Held in escrow pending an audited production credit system</td></tr>
              </tbody>
            </ParameterTable>
            <p>This is why displayed staking rewards are revenue-based rather than a guaranteed fixed APR. If no interest has been repaid and settled for an asset, there is no new revenue allocation for that asset’s reward index.</p>
          </section>
        </article>

      </div>
    </div>
  );
}
