import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import logo from './assets/logo.png';
import { LandingSections } from './components/LandingPage';
import { HowItWorks } from './components/HowItWorks';
import { Dashboard } from './components/Dashboard';
import { LandingBackground } from './components/LandingBackground';
import { SmoothScroll } from './components/SmoothScroll';
import './App.css';

const NAV_ITEMS = ['Dashboard', 'Markets', 'My Positions', 'Credit Score', 'Analytics'];

const heroContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.1 },
  },
};

const heroItemVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
};

function App() {
  const { isConnected } = useAccount();
  const [view, setView] = useState<'landing' | 'app'>('landing');
  const showDashboard = isConnected && view === 'app';
  useEffect(() => {
    if (isConnected) setView('app');
  }, [isConnected]);

  const goLanding = () => setView('landing');
  const goApp = () => setView('app');

  
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__left" onClick={goLanding} style={{ cursor: 'pointer' }}>
          <img src={logo} alt="Shiny" className="app-logo" />
          <span className="app-name">Shiny</span>
        </div>

        {isConnected && (
          <nav className="app-nav">
            {NAV_ITEMS.map((item, i) => (
              <a
                key={item}
                className={showDashboard && i === 0 ? 'active' : ''}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  goApp();
                }}
              >
                {item}
              </a>
            ))}
          </nav>
        )}

        <div className="app-header__right">
          {!isConnected && (
            <a
              href="#"
              className="docs-link"
              onClick={(e) => {
                e.preventDefault();
                goLanding();
              }}
            >
              Learn more
            </a>
          )}
          <ConnectButton showBalance={false} />
        </div>
      </header>

      <main className="app-main">
        <AnimatePresence mode="wait">
          {showDashboard ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
            >
              <Dashboard />
            </motion.div>
          ) : (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{ width: '100%' }}
            >
              <LandingBackground />
              <SmoothScroll>
                <PreConnectHero isConnected={isConnected} onGoDashboard={goApp} />
                <LandingSections />
              </SmoothScroll>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function PreConnectHero({
  isConnected,
  onGoDashboard,
}: {
  isConnected: boolean;
  onGoDashboard: () => void;
}) {
  return (
    <div>
      <motion.div
        className="hero"
        variants={heroContainerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div className="hero-badge" variants={heroItemVariants}>
          <img src={logo} alt="" className="hero-badge__logo" />
          <span>Shiny</span>
        </motion.div>
        <motion.h1 variants={heroItemVariants}>Stake and earn real yield</motion.h1>
        <motion.p className="hero-subtext" variants={heroItemVariants}>
          Revenue - sharing lending protocol
        </motion.p>
        <motion.div className="hero-badges" variants={heroItemVariants}>
          <span className="badge badge--blue">Supported: USDC, EURC</span>
          <span className="badge badge--accent">Live on Arc Testnet</span>
        </motion.div>
        {isConnected ? (
          <motion.button
            className="cta-button"
            onClick={onGoDashboard}
            variants={heroItemVariants}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
          >
            Go to Dashboard →
          </motion.button>
        ) : (
          <motion.p className="hero-cta-hint" variants={heroItemVariants}>
            Get started ↑
          </motion.p>
        )}
      </motion.div>
      <HowItWorks />
    </div>
  );
}
export default App;
