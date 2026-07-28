import { useEffect, useRef } from 'react';

const CHARACTERS = 'SHINY01$€◆+*:';

type AsciiCell = {
  baseX: number;
  baseY: number;
  nx: number;
  ny: number;
  noise: number;
  character: string;
  revealDistance: number;
  onOrbit: boolean;
};

function hash(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function AsciiCoinField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    let width = 0;
    let height = 0;
    let cellSize = 11;
    let cells: AsciiCell[] = [];
    let animationFrame = 0;
    let startTime = performance.now();
    let previousFrameTime = startTime;
    let isVisible = true;
    let needsRedraw = true;

    const buildCells = () => {
      cellSize = width < 620 ? 9 : 11;
      const columns = Math.ceil(width / cellSize);
      const rows = Math.ceil(height / cellSize);
      const minSide = Math.min(width, height);
      const originX = width * 0.2;
      const originY = height * 0.65;
      const maxDistance = Math.hypot(width, height);
      const nextCells: AsciiCell[] = [];

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const baseX = column * cellSize + cellSize / 2;
          const baseY = row * cellSize + cellSize / 2;
          const nx = (baseX - width * 0.5) / minSide;
          const ny = (baseY - height * 0.5) / minSide;
          const orbitX = (nx + 0.02) / 0.51;
          const orbitY = (ny - 0.01) / 0.22;
          const orbitDistance = Math.sqrt(orbitX * orbitX + orbitY * orbitY);
          const characterIndex = Math.floor(hash(column + 17, row + 31) * CHARACTERS.length);

          nextCells.push({
            baseX,
            baseY,
            nx,
            ny,
            noise: hash(column, row),
            character: CHARACTERS[characterIndex],
            revealDistance: Math.hypot(baseX - originX, baseY - originY) / maxDistance,
            onOrbit: Math.abs(orbitDistance - 1) < 0.018,
          });
        }
      }

      cells = nextCells;
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
      startTime = performance.now();
      previousFrameTime = startTime;
      needsRedraw = true;
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
      pointer.targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
      needsRedraw = true;
    };

    const onPointerLeave = () => {
      pointer.targetX = 0;
      pointer.targetY = 0;
      needsRedraw = true;
    };

    const draw = (now: number) => {
      animationFrame = requestAnimationFrame(draw);
      if (!isVisible) {
        previousFrameTime = now;
        return;
      }

      const elapsed = (now - startTime) / 1000;
      const reveal = reducedMotion ? 1 : Math.min(1, elapsed / 1.45);
      const frameScale = Math.min(3, Math.max(0.25, (now - previousFrameTime) / 16.667));
      const smoothing = 1 - Math.pow(0.9, frameScale);
      previousFrameTime = now;

      pointer.x += (pointer.targetX - pointer.x) * smoothing;
      pointer.y += (pointer.targetY - pointer.y) * smoothing;

      const pointerIsMoving =
        Math.abs(pointer.targetX - pointer.x) > 0.0005 ||
        Math.abs(pointer.targetY - pointer.y) > 0.0005;
      if (!needsRedraw && !pointerIsMoving && reveal >= 1) return;
      needsRedraw = false;

      context.clearRect(0, 0, width, height);
      context.font = `${Math.max(8, cellSize - 1)}px "JetBrains Mono", monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      const coins = [
        { cx: -0.1, cy: -0.03, rx: 0.33, ry: 0.43, color: [155, 93, 229] as const },
        { cx: 0.19, cy: 0.08, rx: 0.29, ry: 0.38, color: [63, 145, 255] as const },
      ];

      for (const cell of cells) {
        let bestDepth = -1;
        let selectedColor: readonly [number, number, number] | null = null;
        let selectedRadius = 0;

        for (const coin of coins) {
          const localX = (cell.nx - coin.cx) / coin.rx;
          const localY = (cell.ny - coin.cy) / coin.ry;
          const radius = Math.sqrt(localX * localX + localY * localY);

          if (radius <= 1) {
            const depth = Math.sqrt(1 - radius * radius);
            if (depth > bestDepth) {
              bestDepth = depth;
              selectedColor = coin.color;
              selectedRadius = radius;
            }
          }
        }

        if (!selectedColor && !cell.onOrbit) continue;

        const revealAlpha = Math.max(0, Math.min(1, (reveal * 1.45 - cell.revealDistance) * 4));
        if (revealAlpha <= 0) continue;
        if (selectedColor && cell.noise > 0.79 + bestDepth * 0.18) continue;
        if (cell.onOrbit && cell.noise > 0.62) continue;

        const depth = selectedColor ? bestDepth : 0.15;
        const parallaxX = pointer.x * depth * 18;
        const parallaxY = pointer.y * depth * 13;
        const character = cell.onOrbit && !selectedColor ? '·' : cell.character;
        const alpha = revealAlpha * (cell.onOrbit && !selectedColor ? 0.38 : 0.28 + depth * 0.72);

        if (selectedColor) {
          const edgeGlow = selectedRadius > 0.88 ? 1.18 : 1;
          const [red, green, blue] = selectedColor;
          context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.min(1, alpha * edgeGlow)})`;
        } else {
          context.fillStyle = `rgba(155, 93, 229, ${alpha})`;
        }

        context.fillText(character, cell.baseX + parallaxX, cell.baseY + parallaxY);
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) needsRedraw = true;
      },
      { rootMargin: '100px' },
    );

    resizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    resize();
    animationFrame = requestAnimationFrame(draw);

    return () => {
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div
      className="ascii-coin-field"
      role="img"
      aria-label="An interactive field of characters forming two overlapping stablecoins"
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
