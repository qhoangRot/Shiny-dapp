import { useEffect, useRef } from 'react';

const FOOTER_GLYPHS = 'SHINY01$€◆+*:';

type Point = {
  x: number;
  y: number;
};

type FooterCell = {
  x: number;
  y: number;
  character: string;
  baseAlpha: number;
  revealThreshold: number;
};

const PURPLE = [155, 93, 229] as const;
const BLUE = [63, 145, 255] as const;

function hash(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function cubicPoint(
  progress: number,
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
) {
  const inverse = 1 - progress;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * progress * controlA.x +
      3 * inverse * progress ** 2 * controlB.x +
      progress ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * progress * controlA.y +
      3 * inverse * progress ** 2 * controlB.y +
      progress ** 3 * end.y,
  };
}

function cubicTangent(
  progress: number,
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
) {
  const inverse = 1 - progress;
  return {
    x:
      3 * inverse ** 2 * (controlA.x - start.x) +
      6 * inverse * progress * (controlB.x - controlA.x) +
      3 * progress ** 2 * (end.x - controlB.x),
    y:
      3 * inverse ** 2 * (controlA.y - start.y) +
      6 * inverse * progress * (controlB.y - controlA.y) +
      3 * progress ** 2 * (end.y - controlB.y),
  };
}

