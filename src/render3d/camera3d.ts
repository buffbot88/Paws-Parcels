/**
 * The fixed 3/4 camera for the 3D world renderer.
 *
 * World units are tiles (one tile is one unit) so every value the rest of the
 * game already authored — placements, footprints, framing — is used unchanged.
 * The framing bias and look-ahead come from `cameraFraming.ts`, so a courier
 * sits the same distance below centre in both renderers.
 */
import * as THREE from "three";
import {
  CAMERA_FRAMING,
  easeToward,
  lookAheadTargetPx,
  type CameraFraming,
  type OffsetPx,
} from "../game/cameraFraming.ts";

/** A 3/4 camera, in degrees and tiles. */
export interface Camera3DConfig {
  /** Vertical field of view. Low, so the tiled ground does not bow. */
  readonly fovDeg: number;
  /** How far the camera looks down from the horizon. */
  readonly pitchDeg: number;
  /** Rotation about the world's up axis; 0 looks north and keeps the map north-up. */
  readonly yawDeg: number;
  /** Ground the viewport covers vertically, matched to the 2D camera. */
  readonly groundSpanTiles: number;
  readonly nearTiles: number;
  readonly farTiles: number;
}

/**
 * The shipped 3/4 camera.
 *
 * The yaw stays 0 on purpose: the cutout art is authored with its fronts facing
 * south, so a rotated camera would show sides the art does not have.
 */
export const CAMERA_3D: Camera3DConfig = {
  fovDeg: 30,
  pitchDeg: 55,
  yawDeg: 0,
  groundSpanTiles: 10.2,
  nearTiles: 1,
  farTiles: 600,
};

/** A point on the ground plane. */
export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Camera distance that makes `spanTiles` of ground fill the viewport height. */
export function cameraDistance(cfg: Camera3DConfig): number {
  const pitch = toRadians(cfg.pitchDeg);
  const fov = toRadians(cfg.fovDeg);
  return (cfg.groundSpanTiles * Math.sin(pitch)) / (2 * Math.tan(fov / 2));
}

/** Camera position relative to the focus point, in world units. */
export function cameraOffset(cfg: Camera3DConfig): { x: number; y: number; z: number } {
  const distance = cameraDistance(cfg);
  const pitch = toRadians(cfg.pitchDeg);
  const yaw = toRadians(cfg.yawDeg);
  return {
    x: distance * Math.cos(pitch) * Math.sin(yaw),
    y: distance * Math.sin(pitch),
    z: distance * Math.cos(pitch) * Math.cos(yaw),
  };
}

/**
 * Ground direction away from the camera, which is screen-up.
 *
 * The camera sits at +Z of its focus (south) and looks north, so away from the
 * camera is -Z: moving the focus along this axis puts the subject *below* centre.
 */
export function awayGroundAxis(cfg: Camera3DConfig): GroundPoint {
  const yaw = toRadians(cfg.yawDeg);
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Ground direction pointing to the camera's right: screen-right, in world terms. */
export function screenRightGroundAxis(cfg: Camera3DConfig): GroundPoint {
  const yaw = toRadians(cfg.yawDeg);
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** Ground distance the focus moves so the subject renders below centre. */
export function biasGroundTiles(cfg: Camera3DConfig, framing: CameraFraming): number {
  return framing.verticalBias * cfg.groundSpanTiles;
}

/**
 * The ground focus and eased look-ahead for this frame.
 *
 * `dtSeconds` comes from the game loop so the lead settles at the same rate on
 * any frame rate, exactly as it does in the 2D renderer.
 */
export function framedGroundFocus(
  cfg: Camera3DConfig,
  framing: CameraFraming,
  subject: GroundPoint,
  direction: OffsetPx,
  lookAhead: OffsetPx,
  dtSeconds: number,
): { focus: GroundPoint; lookAhead: OffsetPx } {
  const target = lookAheadTargetPx(framing, direction, 1);
  const eased: OffsetPx = {
    x: easeToward(lookAhead.x, target.x, framing.lookAheadEasePerSecond, dtSeconds),
    y: easeToward(lookAhead.y, target.y, framing.lookAheadEasePerSecond, dtSeconds),
  };
  const away = awayGroundAxis(cfg);
  const right = screenRightGroundAxis(cfg);
  const bias = biasGroundTiles(cfg, framing);
  return {
    focus: {
      x: subject.x + away.x * (bias - eased.y) + right.x * eased.x,
      z: subject.z + away.z * (bias - eased.y) + right.z * eased.x,
    },
    lookAhead: { x: eased.x === 0 ? 0 : eased.x, y: eased.y === 0 ? 0 : eased.y },
  };
}

/** Point the camera at a ground focus, keeping its configuration in force. */
export function placeCamera(
  camera: THREE.PerspectiveCamera,
  cfg: Camera3DConfig,
  focus: GroundPoint,
): void {
  const offset = cameraOffset(cfg);
  camera.fov = cfg.fovDeg;
  camera.near = cfg.nearTiles;
  camera.far = cfg.farTiles;
  camera.position.set(focus.x + offset.x, offset.y, focus.z + offset.z);
  camera.lookAt(focus.x, 0, focus.z);
  camera.updateProjectionMatrix();
}

/** Centre of a tile, in world units. */
export function tileCentreWorld(tileX: number, tileY: number): GroundPoint {
  return { x: tileX + 0.5, z: tileY + 0.5 };
}

/** Convert a screen/world pixel measurement from the 2D renderer into tiles. */
export function pxToTiles(px: number, tilePx: number): number {
  return px / tilePx;
}

/** How far below the viewport centre a world point renders, as a fraction of height. */
export function screenFractionBelowCentre(
  camera: THREE.PerspectiveCamera,
  point: { x: number; y: number; z: number },
): number {
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return (1 - projected.y) / 2 - 0.5;
}

export { CAMERA_FRAMING };
