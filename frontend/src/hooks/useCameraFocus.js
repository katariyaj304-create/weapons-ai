/**
 * Custom hook for smooth camera focus animation to a target position.
 */
import { useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function useCameraFocus() {
  const targetPosition = useRef(null);
  const targetLookAt = useRef(null);
  const isAnimating = useRef(false);
  const progress = useRef(0);

  const focusOn = useCallback((position, offset = { x: 2, y: 1.5, z: 2 }) => {
    if (!position) return;

    const pos = position instanceof THREE.Vector3
      ? position
      : new THREE.Vector3(position.x, position.y, position.z);

    targetLookAt.current = pos.clone();
    targetPosition.current = new THREE.Vector3(
      pos.x + offset.x,
      pos.y + offset.y,
      pos.z + offset.z
    );
    isAnimating.current = true;
    progress.current = 0;
  }, []);

  const resetCamera = useCallback(() => {
    targetPosition.current = new THREE.Vector3(5, 3, 5);
    targetLookAt.current = new THREE.Vector3(0, 0, 0);
    isAnimating.current = true;
    progress.current = 0;
  }, []);

  // This hook must be called inside a R3F Canvas context
  const CameraAnimator = () => {
    useFrame((state, delta) => {
      if (!isAnimating.current || !targetPosition.current) return;

      progress.current += delta * 1.8; // Animation speed
      const t = Math.min(progress.current, 1);
      // Smooth easing (ease-out cubic)
      const ease = 1 - Math.pow(1 - t, 3);

      const camera = state.camera;

      // Lerp camera position
      camera.position.lerp(targetPosition.current, ease * 0.08);

      // Lerp lookAt target if orbit controls exist
      if (state.controls && state.controls.target) {
        state.controls.target.lerp(targetLookAt.current, ease * 0.08);
        state.controls.update();
      }

      // Check if close enough to stop
      if (camera.position.distanceTo(targetPosition.current) < 0.05) {
        isAnimating.current = false;
      }
    });

    return null;
  };

  return { focusOn, resetCamera, CameraAnimator, isAnimating };
}