export function FooterAsciiField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      glow: 0,
      targetGlow: 0,
    };
    let width = 0;
    let height = 0;
    let cellSize = 10;
    let cells: FooterCell[] = [];
    let animationFrame = 0;
    let previousFrameTime = performance.now();
    let revealStartedAt = 0;
    let hasRevealed = false;
    let isVisible = false;
    let needsRedraw = true;
    let sweepStartedAt = 0;
    let isSweeping = false;
    const sweepDuration = reducedMotion ? 700 : 1_600;

    const buildCells = () => {
      if (width <= 0 || height <= 0) return;

      cellSize = width < 680 ? 8 : 10;
      const nextCells = new Map<string, FooterCell>();
      const streams = [
        {
          start: { x: -width * 0.04, y: height * 0.5 },
          controlA: { x: width * 0.12, y: height * 0.88 },
          controlB: { x: width * 0.34, y: height * 0.88 },
          end: { x: width * 0.5, y: height * 0.5 },
          side: 0,
        },
        {
          start: { x: width * 1.04, y: height * 0.5 },
          controlA: { x: width * 0.88, y: height * 0.12 },
          controlB: { x: width * 0.66, y: height * 0.12 },
          end: { x: width * 0.5, y: height * 0.5 },
          side: 1,
        },
      ];
      const laneCount = width < 680 ? 5 : 7;
      const laneMiddle = (laneCount - 1) / 2;
      const sampleCount = Math.max(100, Math.round(width * 0.13));

      streams.forEach((stream) => {
        for (let lane = 0; lane < laneCount; lane += 1) {
          const laneDistance = lane - laneMiddle;
          const laneFade = 1 - Math.abs(laneDistance) / (laneMiddle + 1.5);

          for (let sample = 0; sample <= sampleCount; sample += 1) {
            if (stream.side === 1 && sample === sampleCount) continue;
            const progress = sample / sampleCount;
            const point = cubicPoint(
              progress,
              stream.start,
              stream.controlA,
              stream.controlB,
              stream.end,
            );
            const tangent = cubicTangent(
              progress,
              stream.start,
              stream.controlA,
              stream.controlB,
              stream.end,
            );
            const tangentLength = Math.max(1, Math.hypot(tangent.x, tangent.y));
            const normalX = -tangent.y / tangentLength;
            const normalY = tangent.x / tangentLength;
            const breathingRoom = Math.sin(progress * Math.PI);
            const laneOffset = laneDistance * cellSize * (1.1 + breathingRoom * 0.75);
            const x = point.x + normalX * laneOffset;
            const y = point.y + normalY * laneOffset;
            if (x < -cellSize || x > width + cellSize || y < 0 || y > height) continue;

            const column = Math.round(x / cellSize);
            const row = Math.round(y / cellSize);
            const key = `${stream.side}:${column}:${row}`;
            const noise = hash(column + stream.side * 101, row + lane * 17);
            if (noise > 0.9) continue;

            const characterIndex = Math.floor(
              hash(column + 41, row + 73 + stream.side * 31) * FOOTER_GLYPHS.length,
            );
            const edgeFade = clamp(Math.sin(progress * Math.PI) * 1.35 + 0.18);
            const baseAlpha = (0.24 + noise * 0.58) * laneFade * edgeFade;
            const existingCell = nextCells.get(key);

            if (!existingCell || baseAlpha > existingCell.baseAlpha) {
              nextCells.set(key, {
                x: column * cellSize,
                y: row * cellSize,
                character:
                  sample % Math.max(12, Math.round(sampleCount / 9)) === 0
                    ? '◆'
                    : FOOTER_GLYPHS[characterIndex],
                baseAlpha,
                revealThreshold: progress * 0.9 + Math.abs(laneDistance) * 0.018,
              });
            }
          }
        }
      });

      cells = [...nextCells.values()];
      needsRedraw = true;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildCells();
      needsRedraw = true;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isVisible) return;
      const rect = canvas.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!inside) {
        pointer.targetGlow = 0;
        needsRedraw = true;
        return;
      }

      pointer.targetX = event.clientX - rect.left;
      pointer.targetY = event.clientY - rect.top;
      if (pointer.glow < 0.01) {
        pointer.x = pointer.targetX;
        pointer.y = pointer.targetY;
      }
      pointer.targetGlow = 1;
      needsRedraw = true;
    };

    const onWindowLeave = () => {
      pointer.targetGlow = 0;
      needsRedraw = true;
    };

    const startColorSweep = () => {
      if (isSweeping) return;

      sweepStartedAt = performance.now();
      isSweeping = true;
      needsRedraw = true;
    };

    const onFooterClick = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('a, button')) return;
      startColorSweep();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      startColorSweep();
    };

    const draw = (now: number) => {
      animationFrame = requestAnimationFrame(draw);
      if (!isVisible || !hasRevealed) {
        previousFrameTime = now;
        return;
      }

      const frameScale = Math.min(3, Math.max(0.25, (now - previousFrameTime) / 16.667));
      const smoothing = 1 - Math.pow(0.86, frameScale);
      previousFrameTime = now;

      pointer.x += (pointer.targetX - pointer.x) * smoothing;
      pointer.y += (pointer.targetY - pointer.y) * smoothing;
      pointer.glow += (pointer.targetGlow - pointer.glow) * smoothing;

      const revealProgress = reducedMotion ? 1 : clamp((now - revealStartedAt) / 1_700);
      const pointerMoving =
        Math.abs(pointer.targetX - pointer.x) > 0.15 ||
        Math.abs(pointer.targetY - pointer.y) > 0.15 ||
        Math.abs(pointer.targetGlow - pointer.glow) > 0.005;

      let sweepProgress = 1;
      if (isSweeping) {
        sweepProgress = clamp((now - sweepStartedAt) / sweepDuration);
        if (sweepProgress >= 1) {
          isSweeping = false;
        }
      }

      if (!needsRedraw && revealProgress >= 1 && !pointerMoving && !isSweeping) return;
      needsRedraw = false;

      context.clearRect(0, 0, width, height);
      context.font = `${Math.max(8, cellSize - 1)}px "JetBrains Mono", monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const spotlightRadius = width < 680 ? 48 : 72;

      for (const cell of cells) {
        const revealAlpha = clamp((revealProgress * 1.38 - cell.revealThreshold) * 4.2);
        if (revealAlpha <= 0) continue;

        const distanceToPointer = Math.hypot(cell.x - pointer.x, cell.y - pointer.y);
        const spotlight = clamp(1 - distanceToPointer / spotlightRadius) ** 4 * pointer.glow;
        const horizontalProgress = clamp(cell.x / Math.max(1, width));
        let colorProgress = horizontalProgress;
        let colorPulse = 0;

        if (isSweeping) {
          const sweepCenter = lerp(-0.24, 1.24, sweepProgress);
          const pulseDistance = Math.abs(horizontalProgress - sweepCenter);
          const pulse = clamp(1 - pulseDistance / 0.26);
          colorPulse = pulse * pulse * (3 - 2 * pulse);
          colorProgress = lerp(horizontalProgress, 1 - horizontalProgress, colorPulse);
        }

        const visibleSpotlight = isSweeping ? spotlight * 0.12 : spotlight;
        const red = Math.round(lerp(PURPLE[0], BLUE[0], colorProgress));
        const green = Math.round(lerp(PURPLE[1], BLUE[1], colorProgress));
        const blue = Math.round(lerp(PURPLE[2], BLUE[2], colorProgress));
        const litRed = Math.round(red + (245 - red) * visibleSpotlight);
        const litGreen = Math.round(green + (243 - green) * visibleSpotlight);
        const litBlue = Math.round(blue + (247 - blue) * visibleSpotlight);
        const alpha = clamp(
          (cell.baseAlpha + visibleSpotlight * 0.42 + colorPulse * 0.18) * revealAlpha,
        );

        context.fillStyle = `rgba(${litRed}, ${litGreen}, ${litBlue}, ${alpha})`;
        context.fillText(cell.character, cell.x, cell.y);
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible && !hasRevealed) {
          hasRevealed = true;
          revealStartedAt = performance.now();
        }
        if (isVisible) needsRedraw = true;
      },
      { threshold: 0.08 },
    );
    const visibilityTarget = canvas.closest('.shiny-footer-reveal') ?? canvas;
    const interactionTarget = canvas.closest<HTMLElement>('.shiny-footer') ?? canvas.parentElement;
    const keyboardTarget = canvas.parentElement;

    resizeObserver.observe(canvas);
    visibilityObserver.observe(visibilityTarget);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onWindowLeave);
    interactionTarget?.addEventListener('click', onFooterClick);
    keyboardTarget?.addEventListener('keydown', onKeyDown);
    resize();
    animationFrame = requestAnimationFrame(draw);

    return () => {
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onWindowLeave);
      interactionTarget?.removeEventListener('click', onFooterClick);
      keyboardTarget?.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div
      className="footer-ascii-field"
      role="button"
      tabIndex={0}
      aria-label="Play a left-to-right color pulse across the ASCII capital wave"
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
