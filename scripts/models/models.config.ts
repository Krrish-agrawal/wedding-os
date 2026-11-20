/**
 * Per-model settings for scripts/models/optimize.ts. Findings behind each value are in
 * assets/models/notes/<model>.md.
 */

export interface SimplifyRule {
  /** Top-level source node names (children of the FBX RootNode) this rule applies to. */
  nodes: string[];
  /** Target fraction of vertices to keep (0..1). */
  ratio: number;
  /** Maximum error as a fraction of each primitive's radius. */
  error: number;
}

export interface TextureRule {
  /** Matched against the texture URI, e.g. "textures/Wood049_baseColor.jpeg". */
  pattern: RegExp;
  /** Longest side in pixels. */
  maxSize: number;
}

export interface ModelConfig {
  id: string;
  /** glTF from the owner, relative to the repository root. */
  source: string;
  /** Optimised GLB, relative to the repository root. */
  output: string;
  /**
   * Uniform scale applied on top of the source scene so 1 unit = 1 metre. The apartment's Sketchfab
   * export carries a 0.853 viewer scale; furniture heights (dining table 0.76 m, desk 0.76 m, WC seat
   * 0.39 m) only come out right without it.
   */
  scale: number;
  /** Materials whose top surfaces are the floor of the main level; defines the origin. */
  floorMaterials: string[];
  /** Which floor surface sets y = 0: the highest of the floor materials or the lowest. */
  floorLevel: 'highest' | 'lowest';
  /**
   * Optional fixed floor height (metres, after scaling, before centring) used instead of the floor
   * materials' top surface, for models whose floor slab is a thick box.
   */
  floorY?: number;
  /** Top-level nodes that are the building itself (walls, floors, ceilings, doors, windows, built-ins). */
  structure: string[];
  /**
   * Interior footprint in source world units (x and z, after the source's own transforms).
   * Top-level nodes that reach outside it are the exterior environment.
   */
  interior?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Top-level nodes dropped entirely. */
  drop: string[];
  /**
   * Primitives to repaint as an even, self-lit colour, by top-level node and material. Used for the
   * apartment's black outer shell, which otherwise shows as a black void behind every window.
   */
  selfLit?: { node: string; material: string; color: [number, number, number] }[];
  /**
   * Interior doors swung open so tour moves pass through the doorway rather than through a closed
   * leaf. Coordinates are the normalised model space (metres, origin at the floor centre).
   */
  openDoors?: {
    node: string;
    /** Material of the door leaf; its primitives rotate whole. */
    leafMaterial: string;
    /** Material of the handle, which shares a mesh with the frame: triangles inside `handleBox` rotate. */
    handleMaterial: string;
    handleBox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
    /** Hinge line position (x, z). */
    hinge: [number, number];
    /** Rotation about the hinge, degrees; negative swings towards −X when the leaf runs along +Z. */
    angleDeg: number;
  }[];
  /** Simplification, first matching rule wins. Nodes without a rule use `defaultSimplify`. */
  simplify: SimplifyRule[];
  defaultSimplify: { ratio: number; error: number };
  /** Texture size limits, first matching rule wins; others use `defaultTextureSize`. */
  textures: TextureRule[];
  defaultTextureSize: number;
}

/** Hero surfaces keep 2k colour maps; their normal and roughness maps and everything else drop to 1k. */
const HERO_COLOUR = 2048;
const STANDARD = 1024;
/** Small props seen from a metre or more away. */
const PROP = 512;

