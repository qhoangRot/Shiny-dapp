import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { TokenCoin } from './Hero3D';
import usdcLogo from '../assets/usdc-logo.png';
import eurcLogo from '../assets/eurc-logo.png';

const CARD_SELECTOR = '.glass-panel, .markets-card';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/// Lop overlay rieng: ve lai chinh 2 dong xu (cung vi tri/mau), roi lam mo
/// bang filter: blur() TRUC TIEP tren canvas nay (khong dung backdrop-filter,
/// vi backdrop-filter khong dang tin cay voi WebGL canvas). Sau do dung SVG
/// clipPath (ho tro nhieu hinh chu nhat roi rac, khac voi CSS clip-path chi
/// ho tro 1 duong vien) de CHI hien lop mo nay dung trong pham vi tung khung
/// (.glass-panel, .markets-card). Ben ngoai khung, lop nay trong suot hoan
/// toan -> dong xu that (sac net) o lop nen phia duoi van hien binh thuong.
export function BlurredCoinsOverlay() {
  const [rects, setRects] = useState<Rect[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function updateRects() {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
      setRects(
        cards.map((card) => {
          const b = card.getBoundingClientRect();
          return { x: b.left, y: b.top, width: b.width, height: b.height };
        })
      );
      rafRef.current = requestAnimationFrame(updateRects);
    }
    rafRef.current = requestAnimationFrame(updateRects);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <clipPath id="card-windows-clip" clipPathUnits="userSpaceOnUse">
          {rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={16} />
          ))}
        </clipPath>
        <clipPath id="card-windows-inverse-clip" clipPathUnits="userSpaceOnUse">
          <path
            fillRule="evenodd"
            d={
              `M0,0 H${window.innerWidth} V${window.innerHeight} H0 Z ` +
              rects
                .map(
                  (r) =>
                    `M${r.x},${r.y} h${r.width} v${r.height} h${-r.width} Z`
                )
                .join(' ')
            }
          />
        </clipPath>
      </svg>

      <div className="blurred-coins-overlay">
        <Canvas
          camera={{ position: [0, 0, 9], fov: 48 }}
          dpr={[1, 1.25]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 5, 4]} intensity={0.4} />
          <TokenCoin position={[3.6, 1, -2]} scale={1.6} speed={0.5} color="#2775CA" logoSrc={usdcLogo} />
          <TokenCoin position={[-3.8, -1.2, -3]} scale={1.25} speed={0.65} color="#1B4CE0" logoSrc={eurcLogo} />
        </Canvas>
      </div>
    </>
  );
}
