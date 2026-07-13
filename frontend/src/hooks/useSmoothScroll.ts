import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/// @notice Kich hoat smooth scroll toan trang, dong bo voi GSAP ScrollTrigger
///         de sua loi giat khung khi cuon (dung cong thuc chuan cua Lenis + GSAP)
export function useSmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    lenis.on('scroll', ScrollTrigger.update);

    // Luu tham chieu ham chinh xac de remove dung callback (fix bug cleanup)
    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Doi layout (font, canvas 3D) on dinh roi moi tinh lai vi tri trigger
    const refreshTimeout = setTimeout(() => ScrollTrigger.refresh(), 300);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      clearTimeout(refreshTimeout);
    };
  }, []);
}