export const MODELS: ModelConfig[] = [
  {
    id: 'apt-indiranagar',
    source: 'assets/models/raw/modern-apartment/scene.gltf',
    output: 'apps/web/public/models/apt-indiranagar.glb',
    scale: 1 / 0.8529895544052124,
    floorMaterials: ['Marble_015'],
    floorLevel: 'highest',
    structure: ['Plane.002', 'Plane.004', 'Plane.007', 'Windows', 'Door.001', 'EnteranceDoor', 'Baseboard', 'BedroomWardrobes'],
    drop: [],
    // Soft daylight grey, linear RGB.
    selfLit: [{ node: 'Plane.002', material: 'Black.001', color: [0.78, 0.83, 0.88] }],
    // The en-suite door, closed in the source, opened into the bathroom.
    openDoors: [
      {
        node: 'Door.001',
        leafMaterial: 'White1',
        handleMaterial: 'Black',
        handleBox: { minX: 6.02, maxX: 6.34, minY: 0.6, maxY: 1.5, minZ: -0.75, maxZ: -0.3 },
        hinge: [6.18, -1.2],
        angleDeg: -92,
      },
    ],
    simplify: [
      // One interior door modelled at 1.1M triangles; flat panels with a fine bevel.
      { nodes: ['Door.001'], ratio: 0.01, error: 0.004 },
      // Dense decor: plants, kitchen props, shoes, bathroom accessories.
      { nodes: ['Plants', 'KDecor', 'Shoes', 'BathroomFurnitures', 'OficeDecors', 'BedDecors', 'MacBook', 'Flower'], ratio: 0.15, error: 0.006 },
      // Hero furniture and soft furnishings: keep silhouettes.
      { nodes: ['CouchSet', 'Bed', 'BookCase', 'DiningTable.001', 'Office+Desk', 'Toilet', 'Sink', 'Refrigator.001', 'iMac', 'Hood', 'Curtatins'], ratio: 0.3, error: 0.003 },
      // Architecture: weld only.
      { nodes: ['Plane.002', 'Plane.004', 'Plane.007', 'Windows', 'EnteranceDoor', 'Baseboard', 'BedroomWardrobes'], ratio: 1, error: 0 },
    ],
    defaultSimplify: { ratio: 0.3, error: 0.003 },
    textures: [
      { pattern: /(Wood_Floor_039|Marble_015|Marble_014|Wood049|Wood0035|SprayedWallTexture|PavingStones128)_baseColor/, maxSize: HERO_COLOUR },
      // Floor normal and roughness maps stay at 1k; other surface detail maps tile and hold up at 512.
      { pattern: /(Wood_Floor_039|Marble_015)_(normal|metallicRoughness)/, maxSize: STANDARD },
      { pattern: /_(normal|metallicRoughness)\./, maxSize: PROP },
      {
        pattern: /(Dip_Large_Mugs|Silo_Canisters|Poke_Cookbook|Label_Ficks|Measuring_Cups|Vase_Black_Kitchen|Faux_Succulent|Faux_Monstera|NightRiverBlack|Book_Spine|Color_6|leaf2_|folha_planta|Splitleaf|M_10_Leaf|M_1_Mat3d66|Coffee_Maker|touchbar|Screen_Shot|Secadora|Snkrs01|Right2|Front(Black|Down|Top|Panel)|DSI_46750)/,
        maxSize: PROP,
      },
    ],
    defaultTextureSize: STANDARD,
  },
  {
    id: 'office-koramangala',
    source: 'assets/models/raw/loft18-office/scene.gltf',
    output: 'apps/web/public/models/office-koramangala.glb',
    scale: 1,
    floorMaterials: ['material_2'],
    floorLevel: 'highest',
    // The ground slab is a box whose top surface sits exactly at 0.
    floorY: 0,
    structure: [
      'Plane', 'Cube', 'Cube.001', 'Plane.001', 'Plane.002', 'Plane.003', 'Plane.004', 'Plane.005', 'Plane.006', 'Plane.007', 'Plane.008',
      'Plane.009', 'Plane.010', 'Plane.011', 'Plane.012', 'Plane.013', 'Plane.014', 'Plane.015', 'Plane.016', 'Plane.017', 'Plane.018',
      'Plane.020', 'Plane.021', 'Plane.022', 'Plane.023', 'Plane.024', 'Plane.027', 'Plane.028', 'Plane.031', 'Plane.039', 'Plane.040', 'Plane.045',
      'Cube.002', 'Cube.003', 'Cube.010', 'Cube.013', 'Cube.014', 'Cube.015', 'Cube.023', 'Cube.028', 'Cube.029',
    ],
    interior: { minX: -7.4, maxX: 8.2, minZ: -2.9, maxZ: 7.3 },
    drop: [],
    simplify: [],
    defaultSimplify: { ratio: 1, error: 0.0001 },
    textures: [
      { pattern: /^textures\/material_baseColor/, maxSize: STANDARD },
      { pattern: /material_13_baseColor/, maxSize: STANDARD },
    ],
    defaultTextureSize: STANDARD,
  },
];
