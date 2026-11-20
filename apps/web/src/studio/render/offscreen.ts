import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CameraShot, PlanFile, Property } from '@ave/shared';
import { daylightFor, LIGHT, SKY_COLOUR } from '@/three/lighting';
import type { PreparedModel } from '@/three/prepareModel';
import { sectionSegments, segmentsToRibbon } from '@/three/section';

export type Bounds = PlanFile['bounds'];

/** Plan renders: flat, even light from above so the image restyles cleanly as a blueprint. */
const PLAN = {
  background: '#ffffff',
  ambient: 0.9,
  environmentIntensity: 0.9,
  wallColour: '#0e1726',
  /** Width of cut walls drawn on the plan, metres. */
  wallWidth: 0.06,
  cameraHeight: 60,
} as const;

const ENVIRONMENT_SIGMA = 0.04;
const HERO_TIME_MINUTES = 10 * 60;

interface RenderTarget {
  renderer: WebGLRenderer;
  scene: Scene;
  dispose: () => void;
}

function createTarget(width: number, height: number, background: string): RenderTarget {
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  const scene = new Scene();
  scene.background = new Color(background);
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, ENVIRONMENT_SIGMA).texture;
  room.dispose();
  scene.environment = env;
  return {
    renderer,
    scene,
    dispose: () => {
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

function toBlob(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png', quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality));
}

export interface PlanRenderOptions {
  model: PreparedModel;
  bounds: Bounds;
  /** Height of the section cut, metres above the model origin. */
  cutY: number;
  pxPerMetre: number;
  type?: 'image/webp' | 'image/png';
  quality?: number;
}

/**
 * Top-down orthographic render framed exactly to `bounds` (x right, z down), with everything above
 * `cutY` cut away and the cut walls drawn as ink lines.
 */
export async function renderPlan({ model, bounds, cutY, pxPerMetre, type = 'image/webp', quality = 0.92 }: PlanRenderOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  const width = Math.round(w * pxPerMetre);
  const height = Math.round(h * pxPerMetre);
  const t = createTarget(width, height, PLAN.background);
  try {
    const { renderer, scene } = t;
    scene.environmentIntensity = PLAN.environmentIntensity;
    scene.add(new AmbientLight('#ffffff', PLAN.ambient));
    scene.add(model.scene.clone(true));

    if (model.structure) {
      const ribbon = new Mesh(segmentsToRibbon(sectionSegments(model.structure, cutY), PLAN.wallWidth, cutY - 0.01), new MeshBasicMaterial({ color: PLAN.wallColour, depthTest: false }));
      ribbon.renderOrder = 10;
      scene.add(ribbon);
    }

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, PLAN.cameraHeight * 2);
    camera.up.set(0, 0, -1);
    camera.position.set(cx, PLAN.cameraHeight, cz);
    camera.lookAt(cx, 0, cz);
    camera.updateProjectionMatrix();

    renderer.clippingPlanes = [new Plane(new Vector3(0, -1, 0), cutY)];
    renderer.render(scene, camera);
    const blob = await toBlob(renderer.domElement, type, quality);
    return { blob, width, height };
  } finally {
    t.dispose();
  }
}

export interface HeroRenderOptions {
  model: PreparedModel;
  property: Pick<Property, 'location' | 'northOffsetDeg'>;
  shot: CameraShot;
  width: number;
  height: number;
  quality?: number;
}

/** A perspective still from a tour shot, lit like the tour at mid-morning. */
export async function renderHero({ model, property, shot, width, height, quality = 0.9 }: HeroRenderOptions): Promise<Blob> {
  const t = createTarget(width, height, SKY_COLOUR);
  try {
    const { renderer, scene } = t;
    const light = daylightFor(property, HERO_TIME_MINUTES);
    renderer.toneMappingExposure = light.exposure;
    scene.environmentIntensity = light.environmentIntensity;
    scene.add(new HemisphereLight(LIGHT.hemisphere.sky, LIGHT.hemisphere.ground, light.hemisphereIntensity));
    const sun = new DirectionalLight(light.sunColor, light.sunIntensity);
    sun.position.set(...light.sunDir).multiplyScalar(LIGHT.sunDistance);
    scene.add(sun);
    scene.add(model.scene.clone(true));
    const camera = new PerspectiveCamera(shot.fov, width / height, 0.05, 500);
    camera.position.set(...shot.position);
    camera.lookAt(...shot.target);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return await toBlob(renderer.domElement, 'image/webp', quality);
  } finally {
    t.dispose();
  }
}
