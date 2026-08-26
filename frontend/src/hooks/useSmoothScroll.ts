import { useLayoutEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/// @notice Kich hoat smooth scroll toan trang, dong bo voi GSAP ScrollTrigger
///         de sua loi giat khung khi cuon (dung cong thuc chuan cua Lenis + GSAP)
export function useSmoothScroll() {
  useLayoutEffect(() => {
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    lenis.on('scroll', ScrollTrigger.update);

    // Programmatic section navigation must go through Lenis as well. Calling
    // native scrollIntoView while Lenis is still easing from a manual scroll
    // can be overwritten by the previous animation and leave the user in the
    // wrong section.
    const onSectionNavigation = (event: Event) => {
      const sectionId = (event as CustomEvent<{ id?: string }>).detail?.id;
      const target = sectionId ? document.getElementById(sectionId) : null;
      if (!target) return;

      lenis.scrollTo(target, {
        duration: 1.05,
        lock: true,
        force: true,
      });
    };
    window.addEventListener('shiny:scroll-to-section', onSectionNavigation);

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
      window.removeEventListener('shiny:scroll-to-section', onSectionNavigation);
      clearTimeout(refreshTimeout);
    };
  }, []);
}
