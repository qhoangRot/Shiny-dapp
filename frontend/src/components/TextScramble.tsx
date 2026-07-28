import { useEffect, useRef, useState } from 'react';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$€#+*';

type TextScrambleProps = {
  text: string;
  className?: string;
  replayKey?: number;
};

export function TextScramble({ text, className = '', replayKey }: TextScrambleProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [scramble, setScramble] = useState({
    display: text,
    resolved: text.length,
  });

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setScramble({ display: text, resolved: text.length });
      return;
    }

    let animationFrame = 0;
    const runScramble = () => {
      window.cancelAnimationFrame(animationFrame);
      const duration = Math.max(520, Math.min(820, text.length * 18));
      const startedAt = performance.now();

      const update = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const settled = Math.floor(progress * text.length);
        const display = Array.from(text)
          .map((character, index) => {
            if (character === ' ' || index < settled) return character;
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          })
          .join('');

        setScramble({ display, resolved: settled });

        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(update);
          return;
        }

        setScramble({ display: text, resolved: text.length });
      };

      animationFrame = window.requestAnimationFrame(update);
    };

    let observer: IntersectionObserver | null = null;
    if (replayKey !== undefined && replayKey > 0) {
      runScramble();
    } else {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          observer?.disconnect();
          runScramble();
        },
        { threshold: 0.35 },
      );
      observer.observe(element);
    }

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [replayKey, text]);

  return (
    <span ref={rootRef} className={`text-scramble ${className}`} aria-label={text}>
      <span className="text-scramble__measure" aria-hidden="true">{text}</span>
      <span className="text-scramble__visual" aria-hidden="true">
        {Array.from(scramble.display).map((character, index) => (
          <span
            key={index}
            className={
              index >= scramble.resolved && character !== ' '
                ? 'text-scramble__unresolved'
                : ''
            }
          >
            {character}
          </span>
        ))}
      </span>
    </span>
  );
}
