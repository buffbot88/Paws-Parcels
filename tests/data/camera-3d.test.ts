/**
 * The 3D camera's geometry and its parity with the sprite renderer's framing.
 *
 * Everything here is pure arithmetic or three's own matrix math, so it runs in
 * Node: the camera is the one part of the frame no DOM test can see, and the
 * whole point of `cameraFraming.ts` being Phaser-free is that this can be
 * checked without a browser.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  CAMERA_3D,
  awayGroundAxis,
  biasGroundTiles,
  cameraDistance,
  cameraOffset,
  framedGroundFocus,
  placeCamera,
  screenFractionBelowCentre,
  screenRightGroundAxis,
  tileCentreWorld,
  type Camera3DConfig,
} from "../../src/render3d/camera3d.ts";
import { CAMERA_FRAMING } from "../../src/game/cameraFraming.ts";

/** A flat pitch/yaw-free view of the ground, for the framing assertions. */
const IDLE = { x: 0, y: 0 };

describe("3D camera geometry", () => {
  it("sits above the ground, south of its focus, looking north", () => {
    const offset = cameraOffset(CAMERA_3D);
    // Above the ground plane: nothing is drawn from below it.
    expect(offset.y).toBeGreaterThan(0);
    // South (+Z) of the focus, so screen-up is north — the map stays north-up.
    expect(offset.z).toBeGreaterThan(0);
    expect(Math.abs(offset.x)).toBeLessThan(0.0001);
  });

  it("places the camera so the authored ground span fills the viewport", () => {
    const distance = cameraDistance(CAMERA_3D);
    expect(distance).toBeGreaterThan(1);
    // The span is a linear setting: twice the ground means twice the pull-back.
    const wider: Camera3DConfig = { ...CAMERA_3D, groundSpanTiles: CAMERA_3D.groundSpanTiles * 2 };
    expect(cameraDistance(wider)).toBeCloseTo(distance * 2, 6);
  });

  it("defines screen-up as away from the camera and right as +X at yaw 0", () => {
    // Compared numerically, not structurally: an axis component legitimately
    // lands on -0 at yaw 0 and that is the same direction as 0.
    const away = awayGroundAxis(CAMERA_3D);
    expect(away.x).toBeCloseTo(0, 6);
    expect(away.z).toBeCloseTo(-1, 6);
    const right = screenRightGroundAxis(CAMERA_3D);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.z).toBeCloseTo(0, 6);
  });

  it("maps a tile to its centre, so art stands on the tile it belongs to", () => {
    expect(tileCentreWorld(10, 4)).toEqual({ x: 10.5, z: 4.5 });
  });

  it("turns the 2D bias fraction into the same fraction of ground", () => {
    expect(biasGroundTiles(CAMERA_3D, CAMERA_FRAMING)).toBeCloseTo(
      CAMERA_FRAMING.verticalBias * CAMERA_3D.groundSpanTiles,
      6,
    );
  });
});

describe("3D camera framing (parity with the sprite renderer)", () => {
  it("focuses ahead of the subject, putting the courier below centre", () => {
    const subject = { x: 20, z: 30 };
    const framed = framedGroundFocus(CAMERA_3D, CAMERA_FRAMING, subject, IDLE, IDLE, 0);
    // Screen-up is -Z, so the focus sits north of the subject.
    expect(framed.focus.z).toBeLessThan(subject.z);
    expect(framed.focus.x).toBeCloseTo(subject.x, 6);
    expect(subject.z - framed.focus.z).toBeCloseTo(biasGroundTiles(CAMERA_3D, CAMERA_FRAMING), 6);

    // And the projection agrees: the subject renders below the centre line by
    // the authored fraction of the viewport.
    const camera = new THREE.PerspectiveCamera(CAMERA_3D.fovDeg, 16 / 9, 1, 600);
    placeCamera(camera, CAMERA_3D, framed.focus);
    const below = screenFractionBelowCentre(camera, { x: subject.x, y: 0, z: subject.z });
    expect(below).toBeGreaterThan(0.03);
    expect(below).toBeCloseTo(CAMERA_FRAMING.verticalBias, 1);
  });

  it("leads north while walking north, and does not shift sideways", () => {
    const subject = { x: 20, z: 30 };
    const walking = framedGroundFocus(
      CAMERA_3D,
      CAMERA_FRAMING,
      subject,
      { x: 0, y: -1 },
      IDLE,
      0.5,
    );
    const idle = framedGroundFocus(CAMERA_3D, CAMERA_FRAMING, subject, IDLE, IDLE, 0.5);
    expect(walking.focus.z).toBeLessThan(idle.focus.z);
    expect(walking.focus.x).toBeCloseTo(idle.focus.x, 6);
    // Clamped to the authored lead, never further.
    expect(idle.focus.z - walking.focus.z).toBeLessThanOrEqual(CAMERA_FRAMING.lookAheadTiles);
  });

  it("leads east while walking east, leaving the vertical bias alone", () => {
    const subject = { x: 20, z: 30 };
    const walking = framedGroundFocus(
      CAMERA_3D,
      CAMERA_FRAMING,
      subject,
      { x: 1, y: 0 },
      IDLE,
      0.5,
    );
    const idle = framedGroundFocus(CAMERA_3D, CAMERA_FRAMING, subject, IDLE, IDLE, 0.5);
    expect(walking.focus.x).toBeGreaterThan(idle.focus.x);
    expect(walking.focus.z).toBeCloseTo(idle.focus.z, 6);
  });

  it("settles back to the idle framing when the courier stops", () => {
    const subject = { x: 20, z: 30 };
    let lookAhead = { x: 0, y: 0 };
    for (let frame = 0; frame < 60; frame += 1) {
      lookAhead = framedGroundFocus(
        CAMERA_3D,
        CAMERA_FRAMING,
        subject,
        { x: 0, y: -1 },
        lookAhead,
        1 / 60,
      ).lookAhead;
    }
    const held = framedGroundFocus(CAMERA_3D, CAMERA_FRAMING, subject, IDLE, lookAhead, 1 / 60);
    expect(Math.abs(held.lookAhead.y)).toBeGreaterThan(0.01);
    // One second of standing still is enough to give the lead back.
    let settling = held;
    for (let frame = 0; frame < 60; frame += 1) {
      settling = framedGroundFocus(
        CAMERA_3D,
        CAMERA_FRAMING,
        subject,
        IDLE,
        settling.lookAhead,
        1 / 60,
      );
    }
    expect(Math.abs(settling.lookAhead.y)).toBeLessThan(0.01);
  });

  it("holds a fixed yaw, so the cutout art is never seen from the side", () => {
    expect(CAMERA_3D.yawDeg).toBe(0);
    // A 3/4 read, not a top-down plan and not a horizon shot.
    expect(CAMERA_3D.pitchDeg).toBeGreaterThan(45);
    expect(CAMERA_3D.pitchDeg).toBeLessThan(70);
  });
});
