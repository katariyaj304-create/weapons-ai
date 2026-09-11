/**
 * ModelViewer — loads GLB models, traverses scene graph, matches mesh IDs,
 * and renders annotations at mesh world positions.
 */
import React, { useRef, useEffect, useState, useMemo, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import Annotation from './Annotation';

// Solid shape highlight
function BlueprintHighlight({ mesh, color, isActive }) {
  const ref = useRef();

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    // Subtle breathing animation for active parts
    if (isActive) {
      ref.current.material.opacity = 0.5 + Math.sin(t * 3) * 0.1;
    }
  });

  if (!mesh) return null;

  const geometry = mesh.geometry;
  if (!geometry) return null;

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      position={mesh.position}
      rotation={mesh.rotation}
      scale={mesh.scale}
      matrixWorld={mesh.matrixWorld}
    >
      <meshBasicMaterial
        color={'#00b4d8'} // Blue shape like army app
        transparent
        opacity={isActive ? 0.6 : 0.0}
        side={THREE.DoubleSide}
        depthWrite={false}
        depthTest={true}
      />
    </mesh>
  );
}

function ModelContent({ url, parts, activePart, onPartClick, onMeshNamesFound }) {
  const { scene } = useGLTF(url);
  const modelRef = useRef();
  const [meshMap, setMeshMap] = useState({});
  const [meshPositions, setMeshPositions] = useState({});

  // Traverse scene graph and build mesh map
  useEffect(() => {
    if (!scene) return;

    // --- AUTO-SCALING AND CENTERING ---
    // Reset to identity first
    scene.position.set(0, 0, 0);
    scene.scale.set(1, 1, 1);
    scene.rotation.set(0, 0, 0);
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    
    // Find the maximum dimension
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // Scale the model so its largest dimension is ~8 units
    const targetSize = 8;
    const scale = maxDim > 0 ? targetSize / maxDim : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    // Update the box after scaling to find the new center
    box.setFromObject(scene);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Move the model so its center is at the origin, but rest it on the floor (y=0)
    scene.position.x = -center.x;
    scene.position.z = -center.z;
    scene.position.y = -box.min.y; // Bottom of the model sits at y=0

    // Force update matrix world so all children get the new transform
    scene.updateMatrixWorld(true);
    // ------------------------------------

    const map = {};
    const positions = {};
    const meshNames = [];

    scene.traverse((child) => {
      if (child.isMesh && child.name) {
        map[child.name] = child;
        meshNames.push(child.name);

        // Get world position for annotation placement
        const worldPos = new THREE.Vector3();
        child.getWorldPosition(worldPos);

        // Get bounding box center for better placement
        if (child.geometry) {
          child.geometry.computeBoundingBox();
          const bbox = child.geometry.boundingBox;
          if (bbox) {
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            center.applyMatrix4(child.matrixWorld);
            positions[child.name] = {
              x: center.x,
              y: center.y + 0.2, // Slightly above
              z: center.z
            };
          }
        }

        if (!positions[child.name]) {
          positions[child.name] = {
            x: worldPos.x,
            y: worldPos.y + 0.2,
            z: worldPos.z
          };
        }

        // Keep original materials intact
      }
    });

    setMeshMap(map);
    setMeshPositions(positions);
    onMeshNamesFound?.(meshNames);

    console.log('[ModelViewer] Found meshes:', meshNames);
  }, [scene, onMeshNamesFound]);

  // Fuzzy match a part's mesh_id to actual mesh names
  const findMesh = (meshId) => {
    // Exact match first
    if (meshMap[meshId]) return meshId;

    // Case-insensitive match
    const lower = meshId.toLowerCase();
    const keys = Object.keys(meshMap);
    const found = keys.find(k => k.toLowerCase() === lower);
    if (found) return found;

    // Partial match (mesh_id contains or is contained by a mesh name)
    const partial = keys.find(k =>
      k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())
    );
    if (partial) return partial;

    // Word-based fuzzy match
    const words = lower.replace(/[_-]/g, ' ').split(/\s+/);
    const scored = keys.map(k => {
      const kWords = k.toLowerCase().replace(/[_-]/g, ' ').split(/\s+/);
      let score = 0;
      words.forEach(w => {
        if (kWords.some(kw => kw.includes(w) || w.includes(kw))) score++;
      });
      return { name: k, score };
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) return scored[0].name;

    return null;
  };

  const [hoveredPart, setHoveredPart] = useState(null);

  // Auto-rotate when no part is focused
  useFrame((state, delta) => {
    if (modelRef.current && !activePart) {
      modelRef.current.rotation.y += delta * 0.15;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={scene} />

      {/* Render annotations and highlights for matched parts */}
      {parts && parts.map((part, index) => {
        const matchedName = findMesh(part.mesh_id);
        const mesh = matchedName ? meshMap[matchedName] : null;
        const position = matchedName ? meshPositions[matchedName] : null;
        const isActive = activePart?.mesh_id === part.mesh_id;
        const isHovered = hoveredPart?.mesh_id === part.mesh_id;

        return (
          <React.Fragment key={`${part.mesh_id}-${index}`}>
            {/* Highlight overlay - ONLY SHOW WHEN HOVERED OR ACTIVE */}
            {mesh && (isActive || isHovered) && (
              <BlueprintHighlight 
                mesh={mesh} 
                color={'#00b4d8'} 
                isActive={true} 
              />
            )}

            {/* Floating annotation */}
            {position && (
              <Annotation
                part={part}
                position={position}
                isActive={isActive}
                onClick={onPartClick}
                onHover={(p, hovered) => setHoveredPart(hovered ? p : null)}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Fallback annotations: if no mesh match, distribute around model */}
      {parts && parts.filter(p => !findMesh(p.mesh_id)).length === parts.length && parts.length > 0 && (
        parts.map((part, i) => {
          const angle = (i / parts.length) * Math.PI * 2;
          const radius = 1.5;
          const fallbackPos = {
            x: Math.cos(angle) * radius,
            y: 0.5 + (i * 0.3),
            z: Math.sin(angle) * radius
          };
          const isActive = activePart?.mesh_id === part.mesh_id;

          return (
            <Annotation
              key={`fallback-${i}`}
              part={part}
              position={fallbackPos}
              isActive={isActive}
              onClick={onPartClick}
            />
          );
        })
      )}
    </group>
  );
}

export default function ModelViewer({ modelUrl, parts, activePart, onPartClick, onMeshNamesFound }) {
  if (!modelUrl) return null;

  return (
    <Suspense fallback={null}>
      <ModelContent
        url={modelUrl}
        parts={parts}
        activePart={activePart}
        onPartClick={onPartClick}
        onMeshNamesFound={onMeshNamesFound}
      />
    </Suspense>
  );
}
