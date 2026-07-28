import { useCallback, useEffect, useRef, useState } from 'react';

export function CountUp({
  value,
  suffix = '',
  duration = 1.2,
}: {
  value: number;
  suffix?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const elementRef = useRef<HTMLSpanElement>(null);
  const displayRef = useRef(0);
  const latestValueRef = useRef(value);
  const isVisibleRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  const updateDisplay = useCallback((nextValue: number) => {
    displayRef.current = nextValue;
    setDisplay(nextValue);
  }, []);

  const animateTo = useCallback((targetValue: number) => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (
      duration <= 0 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      updateDisplay(targetValue);
      animationFrameRef.current = null;
      return;
    }

    const startValue = displayRef.current;
    const difference = targetValue - startValue;

    if (Math.abs(difference) < Number.EPSILON) {
      updateDisplay(targetValue);
      animationFrameRef.current = null;
      return;
    }

    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      updateDisplay(startValue + difference * eased);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        updateDisplay(targetValue);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }, [duration, updateDisplay]);

  useEffect(() => {
    latestValueRef.current = value;
    if (isVisibleRef.current) animateTo(value);
  }, [animateTo, value]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) animateTo(latestValueRef.current);
      },
      { threshold: 0.4 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [animateTo]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return (
    <span ref={elementRef}>
      {display.toFixed(2)}
      {suffix}
    </span>
  );
}
