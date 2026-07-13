import { Canvas, useFrame } from '@react-three/fiber';
import { Float, useTexture } from '@react-three/drei';
import { useRef } from 'react';
import type { Group } from 'three';
import usdcLogo from '../assets/usdc-logo.png';
import eurcLogo from '../assets/eurc-logo.png';

type TokenCoinProps = {
  position: [number, number, number];
  scale: number;
  speed: number;
  color: string;
  logoSrc: string;
};

function TokenCoin({ position, scale, speed, color, logoSrc }: TokenCoinProps) {
  const spinRef = useRef<Group>(null);
  const logoTexture = useTexture(logoSrc);

  useFrame((_, delta) => {
    if (spinRef.current) {
      spinRef.current.rotation.y += delta * speed * 0.15;
    }
  });

  return (
    <Float speed={speed * 0.6} rotationIntensity={0.08} floatIntensity={0.8}>
      <group position={position} scale={scale} rotation={[Math.PI / 2, 0, 0]}>
        <group ref={spinRef}>
          <mesh>
            <cylinderGeometry args={[1, 1, 0.14, 96]} />
            <meshStandardMaterial attach="material-0" color={color} metalness={0.3} roughness={0.6} />
            <meshStandardMaterial attach="material-1" map={logoTexture} metalness={0.2} roughness={0.6} />
            <meshStandardMaterial attach="material-2" map={logoTexture} metalness={0.2} roughness={0.6} />
          </mesh>
        </group>
      </group>
    </Float>
  );
}

export function Hero3D({ onReady }: { onReady?: () => void }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 9], fov: 48 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      performance={{ min: 0.5 }}
      onCreated={() => onReady?.()}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={0.4} />

      <TokenCoin position={[3.6, 1, -2]} scale={1.6} speed={0.5} color="#2775CA" logoSrc={usdcLogo} />
      <TokenCoin position={[-3.8, -1.2, -3]} scale={1.25} speed={0.65} color="#1B4CE0" logoSrc={eurcLogo} />
    </Canvas>
  );
}
