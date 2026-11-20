import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, MathUtils, Vector3 } from 'three';

/** Radians of turn per pixel of drag. */
const LOOK_SPEED = 0.0035;
const MAX_PITCH = MathUtils.degToRad(88);
const FAST_MULTIPLIER = 3;

interface FlyControlsProps {
  /** Metres per second. */
  speed: number;
  enabled?: boolean;
}

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

/**
 * Free-fly camera for authoring: drag to look, W A S D to move, E and Q to rise and sink,
 * Shift to move faster. Keys are ignored while a form field has focus.
 */
export function FlyControls({ speed, enabled = true }: FlyControlsProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef(new Set<string>());
  const euler = useRef(new Euler(0, 0, 0, 'YXZ'));

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      euler.current.setFromQuaternion(camera.quaternion, 'YXZ');
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const e2 = euler.current;
      e2.y -= (e.clientX - lastX) * LOOK_SPEED;
      e2.x = MathUtils.clamp(e2.x - (e.clientY - lastY) * LOOK_SPEED, -MAX_PITCH, MAX_PITCH);
      e2.z = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      camera.quaternion.setFromEuler(e2);
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      keys.current.add(e.code);
    };
    const keyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      keys.current.clear();
    };
  }, [camera, gl, enabled]);

  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const up = useRef(new Vector3(0, 1, 0));
  useFrame((_, delta) => {
    const k = keys.current;
    if (!enabled || k.size === 0) return;
    const step = speed * delta * (k.has('ShiftLeft') || k.has('ShiftRight') ? FAST_MULTIPLIER : 1);
    camera.getWorldDirection(forward.current);
    right.current.crossVectors(forward.current, up.current).normalize();
    if (k.has('KeyW')) camera.position.addScaledVector(forward.current, step);
    if (k.has('KeyS')) camera.position.addScaledVector(forward.current, -step);
    if (k.has('KeyD')) camera.position.addScaledVector(right.current, step);
    if (k.has('KeyA')) camera.position.addScaledVector(right.current, -step);
    if (k.has('KeyE')) camera.position.y += step;
    if (k.has('KeyQ')) camera.position.y -= step;
  });

  return null;
}
