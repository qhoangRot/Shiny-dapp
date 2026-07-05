import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { AnimatePresence, motion } from 'framer-motion';
import logo from './assets/logo.png';
import './App.css';

const NAV_ITEMS = ['Dashboard', 'Markets', 'My Positions', 'Credit Score', 'Analytics'];

function App() {
  const { isConnected } = useAccount();
  const [view, setView] = useState<'landing' | 'app'>('landing');

  useEffect(() => {
    if (isConnected) setView('app');
  }, [isConnected]);

  const goLanding = () => setView('landing');
  const goApp = () => setView('app');

  const showDashboard = isConnected && view === 'app';

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
              <DashboardPlaceholder />
            </motion.div>
          ) : (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <PreConnectHero isConnected={isConnected} onGoDashboard={goApp} />
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
    <div className="hero">
      <h1>Stake stablecoins. Earn real yield.</h1>
      <p className="hero-subtext">
        Revenue-sharing lending protocol — no reward token.
      </p>
      <div className="hero-badges">
        <span className="badge">Supported: USDC, EURC</span>
        <span className="badge badge--accent">Live on Arc Testnet</span>
      </div>

      {isConnected ? (
        <button className="cta-button" onClick={onGoDashboard}>
          Go to Dashboard →
        </button>
      ) : (
        <p className="hero-cta-hint">Connect your wallet to get started ↑</p>
      )}
    </div>
  );
}

function DashboardPlaceholder() {
  return (
    <div className="dashboard-placeholder">
      <h2>Dashboard</h2>
      <p className="text-secondary">Welcome back. Here's your portfolio overview.</p>
      <p className="text-secondary" style={{ marginTop: '2rem' }}>
        (Đang xây dựng — dữ liệu thật từ contract sẽ hiển thị ở đây trong bước tiếp theo)
      </p>
    </div>
  );
}

export default App;
