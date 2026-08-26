import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
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
import { DocsPage } from './components/DocsPage';
import { SmoothScroll } from './components/SmoothScroll';
import './App.css';

type View = 'landing' | 'docs' | 'app' | 'markets' | 'positions' | 'credit-score' | 'analytics';
type LandingNavItem = 'markets' | 'protocol' | 'faq' | 'docs';

const LANDING_NAV_INDEX: Record<LandingNavItem, number> = {
  markets: 0,
  protocol: 1,
  faq: 2,
  docs: 3,
};

const NAV_ITEMS: { label: string; view: Exclude<View, 'landing' | 'docs'> }[] = [
  { label: 'Dashboard', view: 'app' },
  { label: 'Markets', view: 'markets' },
  { label: 'My Positions', view: 'positions' },
  { label: 'Credit Score', view: 'credit-score' },
  { label: 'Analytics', view: 'analytics' },
];

// LandingPage has local, not-yet-committed connect-intent work. Keep App
// compatible with both that draft and the currently deployed public API.
const CompatibleLandingPage = LandingPage as ComponentType<{
  onLaunch: () => void;
  onConnectIntent: () => void;
  onOpenDocs: () => void;
  onHeaderThemeChange: (theme: 'dark' | 'light') => void;
  onHeaderExitProgressChange: (progress: number) => void;
}>;

function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [view, setView] = useState<View>(() => window.location.pathname === '/docs' ? 'docs' : 'landing');
  const [activeLandingNav, setActiveLandingNav] = useState<LandingNavItem | null>(() =>
    window.location.pathname === '/docs' ? 'docs' : null,
  );
  const [landingHeaderTheme, setLandingHeaderTheme] = useState<'dark' | 'light'>('dark');
  const [curtainActive, setCurtainActive] = useState(false);
  const curtainTimers = useRef<number[]>([]);
  const landingHeaderRef = useRef<HTMLElement>(null);
  const pendingLandingNavigation = useRef<Exclude<LandingNavItem, 'docs'> | null>(null);
  const showApp = isConnected && view !== 'landing' && view !== 'docs';

  const navigateAppView = useCallback((nextView: Exclude<View, 'landing' | 'docs'>) => {
    setView((currentView) => currentView === nextView ? currentView : nextView);
  }, []);

  useLayoutEffect(() => {
    if (showApp) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [showApp, view]);

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

  useEffect(() => {
    const handlePopState = () => {
      const isDocs = window.location.pathname === '/docs';
      setView(isDocs ? 'docs' : 'landing');
      setActiveLandingNav(isDocs ? 'docs' : null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useLayoutEffect(() => {
    if (view === 'docs') window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [view]);

  useEffect(() => {
    if (view !== 'landing') return;

    // The capsule follows only the sections represented by the landing nav.
    // Other landing sections deliberately leave the last matching item in
    // place instead of making the indicator jump or disappear mid-scroll.
    const sections: Array<{ id: string; item: Exclude<LandingNavItem, 'docs'> }> = [
      { id: 'markets-section', item: 'markets' },
      { id: 'protocol-section', item: 'protocol' },
      { id: 'faq-section', item: 'faq' },
    ];
    let frame = 0;

    const updateActiveSection = () => {
      frame = 0;

      // While Lenis is moving to a clicked section, keep the capsule on the
      // destination. Without this guard the scroll listener briefly restores
      // the section we are leaving, producing a visible target -> old -> target
      // jump in the navigation indicator.
      if (pendingLandingNavigation.current) return;

      const activationLine = window.innerHeight * 0.42;
      let nextItem: LandingNavItem | null = null;

      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= activationLine) {
          nextItem = section.item;
        }
      }

      setActiveLandingNav((currentItem) =>
        currentItem === nextItem ? currentItem : nextItem,
      );
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateActiveSection);
    };

    const onSectionNavigationComplete = () => {
      pendingLandingNavigation.current = null;
      updateActiveSection();
    };

    updateActiveSection();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('shiny:section-navigation-complete', onSectionNavigationComplete);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('shiny:section-navigation-complete', onSectionNavigationComplete);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [view]);

  const goLanding = () => {
    setView('landing');
    window.history.pushState({}, '', '/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goDocs = () => {
    pendingLandingNavigation.current = null;
    setActiveLandingNav('docs');
    setView('docs');
    window.history.pushState({}, '', '/docs');
  };

  const goLandingSection = useCallback((sectionId: string) => {
    const sectionNavigation: Record<string, LandingNavItem> = {
      'markets-section': 'markets',
      'protocol-section': 'protocol',
      'faq-section': 'faq',
    };
    const targetItem = sectionNavigation[sectionId] ?? null;
    pendingLandingNavigation.current = targetItem === 'docs' ? null : targetItem;
    setActiveLandingNav(targetItem);
    setView('landing');
    window.history.pushState({}, '', `/#${sectionId}`);

    // Landing mounts after the view change. Route this through Lenis instead
    // of native scrollIntoView so a click always interrupts existing momentum.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('shiny:scroll-to-section', { detail: { id: sectionId } }),
        );
      });
    });
  }, []);

  const goApp = useCallback(() => {
    navigateAppView('app');
    if (window.location.pathname === '/docs') window.history.pushState({}, '', '/');
  }, [navigateAppView]);

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
    <div className={`app-shell ${showApp ? 'app-shell--protocol' : view === 'docs' ? 'app-shell--docs' : 'app-shell--landing'}`}>
      <header
        ref={landingHeaderRef}
        className={`app-header ${
          view === 'docs' ? 'docs-app-header' : !showApp ? `landing-header landing-header--${landingHeaderTheme}` : ''
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
                  navigateAppView(item.view);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
        ) : (
          <nav
            className="landing-nav"
            aria-label="Landing page"
            style={activeLandingNav === null ? undefined : { '--landing-nav-index': LANDING_NAV_INDEX[activeLandingNav] } as CSSProperties}
          >
            <span className={`landing-nav__active-pill${activeLandingNav === null ? ' is-hidden' : ''}`} aria-hidden="true" />
            <a className={activeLandingNav === 'markets' ? 'is-active' : ''} href="/#markets-section" onClick={(event) => { event.preventDefault(); goLandingSection('markets-section'); }}>MARKETS</a>
            <a className={activeLandingNav === 'protocol' ? 'is-active' : ''} href="/#protocol-section" onClick={(event) => { event.preventDefault(); goLandingSection('protocol-section'); }}>PROTOCOL</a>
            <a className={activeLandingNav === 'faq' ? 'is-active' : ''} href="/#faq-section" onClick={(event) => { event.preventDefault(); goLandingSection('faq-section'); }}>FAQ</a>
            <a className={activeLandingNav === 'docs' ? 'is-active' : ''} href="/docs" onClick={(event) => { event.preventDefault(); goDocs(); }}>DOCS</a>
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
        {view === 'docs' ? (
          <DocsPage />
        ) : showApp ? (
          <AnimatePresence mode="popLayout">
            <motion.div
              key={view}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center', willChange: 'opacity' }}
            >
              {renderAppView()}
            </motion.div>
          </AnimatePresence>
        ) : (
          <SmoothScroll>
            <CompatibleLandingPage
              onLaunch={launchApp}
              onConnectIntent={() => undefined}
              onOpenDocs={goDocs}
              onHeaderThemeChange={setLandingHeaderTheme}
              onHeaderExitProgressChange={updateLandingHeaderExit}
            />
          </SmoothScroll>
        )}
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
