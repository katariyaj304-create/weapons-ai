/**
 * Canvas3D — R3F Canvas with light Ivory Command aesthetic.
 * Uses bright studio-style lighting with soft shadows.
 */
import React, { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useCameraFocus } from '../hooks/useCameraFocus';
import ModelViewer from './ModelViewer';

function SetBackground() {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color('#FFFFFF');
    scene.fog = new THREE.Fog('#FFFFFF', 5, 30);
  }, [scene]);
  return null;
}

function SceneContent({ modelUrl, parts, activePart, onPartClick, onMeshNamesFound, cameraFocus }) {
  const { CameraAnimator } = cameraFocus;

  return (
    <>
      <SetBackground />
      <CameraAnimator />

      {/* Clean Lab Lighting */}
      <Environment preset="studio" />
      <ambientLight intensity={0.6} color="#ffffff" />
      <directionalLight
        position={[8, 12, 8]}
        intensity={1.0}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight
        position={[-5, 6, -5]}
        intensity={0.4}
        color="#e8eae7"
      />
      <pointLight position={[0, 8, 0]} intensity={0.5} color="#ffffff" distance={15} />

      {/* Military Lab Platform - Clean Aesthetic */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[5, 5.5, 0.1, 64]} />
        <meshStandardMaterial color="#e0e0e0" metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Tech Ring */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.8, 5, 64]} />
        <meshBasicMaterial color="#0088ff" opacity={0.3} transparent />
      </mesh>

      {/* Clean tactical grid */}
      <Grid
        position={[0, -0.06, 0]}
        args={[30, 30]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#e8e8e8"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#d0d0d0"
        fadeDistance={25}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid
      />

      {/* Contact shadows for grounding */}
      <ContactShadows
        position={[0, -0.04, 0]}
        opacity={0.4}
        scale={15}
        blur={2}
        far={5}
        color="#000000"
      />

      {/* 3D Model with annotations */}
      <ModelViewer
        modelUrl={modelUrl}
        parts={parts}
        activePart={activePart}
        onPartClick={onPartClick}
        onMeshNamesFound={onMeshNamesFound}
      />

      {/* Orbit controls */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        minDistance={1}
        maxDistance={20}
        maxPolarAngle={Math.PI / 1.8}
        autoRotate={!activePart}
        autoRotateSpeed={0.5}
      />
    </>
  );
}

export default function Canvas3D({ modelUrl, parts, activePart, onPartClick, onMeshNamesFound }) {
  const cameraFocus = useCameraFocus();

  return (
    <Canvas
      camera={{ position: [5, 3, 5], fov: 50, near: 0.1, far: 1000 }}
      shadows
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        toneMapping: 3, // ACESFilmicToneMapping
        toneMappingExposure: 1.4,
      }}
      style={{ background: '#FFFFFF' }}
    >
      <SceneContent
        modelUrl={modelUrl}
        parts={parts}
        activePart={activePart}
        onPartClick={(part) => {
          onPartClick?.(part);
          if (part) {
            cameraFocus.focusOn(
              { x: 0, y: 1, z: 0 },
              { x: 2, y: 1.5, z: 2 }
            );
          }
        }}
        onMeshNamesFound={onMeshNamesFound}
        cameraFocus={cameraFocus}
      />
    </Canvas>
  );
}
