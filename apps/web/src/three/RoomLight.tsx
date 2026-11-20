import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Blur of the procedural room environment; a soft, even interior light. */
const ENVIRONMENT_SIGMA = 0.04;

/**
 * Image-based lighting from three's procedural RoomEnvironment: a bright, neutral interior with
 * soft reflections. Generated on the GPU at mount; nothing is downloaded.
 */
export function RoomLight({ intensity = 1 }: { intensity?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, ENVIRONMENT_SIGMA).texture;
    room.dispose();
    scene.environment = env;
    invalidate();
    return () => {
      if (scene.environment === env) scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);

  useEffect(() => {
    scene.environmentIntensity = intensity;
    invalidate();
  }, [scene, intensity, invalidate]);

  return null;
}
