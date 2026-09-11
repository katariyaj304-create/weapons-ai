/**
 * Annotation — Ivory Command glass-panel HUD label.
 * Frosted glass overlay with colored left-accent bar pinned to 3D mesh positions.
 */
import React, { useState } from 'react';
import { Html, Line } from '@react-three/drei';

export default function Annotation({ part, position, isActive, onClick, onHover }) {
  const [isHovered, setIsHovered] = useState(false);
  
  if (!position) return null;

  // Professional army app style: solid lines, simple text
  let accentColor = '#151c27'; // Dark charcoal/black for labels and lines
  let highlightColor = '#00b4d8'; // Blue for active/hovered shape

  const displayName = (part.part_name || part.mesh_id || 'UNKNOWN_PART')
    .replace(/[_-\s]+/g, ' ')
    .trim()
    .toUpperCase();

  // The label sits above the mesh
  const labelOffset = [0, 0.8, 0];

  return (
    <group position={[position.x, position.y, position.z]}>
      {/* Engineering connecting line */}
      <Line
        points={[[0, 0, 0], labelOffset]}
        color={accentColor}
        lineWidth={2}
        transparent
        opacity={0.8}
        dashed={false}
      />

      {/* Point indicator */}
      <mesh>
        <sphereGeometry args={[0.015, 16, 16]} />
        <meshBasicMaterial
          color={accentColor}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Blueprint HTML Label */}
      <Html
        center
        distanceFactor={8}
        position={labelOffset}
        style={{
          transition: 'all 0.2s ease',
          pointerEvents: 'auto',
          zIndex: isHovered || isActive ? 10 : 1,
        }}
        occlude="blending"
      >
        <div
          className={`blueprint-label ${isActive ? 'active' : ''} ${isHovered ? 'hovered' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(part);
          }}
          onPointerEnter={(e) => {
            e.stopPropagation();
            setIsHovered(true);
            onHover?.(part, true);
          }}
          onPointerLeave={(e) => {
            e.stopPropagation();
            setIsHovered(false);
            onHover?.(part, false);
          }}
          style={{
            color: accentColor,
            cursor: 'crosshair',
            padding: '2px 8px',
            fontFamily: 'var(--font-display)',
            fontSize: '12px',
            fontWeight: '600',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            textShadow: '0 0 4px rgba(255,255,255,0.8)',
            transform: isHovered || isActive ? 'scale(1.1)' : 'scale(1)',
          }}
        >
          {displayName}
        </div>
      </Html>
    </group>
  );
}
