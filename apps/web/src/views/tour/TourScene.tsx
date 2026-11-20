import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { DirectionalLight, HemisphereLight } from 'three';
import type { Property } from '@ave/shared';
import { content } from '@/content';
import { RoomLight } from '@/three/RoomLight';
import { daylightFor, LIGHT } from '@/three/lighting';
import { useReadyModels } from '@/three/modelStore';
import type { PreparedModel } from '@/three/prepareModel';
import { TOUR_MODEL_NAME } from './config';

interface TourSceneProps {
  property: Property;
  model: PreparedModel | null;
  /** Local clock time at the property (Compass view), minutes after midnight. */
  minutes: number;
}

/** The lit model. Light follows the Compass view's time of day: sun direction, warmth and exposure. */
export function TourScene({ property, model, minutes }: TourSceneProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  const light = useMemo(() => daylightFor(property, minutes), [property, minutes]);
  const object = useMemo(() => (model ? model.scene.clone(true) : null), [model]);
  const { scale, position, rotationY } = property.model;

  useEffect(() => {
    gl.toneMappingExposure = light.exposure;
    if (sun.current) {
      sun.current.position.set(...light.sunDir).multiplyScalar(LIGHT.sunDistance);
      sun.current.color.copy(light.sunColor);
      sun.current.intensity = light.sunIntensity;
    }
    if (sky.current) sky.current.intensity = light.hemisphereIntensity;
    invalidate();
  }, [gl, light, invalidate]);

  return (
    <>
      <RoomLight intensity={light.environmentIntensity} />
      <hemisphereLight ref={sky} args={[LIGHT.hemisphere.sky, LIGHT.hemisphere.ground, light.hemisphereIntensity]} />
      <directionalLight ref={sun} />
      {object && (
        <group name={TOUR_MODEL_NAME} scale={scale} position={position} rotation={[0, rotationY, 0]}>
          <primitive object={object} />
        </group>
      )}
      <WarmUp />
    </>
  );
}

const warmed = new WeakSet<PreparedModel>();

/**
 * Compiles shaders and uploads textures for every loaded property model in idle time, so switching
 * property does not stall on the first frame.
 */
function WarmUp() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const urls = useMemo(() => content.properties.map((b) => b.property.model.url), []);
  const models = useReadyModels(urls);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const pending = models.filter((m) => !warmed.has(m));
    if (!pending.length) return;
    const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : window.setTimeout(fn, 1));
    void (async () => {
      for (const model of pending) {
        if (!mounted.current) return;
        warmed.add(model);
        try {
          await gl.compileAsync(model.scene, camera, scene);
        } catch {
          // Compilation happens again on first draw; warming is only an optimisation.
        }
        for (const texture of model.textures) {
          if (!mounted.current) return;
          await new Promise<void>((resolve) =>
            idle(() => {
              gl.initTexture(texture);
              resolve();
            }),
          );
        }
      }
    })();
  }, [gl, scene, camera, models]);

  return null;
}
