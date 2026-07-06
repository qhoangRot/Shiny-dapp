import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Sparkles } from '@react-three/drei';
import { useRef } from 'react';
import type { Mesh } from 'three';

function HexPrism({
  position,
  scale,
  speed,
  color,
}: {
  position: [number, number, number];
  scale: number;
  speed: number;
  color: string;
}) {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * speed * 0.25;
      meshRef.current.rotation.y += delta * speed * 0.18;
    }
  });

  return (
    <Float speed={speed} rotationIntensity={0.5} floatIntensity={1.8}>
      <mesh ref={meshRef} position={position} scale={scale}>
        <cylinderGeometry args={[1, 1, 0.6, 6]} />
        <MeshDistortMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          roughness={0.15}
          metalness={0.7}
          distort={0.18}
          speed={1.6}
        />
      </mesh>
    </Float>
  );
}

export function Hero3D() {
  return (
    <div className="hero-3d-canvas">
      <Canvas camera={{ position: [0, 0, 10], fov: 50 }}>
        <ambientLight intensity={0.45} />
        <pointLight position={[6, 6, 6]} intensity={1.4} color="#B57DEE" />
        <pointLight position={[-6, -4, -4]} intensity={0.8} color="#4FD1C5" />
        <pointLight position={[0, 4, -8]} intensity={0.6} color="#9B5DE5" />

        <HexPrism position={[4.2, 1.4, -2]} scale={1.4} speed={0.7} color="#9B5DE5" />
        <HexPrism position={[-4.8, -1.2, -3]} scale={1.0} speed={1.0} color="#B57DEE" />
        <HexPrism position={[1.2, -2.4, -5]} scale={0.7} speed={1.3} color="#4FD1C5" />
        <HexPrism position={[-2.2, 2.6, -4]} scale={0.55} speed={1.5} color="#9B5DE5" />
        <HexPrism position={[3.4, -3.2, -6]} scale={0.5} speed={1.1} color="#B57DEE" />

        <Sparkles count={60} scale={12} size={2} speed={0.3} color="#B57DEE" opacity={0.5} />
      </Canvas>
    </div>
  );
}
