import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import { AnimatePresence, motion } from 'framer-motion';
import logo from './assets/logo.png';
import { LandingLaunchButton, LandingPage } from './components/LandingPage';
import { Dashboard } from './components/Dashboard';
import { MarketsPage } from './components/MarketsPage';
import { PositionsPage } from './components/PositionsPage';
import { CreditScorePage } from './components/CreditScorePage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { SmoothScroll } from './components/SmoothScroll';
import './App.css';

type View = 'landing' | 'app' | 'markets' | 'positions' | 'credit-score' | 'analytics';

const NAV_ITEMS: { label: string; view: Exclude<View, 'landing'> }[] = [
  { label: 'Dashboard', view: 'app' },
  { label: 'Markets', view: 'markets' },
  { label: 'My Positions', view: 'positions' },
  { label: 'Credit Score', view: 'credit-score' },
  { label: 'Analytics', view: 'analytics' },
];

function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [view, setView] = useState<View>('landing');
  const [landingHeaderTheme, setLandingHeaderTheme] = useState<'dark' | 'light'>('dark');
  const [curtainActive, setCurtainActive] = useState(false);
  const curtainTimers = useRef<number[]>([]);
  const landingHeaderRef = useRef<HTMLElement>(null);
  const showApp = isConnected && view !== 'landing';

  const updateLandingHeaderExit = useCallback((progress: number) => {
    const header = landingHeaderRef.current;
    if (!header) return;

    const clampedProgress = Math.max(0, Math.min(1, progress));
    header.style.setProperty('--landing-header-offset', `${clampedProgress * -112}px`);
    header.style.setProperty('--landing-header-opacity', `${1 - clampedProgress}`);
    header.style.pointerEvents = clampedProgress >= 0.98 ? 'none' : '';
  }, []);

  useEffect(() => {
    return () => curtainTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const goLanding = () => {
    setView('landing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goApp = useCallback(() => setView('app'), []);

  const launchApp = useCallback(() => {
    if (curtainActive) return;
    curtainTimers.current.forEach((timer) => window.clearTimeout(timer));
    setCurtainActive(true);
    curtainTimers.current = [
      window.setTimeout(goApp, 520),
      window.setTimeout(() => setCurtainActive(false), 1_350),
    ];
  }, [curtainActive, goApp]);

  const renderAppView = () => {
    switch (view) {
      case 'markets':
        return <MarketsPage />;
      case 'positions':
        return <PositionsPage />;
      case 'credit-score':
        return <CreditScorePage />;
      case 'analytics':
        return <AnalyticsPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className={`app-shell ${showApp ? 'app-shell--protocol' : 'app-shell--landing'}`}>
      <header
        ref={landingHeaderRef}
        className={`app-header ${
          !showApp ? `landing-header landing-header--${landingHeaderTheme}` : ''
        }`}
      >
        <button type="button" className="app-header__left" onClick={goLanding}>
          <img src={logo} alt="Shiny" className="app-logo" />
          <span className="app-name">Shiny</span>
        </button>

        {showApp ? (
          <nav className="app-nav">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.view}
                className={view === item.view ? 'active' : ''}
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  setView(item.view);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
        ) : (
          <nav className="landing-nav" aria-label="Landing page">
            <a href="#markets-section">MARKETS</a>
            <a href="#protocol-section">PROTOCOL</a>
            <a href="#faq-section">FAQ</a>
          </nav>
        )}

        <div className="app-header__right">
          {showApp ? (
            <>
              <span className={`network-badge ${chainId === 5042002 ? '' : 'network-badge--wrong'}`}>
                <span className="network-badge__dot" />
                {chainId === 5042002 ? 'Arc Testnet' : 'Wrong network'}
              </span>
              <ConnectButton showBalance={false} />
            </>
          ) : (
            <LandingLaunchButton
              onLaunch={launchApp}
              compact
            />
          )}
        </div>
      </header>

      <main className="app-main">
        <AnimatePresence mode="wait">
          {showApp ? (
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
            >
              {renderAppView()}
            </motion.div>
          ) : (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              style={{ width: '100%' }}
            >
              <SmoothScroll>
                <LandingPage
                  onLaunch={launchApp}
                  onHeaderThemeChange={setLandingHeaderTheme}
                  onHeaderExitProgressChange={updateLandingHeaderExit}
                />
              </SmoothScroll>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <div className={`route-curtain ${curtainActive ? 'route-curtain--active' : ''}`} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} style={{ '--curtain-index': index } as CSSProperties} />
        ))}
        <span>SHINY / ENTERING PROTOCOL</span>
      </div>
    </div>
  );
}

export default App;
