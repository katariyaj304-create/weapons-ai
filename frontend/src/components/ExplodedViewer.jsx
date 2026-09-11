/**
 * ExplodedViewer — 3D exploding view of generated asset components.
 * Loads separate GLB models and arranges them with assembly/explode/ring animations.
 */
import React, { useState, useRef, useEffect, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, ContactShadows, Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// Risk tier colors
const RISK_COLORS = {
  CRITICAL: '#ff2d55',
  ELEVATED: '#ff9500',
  STABLE: '#30d158',
};

function getRiskColor(tier) {
  return RISK_COLORS[(tier || '').toUpperCase()] || '#0088ff';
}

// --- Individual Component Model ---
function ComponentModel({ component, index, total, viewMode, isActive, isHovered, onClick, onHover }) {
  const groupRef = useRef();
  const targetPos = useRef(new THREE.Vector3());
  const currentPos = useRef(new THREE.Vector3());

  // Calculate positions for different view modes
  const positions = useMemo(() => {
    const angle = (index / total) * Math.PI * 2;
    const yOffset = (index - total / 2) * 0.6;
    return {
      assembled: new THREE.Vector3(0, yOffset * 0.3, 0),
      exploded: new THREE.Vector3(
        Math.cos(angle) * 4,
        yOffset * 0.5 + 0.5,
        Math.sin(angle) * 4
      ),
      ring: new THREE.Vector3(
        Math.cos(angle) * 2.5,
        0,
        Math.sin(angle) * 2.5
      ),
    };
  }, [index, total]);

  // Update target position based on view mode
  useEffect(() => {
    targetPos.current.copy(positions[viewMode] || positions.assembled);
  }, [viewMode, positions]);

  // Smooth lerp animation
  useFrame(() => {
    if (!groupRef.current) return;
    currentPos.current.lerp(targetPos.current, 0.06);
    groupRef.current.position.copy(currentPos.current);
  });

  const riskColor = getRiskColor(component.risk_tier);
  const hasGlb = !!component.glb_url;

  return (
    <group ref={groupRef}>
      {hasGlb ? (
        <Suspense fallback={<PlaceholderBox component={component} riskColor={riskColor} />}>
          <GLBModel
            url={component.glb_url}
            isActive={isActive}
            isHovered={isHovered}
            riskColor={riskColor}
            onClick={() => onClick?.(component)}
            onHover={(h) => onHover?.(component, h)}
          />
        </Suspense>
      ) : (
        <PlaceholderBox
          component={component}
          riskColor={riskColor}
          onClick={() => onClick?.(component)}
          onHover={(h) => onHover?.(component, h)}
        />
      )}

      {/* Floating Label */}
      <Html position={[0, 1.5, 0]} center distanceFactor={8} zIndexRange={[10, 0]}>
        <div
          className="component-3d-label"
          onClick={() => onClick?.(component)}
          style={{ borderColor: isActive ? riskColor : undefined }}
        >
          <div className="label-name">{component.part_name}</div>
          <div className="label-material">{component.material_dependency}</div>
          <div
            className="label-risk"
            style={{
              color: riskColor,
              background: `${riskColor}15`,
            }}
          >
            {component.risk_tier} — {component.risk_score}
          </div>
        </div>
      </Html>
    </group>
  );
}

// --- GLB Model Loader ---
function GLBModel({ url, isActive, isHovered, riskColor, onClick, onHover }) {
  const { scene } = useGLTF(url);
  const ref = useRef();

  useEffect(() => {
    if (!scene) return;
    // Auto-scale to fit ~1.5 units
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 1.5 / maxDim : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    // Center the model
    const newBox = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    newBox.getCenter(center);
    scene.position.sub(center);
  }, [scene]);

  // Active/hover highlight
  useFrame(() => {
    if (!ref.current) return;
    scene.traverse((child) => {
      if (child.isMesh && child.material) {
        if (isActive || isHovered) {
          child.material.emissive = new THREE.Color(riskColor);
          child.material.emissiveIntensity = isActive ? 0.3 : 0.15;
        } else {
          child.material.emissiveIntensity = 0;
        }
      }
    });
  });

  return (
    <group
      ref={ref}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
      onPointerOut={() => onHover?.(false)}
    >
      <primitive object={scene.clone(true)} />
    </group>
  );
}

// --- Placeholder Box ---
function PlaceholderBox({ component, riskColor, onClick, onHover }) {
  const ref = useRef();

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
  });

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
      onPointerOut={() => onHover?.(false)}
    >
      <mesh ref={ref} castShadow>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial
          color={riskColor}
          metalness={0.6}
          roughness={0.3}
          transparent
          opacity={0.7}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[0.82, 0.82, 0.82]} />
        <meshBasicMaterial color={riskColor} wireframe transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// --- Scene Background ---
