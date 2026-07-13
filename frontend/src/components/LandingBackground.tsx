import { Suspense, useEffect, useMemo, useState } from 'react';
import { Hero3D } from './Hero3D';

const STAR_COUNT = 130;
const METEOR_COUNT = 2;

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

type Meteor = {
  seed: number;
  top: number;
  left: number;
  angle: number;
  cycle: number;
};

function createMeteor(): Meteor {
  return {
    seed: Math.random(),
    top: randomBetween(0, 75),
    left: randomBetween(0, 100),
    angle: randomBetween(15, 55),
    cycle: randomBetween(3, 6),
  };
}

/// Nen co dinh DUY NHAT cho toan bo Landing Page: sao dem + sao bang + 2 dong xu 3D.
/// position: fixed - khong bao gio cuon theo noi dung, luon phu kin viewport.
export function LandingBackground() {
  const [coinsReady, setCoinsReady] = useState(false);

  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }).map((_, i) => ({
        id: i,
        top: randomBetween(0, 100),
        left: randomBetween(0, 100),
        size: randomBetween(1, 2),
        delay: randomBetween(0, 6),
        duration: randomBetween(3, 7),
      })),
    []
  );

  // Moi sao bang tu "random lai" vi tri/goc sau moi chu ky - khong con dung yen 1 cho
  const [meteors, setMeteors] = useState<Meteor[]>(() =>
    Array.from({ length: METEOR_COUNT }, () => createMeteor())
  );

  useEffect(() => {
    let mounted = true;
    const timeoutIds: number[] = [];

    function schedule(index: number, delayMs: number) {
      const timeoutId = window.setTimeout(() => {
        if (!mounted) return;
        const fresh = createMeteor();
        setMeteors((prev) => {
          const next = [...prev];
          next[index] = fresh;
          return next;
        });
        schedule(index, fresh.cycle * 1000);
      }, delayMs);
      timeoutIds.push(timeoutId);
    }

    meteors.forEach((m, i) => schedule(i, m.cycle * 1000));

    return () => {
      mounted = false;
      timeoutIds.forEach((id) => clearTimeout(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="landing-bg" aria-hidden="true">
      <div className="landing-bg__stars">
        {stars.map((s) => (
          <span
            key={s.id}
            className="star"
            style={{
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`,
            }}
          />
        ))}
        {meteors.map((m, i) => (
          <span
            // key doi moi lien tuc theo seed -> React remount -> animation CSS tu chay lai tu dau
            key={`${i}-${m.seed}`}
            className="meteor-slot"
            style={{
              top: `${m.top}%`,
              left: `${m.left}%`,
              transform: `rotate(${m.angle}deg)`,
            }}
          >
            <span className="meteor-bar" />
          </span>
        ))}
      </div>

      <div className={`landing-bg__coins ${coinsReady ? 'landing-bg__coins--ready' : ''}`}>
        <Suspense fallback={null}>
          <Hero3D onReady={() => setCoinsReady(true)} />
        </Suspense>
      </div>
    </div>
  );
}
