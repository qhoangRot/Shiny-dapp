import type { ReactNode } from 'react';
import { useSmoothScroll } from '../hooks/useSmoothScroll';

/// Component wrapper: kich hoat smooth scroll (Lenis + GSAP ScrollTrigger)
/// cho phan children ben trong. Chi dung cho Landing Page.
export function SmoothScroll({ children }: { children: ReactNode }) {
  useSmoothScroll();
  return <>{children}</>;
}
