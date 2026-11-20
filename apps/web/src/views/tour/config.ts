/** Tuning for the 3D tour. Camera paths share their pace with the studio (see three/cameraPath.ts). */
export const TOUR = {
  camera: { near: 0.05, far: 600 },
  /** Highest device pixel ratio the canvas renders at; keeps retina laptops at 60 fps. */
  maxDpr: 1.75,
  look: {
    /** How far the buyer may turn left or right, and up or down, from the authored view. */
    azimuthLimitDeg: 60,
    polarLimitDeg: 22,
    /** Drag sensitivity; negative so dragging feels like turning your head, not orbiting. */
    rotateSpeed: -0.32,
    smoothTime: 0.22,
    draggingSmoothTime: 0.08,
    /** Distance of the look-around pivot in front of the eye, metres. */
    pivotDistance: 0.02,
  },
  walkthrough: {
    /** Time spent at each stop before drifting on. Restarts after the buyer lets go of a drag. */
    dwellMs: 5200,
  },
  /** Fade of the stop label and facts once the camera arrives. */
  overlayFadeS: 0.22,
} as const;

/** Name of the property model's group in the tour scene; the guide raycasts against it. */
export const TOUR_MODEL_NAME = 'tour-model';

/** The AI advisor walking through the home in the 3D tour (TourGuide). Distances in metres. */
export const GUIDE = {
  /** Camera height above the floor assumed when no floor is found under it. */
  eyeHeight: 1.6,
  /**
   * Where to stand, tried in order: distances ahead of the camera and sideways offsets (+ is the
   * buyer's right, so the guide does not block the view), with the free space needed around him.
   * `roomy` first; `tight` for small rooms where nothing roomy fits.
   */
  roomy: { distances: [2.2, 1.9, 2.6, 1.6, 3.0], lateral: [0.7, -0.7, 1.0, -1.0, 0.35, -0.35, 0], bodyRadius: 0.32, heights: [0.45, 1.25] },
  tight: { distances: [1.5, 1.3, 1.8, 2.2], lateral: [0.5, -0.5, 0.8, -0.8, 0.25, -0.25, 0], bodyRadius: 0.2, heights: [1.25] },
  /** Rays cast down around the camera to find the floor (furniture under the camera is ignored). */
  floorProbes: 8,
  floorProbeRadius: 0.9,
  /** A spot counts as the camera's floor if its height is within this. */
  floorTolerance: 0.12,
  /** Space kept above the head when checking the whole guide is in frame. */
  headroom: 0.15,
  /** The guide's feet and head must sit inside this share of the frame (normalised, 1 = edge). */
  frameMargin: 0.92,
  /** Stops more than this above the lowest floor's eye height are upper floors, where the guide steps out. */
  upperFloorMargin: 1.2,
  /** Line of sight from the camera is checked to the guide's hips, chest and head (heights above the floor). */
  sightHeights: [0.9, 1.25, 1.6],
  clearanceRays: 8,
  /** Share of the camera's travel time the guide takes for the same route (under 1: he gets there first). */
  paceShare: 0.75,
  /** Distance per step; the walk cycle advances with distance so the feet match the ground. */
  strideLength: 0.62,
  /** Turning speed, radians per second. */
  turnRate: 4.5,
  /** Frame rate while the guide is on screen (the tour otherwise renders only when something moves). */
  fps: 30,
  /** Longest frame step used for movement, so a stalled tab does not teleport the guide. */
  maxFrameS: 0.1,
  /** Eye contact on arriving at a spot. */
  arrivalLookMs: 1800,
} as const;
