import { useLayoutEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { motion } from 'framer-motion';
import { CONTRACTS } from '../config/contracts';
import { AsciiCoinField } from './AsciiCoinField';
import { FooterAsciiField } from './FooterAsciiField';
import { TextScramble } from './TextScramble';
import usdcLogo from '../assets/usdc-logo.png';
import eurcLogo from '../assets/eurc-logo.png';

const PRINCIPLES = [
  ['01', 'Yield first', 'Funded reward programs flow back to stablecoin vault participants'],
  ['02', 'Borrow while staking', 'Access liquidity without forcing productive capital to stop'],
  ['03', 'Health Factor clarity', 'Risk is shown as distance to danger, not a vague status label'],
  ['04', 'Same-asset rewards', 'Earn rewards in the asset you already understand and deposited'],
  ['05', 'Transparent testnet FX', 'The EUR/USD test feed is explicit, inspectable, and owner-updated'],
  ['06', 'Credit that compounds', 'Healthy positions become a portable signal of repayment behavior'],
];

const FAQ_ITEMS = [
  {
    q: 'WHAT IS SHINY?',
    a: 'Shiny is a stablecoin staking and lending protocol on Arc Testnet; stake USDC or EURC, earn vault rewards, and use active positions as collateral',
  },
  {
    q: 'CAN I BORROW WHILE MY POSITION IS STAKED?',
    a: 'Yes, eligible staked value can support a loan without first closing the position, provided the resulting Health Factor remains within the safe range',
  },
  {
    q: 'WHAT HAPPENS IF I WITHDRAW EARLY?',
    a: 'Your principal remains yours; depending on the vault tier and elapsed lock time, an early exit may reduce unclaimed rewards',
  },
  {
    q: 'HOW DOES HEALTH FACTOR WORK?',
    a: 'Health Factor compares the risk-adjusted value of your collateral with your outstanding debt; a lower value means less room before liquidation',
  },
  {
    q: 'IS THE EUR/USD PRICE A LIVE ORACLE FEED?',
    a: 'Not on Arc Testnet; the current EUR/USD value is a clearly labelled, owner-updated test feed used to exercise the protocol until production-grade oracle coverage is available',
  },
];

export function LandingLaunchButton({
  onLaunch,
  onConnectIntent,
  compact = false,
}: {
  onLaunch: () => void;
  onConnectIntent?: () => void;
  compact?: boolean;
}) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openChainModal }) => {
        const connected = mounted && account && chain;
        const label = !connected
          ? 'CONNECT WALLET'
          : chain.unsupported
            ? 'SWITCH NETWORK'
            : 'ENTER THE PROTOCOL';

        return (
          <button
            type="button"
            className={`shiny-action ${compact ? 'shiny-action--compact' : ''}`}
            onClick={() => {
              if (!connected) {
                onConnectIntent?.();
                openConnectModal();
              }
              else if (chain.unsupported) openChainModal();
              else onLaunch();
            }}
          >
            <span>{label}</span>
            <span className="shiny-action__icon" aria-hidden="true">↗</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function MarketShowcase() {
  const markets = [
    { symbol: 'USDC', name: 'US Dollar Coin', logo: usdcLogo, asset: CONTRACTS.usdc },
    { symbol: 'EURC', name: 'Euro Coin', logo: eurcLogo, asset: CONTRACTS.eurc },
  ];

  return (
    <div className="shiny-markets__cards">
      {markets.map((market, index) => (
        <motion.article
          className="shiny-market-card"
          key={market.symbol}
          initial={{ opacity: 0, y: 48 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: index * 0.08 }}
        >
          <div className="shiny-market-card__top">
            <span className="shiny-market-card__index">0{index + 1}</span>
            <span className="shiny-market-card__status"><i /> ARC TESTNET</span>
          </div>
          <div className="shiny-market-card__identity">
            <img src={market.logo} alt="" />
            <div>
              <h3>{market.symbol}</h3>
              <p>{market.name}</p>
            </div>
          </div>
          <div className="shiny-market-card__rates">
            {['FLEXIBLE', 'GROWTH / 6M', 'DIAMOND / 12M'].map((tier) => (
              <div key={tier}>
                <span>{tier}</span>
                <strong>Revenue-based</strong>
              </div>
            ))}
          </div>
          <p className="shiny-market-card__footnote">
            REWARDS · FUNDED BY SETTLED BORROW INTEREST
          </p>
        </motion.article>
      ))}
    </div>
  );
}

function PrinciplesGrid() {
  const [scrambleRuns, setScrambleRuns] = useState<Record<string, number>>({});

  return (
    <section id="protocol-section" className="shiny-principles shiny-theme-light" data-header-theme="light">
      <div className="shiny-principles__heading">
        <h2><TextScramble text="Built for capital that refuses to sit still" /></h2>
        <p>// THE PROTOCOL</p>
      </div>
      <div className="shiny-principles__grid">
        {PRINCIPLES.map(([number, title, body]) => (
          <article
            key={number}
            onPointerEnter={() => {
              setScrambleRuns((current) => ({
                ...current,
                [number]: (current[number] ?? 0) + 1,
              }));
            }}
          >
            <span>{number}</span>
            <h3>
              <TextScramble
                text={title.toUpperCase()}
                replayKey={scrambleRuns[number] ?? 0}
              />
            </h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq-section" className="shiny-faq shiny-theme-dark" data-header-theme="dark">
      <div className="shiny-faq__heading">
        <h2>FAQs</h2>
      </div>
      <div className="shiny-faq__list">
        {FAQ_ITEMS.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <article className={`shiny-faq__item ${isOpen ? 'is-open' : ''}`} key={item.q}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <TextScramble text={item.q} />
                <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
              </button>
              <div className="shiny-faq__answer">
                <div><p>{item.a}</p></div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LandingFooter({
  onLaunch,
  onConnectIntent,
  onOpenDocs,
}: {
  onLaunch: () => void;
  onConnectIntent: () => void;
  onOpenDocs: () => void;
}) {
  return (
    <div className="shiny-footer-reveal">
      <section className="shiny-cta shiny-theme-light" data-header-theme="light">
        <div className="shiny-cta__capital-map" aria-hidden="true">
          <div className="shiny-cta__capital-map-heading">
            <span>CAPITAL IN MOTION</span>
            <span>ARC TESTNET</span>
          </div>
          <div className="shiny-cta__capital-rail">
            <div className="shiny-cta__capital-node shiny-cta__capital-node--asset">
              <i />
              <strong>USDC / EURC</strong>
              <small>DEPOSIT</small>
            </div>
            <div className="shiny-cta__capital-node shiny-cta__capital-node--vault">
              <i>S</i>
              <strong>SHINY VAULT</strong>
              <small>POSITION</small>
            </div>
            <div className="shiny-cta__capital-node shiny-cta__capital-node--utility">
              <i />
              <strong>STAKE / BORROW</strong>
              <small>KEEP EARNING</small>
            </div>
          </div>
        </div>
        <div>
          <h2>Put stablecoins<br />to work</h2>
        </div>
        <div className="shiny-cta__action">
          <p>STAKE · EARN · BORROW</p>
          <LandingLaunchButton onLaunch={onLaunch} onConnectIntent={onConnectIntent} />
          <span>ARC TESTNET · USDC + EURC</span>
        </div>
      </section>
      <footer id="footer-section" className="shiny-footer shiny-theme-dark" data-header-theme="dark">
        <div className="shiny-footer__top">
          <div>
            <strong>SHINY</strong>
            <p>PRODUCTIVE STABLECOIN CAPITAL</p>
            <button className="shiny-footer__documentary" type="button" onClick={onOpenDocs}>
              <span>OPEN DOCUMENTARY</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="shiny-footer__navigation">
            <nav className="shiny-footer__docs" aria-label="Documentation links">
              <a href="https://docs.arc.io" target="_blank" rel="noreferrer">ARC DOCS ↗</a>
              <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">ARCSCAN ↗</a>
              <a
                href="https://github.com/qhoangRot/Shiny-dapp#readme"
                target="_blank"
                rel="noreferrer"
              >
                GITHUB ↗
              </a>
            </nav>
            <div className="shiny-footer__socials" aria-label="Community links">
              <a
                className="shiny-footer__social-link"
                href="https://x.com/Shiny_xyz"
                target="_blank"
                rel="noreferrer"
                aria-label="Shiny on X"
              >
                <svg className="shiny-footer__social-icon" aria-hidden="true">
                  <use href="/icons.svg#x-icon" />
                </svg>
              </a>
              <button
                className="shiny-footer__social-link"
                type="button"
                aria-disabled="true"
                aria-label="Discord coming soon"
                aria-describedby="discord-coming-soon"
              >
                <svg className="shiny-footer__social-icon" aria-hidden="true">
                  <use href="/icons.svg#discord-icon" />
                </svg>
                <span
                  id="discord-coming-soon"
                  className="shiny-footer__social-tooltip"
                  role="tooltip"
                >
                  COMING SOON
                </span>
              </button>
            </div>
          </div>
        </div>
        <FooterAsciiField />
        <div className="shiny-footer__wordmark" aria-hidden="true">
          SHINY
        </div>
        <div className="shiny-footer__bottom">
          <span>© 2026 SHINY</span>
          <span>BUILT ON ARC TESTNET</span>
          <span>TESTNET TOKENS HAVE NO VALUE</span>
        </div>
      </footer>
    </div>
  );
}

export function LandingPage({
  onLaunch,
  onConnectIntent,
  onOpenDocs,
  onHeaderThemeChange,
  onHeaderExitProgressChange,
}: {
  onLaunch: () => void;
  onConnectIntent: () => void;
  onOpenDocs: () => void;
  onHeaderThemeChange: (theme: 'dark' | 'light') => void;
  onHeaderExitProgressChange: (progress: number) => void;
}) {
  useLayoutEffect(() => {
    let scheduled = false;
    const updateTheme = () => {
      scheduled = false;
      const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-header-theme]'));
      const sampleLine = 112;
      const visibleSections = sections.filter((section) => {
          const rect = section.getBoundingClientRect();
          return rect.top <= sampleLine && rect.bottom > sampleLine;
        });
      const active = visibleSections[visibleSections.length - 1] ?? sections[0];
      const footer = document.getElementById('footer-section');
      const blackBoundary =
        footer?.getBoundingClientRect().top ??
        Number.POSITIVE_INFINITY;
      const headerExitProgress = Math.max(
        0,
        Math.min(1, (sampleLine - blackBoundary) / sampleLine),
      );

      onHeaderExitProgressChange(headerExitProgress);
      onHeaderThemeChange(
        active?.id === 'footer-section' || active?.dataset.headerTheme === 'light'
          ? 'light'
          : 'dark',
      );
    };
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(updateTheme);
    };
    updateTheme();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      onHeaderExitProgressChange(0);
    };
  }, [onHeaderExitProgressChange, onHeaderThemeChange]);

  return (
    <div className="shiny-page">
      <section className="shiny-hero shiny-theme-dark" data-header-theme="dark">
        <div className="shiny-hero__copy">
          <p className="shiny-kicker">FUNDED TESTNET REWARDS · ARC TESTNET</p>
          <motion.h1
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            Your capital<br />should keep<br />moving
          </motion.h1>
          <motion.p
            className="shiny-hero__body"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
          >
            Stake USDC or EURC, earn funded testnet rewards, and borrow without putting your position to sleep
          </motion.p>
          <motion.div
            className="shiny-hero__actions"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.28 }}
          >
            <LandingLaunchButton onLaunch={onLaunch} onConnectIntent={onConnectIntent} />
          </motion.div>
        </div>
        <div className="shiny-hero__visual">
          <AsciiCoinField />
        </div>
      </section>

      <section id="markets-section" className="shiny-markets shiny-theme-dark" data-header-theme="dark">
        <div className="shiny-markets__rail">
          <h2>Two markets<br />One productive<br />balance</h2>
          <p>Vault parameters are read directly from the deployed Arc Testnet contract</p>
        </div>
        <MarketShowcase />
      </section>

      <PrinciplesGrid />
      <FaqSection />
      <LandingFooter
        onLaunch={onLaunch}
        onConnectIntent={onConnectIntent}
        onOpenDocs={onOpenDocs}
      />
    </div>
  );
}