function SetBackground() {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color('#FFFFFF');
    scene.fog = new THREE.Fog('#FFFFFF', 8, 35);
  }, [scene]);
  return null;
}

// --- Auto Rotate Group ---
function AutoRotateGroup({ children, active }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current && !active) {
      ref.current.rotation.y += delta * 0.15;
    }
  });
  return <group ref={ref}>{children}</group>;
}

// --- Main Exploded Viewer ---
export default function ExplodedViewer({ components, onComponentClick, activeComponent }) {
  const [viewMode, setViewMode] = useState('exploded');
  const [hoveredComponent, setHoveredComponent] = useState(null);
  const validComponents = components.filter(c => c.part_name);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [6, 4, 6], fov: 50, near: 0.1, far: 100 }}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.4,
        }}
        style={{ background: '#FFFFFF' }}
      >
        <SetBackground />
        <Environment preset="studio" />
        <ambientLight intensity={0.6} color="#ffffff" />
        <directionalLight position={[8, 12, 8]} intensity={1.0} color="#ffffff" castShadow shadow-mapSize={[2048, 2048]} />
        <directionalLight position={[-5, 6, -5]} intensity={0.4} color="#e8eae7" />
        <pointLight position={[0, 8, 0]} intensity={0.5} color="#ffffff" distance={15} />

        {/* Platform */}
        <mesh position={[0, -0.05, 0]} receiveShadow>
          <cylinderGeometry args={[6, 6.5, 0.1, 64]} />
          <meshStandardMaterial color="#e0e0e0" metalness={0.4} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[5.8, 6, 64]} />
          <meshBasicMaterial color="#0088ff" opacity={0.3} transparent />
        </mesh>

        <Grid
          position={[0, -0.06, 0]} args={[30, 30]}
          cellSize={0.5} cellThickness={0.5} cellColor="#e8e8e8"
          sectionSize={2} sectionThickness={1} sectionColor="#d0d0d0"
          fadeDistance={25} fadeStrength={1} followCamera={false} infiniteGrid
        />
        <ContactShadows position={[0, -0.04, 0]} opacity={0.4} scale={15} blur={2} far={5} color="#000000" />

        {/* Component Models */}
        <AutoRotateGroup active={!!activeComponent}>
          {validComponents.map((comp, i) => (
            <ComponentModel
              key={`${comp.part_name}-${i}`}
              component={comp}
              index={i}
              total={validComponents.length}
              viewMode={viewMode}
              isActive={activeComponent?.part_name === comp.part_name}
              isHovered={hoveredComponent?.part_name === comp.part_name}
              onClick={onComponentClick}
              onHover={(c, h) => setHoveredComponent(h ? c : null)}
            />
          ))}
        </AutoRotateGroup>

        <OrbitControls
          makeDefault enableDamping dampingFactor={0.05}
          minDistance={2} maxDistance={25} maxPolarAngle={Math.PI / 1.8}
        />
      </Canvas>

      {/* View Mode Toggle */}
      <div className="explode-controls">
        {['assembled', 'exploded', 'ring'].map(mode => (
          <button
            key={mode}
            className={`explode-btn ${viewMode === mode ? 'active' : ''}`}
            onClick={() => setViewMode(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  );
}
