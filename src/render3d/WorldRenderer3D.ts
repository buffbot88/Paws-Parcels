/**
 * The world, rendered in 3D.
 *
 * Phaser keeps everything it already owned — input, the scene graph, entities,
 * the network, the DOM HUD — and this owns only what the frame looks like: a
 * WebGL canvas under the HUD, a fixed 3/4 camera, and one sync per frame that
 * stands billboards where the scene's own sprites already are.
 */
import * as THREE from "three";
import type Phaser from "phaser";
import { TILE_SIZE, GAME_HEIGHT, GAME_WIDTH } from "../game/GameConfig.ts";
import type { CameraFraming } from "../game/cameraFraming.ts";
import { CAMERA_3D, framedGroundFocus, placeCamera, type GroundPoint } from "./camera3d.ts";
import { CharacterBillboards, type EntityBillboard } from "./characters3d.ts";
import { buildQuadGeometry, fullUv } from "./geometry3d.ts";
import { Texture3DCache } from "./texture3d.ts";
import { buildZone3D, type Zone3D, type Zone3DInput } from "./zone3d.ts";
import { AmbientParticles, zoneAtmosphere } from "./ambient3d.ts";
import { WorldEffects3D } from "./effects3d.ts";
import { getSettings, onSettingsChange } from "../ui/settings.ts";

/** The void beyond the map when there is no fog to match. */
const BACKGROUND_COLOUR = 0x121d13;

/** Where the prompt badge hangs, in world units. */
export interface BadgePlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One frame's worth of world state, all of it already simulated elsewhere. */
export interface World3DFrame {
  /** Where the courier stands, in tiles. */
  readonly subject: GroundPoint;
  /** Normalised movement input, for the camera's look-ahead. */
  readonly direction: { readonly x: number; readonly y: number };
  readonly dtSeconds: number;
  readonly framing: CameraFraming;
  readonly entities: readonly EntityBillboard[];
  readonly badge: BadgePlacement | null;
  readonly badgeTouch: boolean;
}

/** Badge art, in pixels of its own canvas square. */
const BADGE_CANVAS_PX = 48;
/** The badge's size in world units, matching the 2D badge's 22px. */
const BADGE_SIZE_TILES = 22 / TILE_SIZE;

/** Draw the "E" keycap the 2D badge draws, as a texture. */
function createBadgeTexture(label: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_CANVAS_PX;
  canvas.height = BADGE_CANVAS_PX;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const radius = 8;
    const inset = 1.5;
    context.beginPath();
    context.moveTo(inset + radius, inset);
    context.arcTo(BADGE_CANVAS_PX - inset, inset, BADGE_CANVAS_PX - inset, BADGE_CANVAS_PX - inset, radius);
    context.arcTo(BADGE_CANVAS_PX - inset, BADGE_CANVAS_PX - inset, inset, BADGE_CANVAS_PX - inset, radius);
    context.arcTo(inset, BADGE_CANVAS_PX - inset, inset, inset, radius);
    context.arcTo(inset, inset, BADGE_CANVAS_PX - inset, inset, radius);
    context.closePath();
    context.fillStyle = "rgba(24, 36, 26, 0.92)";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "#e8c46a";
    context.stroke();
    context.fillStyle = "#f6efdc";
    context.font = `bold ${label.length > 1 ? 13 : 26}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, BADGE_CANVAS_PX / 2, BADGE_CANVAS_PX / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Owns the WebGL canvas and the 3D world drawn into it. */
export class WorldRenderer3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cache: Texture3DCache;
  private readonly characters: CharacterBillboards;
  private readonly canvas: HTMLCanvasElement;
  private zone: Zone3D | null = null;
  private lookAhead = { x: 0, y: 0 };
  private focusOverride: GroundPoint | null = null;
  private readonly badge: THREE.Mesh;
  private readonly badgeMaterial: THREE.MeshBasicMaterial;
  private readonly badgeTextures = new Map<string, THREE.Texture>();
  private readonly effects: WorldEffects3D;
  private ambient: AmbientParticles | null = null;
  private zoneId = "";
  /** Seconds of frames drawn, the motes' clock. */
  private clock = 0;
  private readonly unsubscribeSettings: () => void;
  private disposed = false;

  constructor(
    textures: Phaser.Textures.TextureManager,
    private readonly host: HTMLElement,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.renderer = "world3d";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.zIndex = "5";
    this.canvas.style.pointerEvents = "none";
    this.host.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(BACKGROUND_COLOUR);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_3D.fovDeg,
      GAME_WIDTH / GAME_HEIGHT,
      CAMERA_3D.nearTiles,
      CAMERA_3D.farTiles,
    );
    placeCamera(this.camera, CAMERA_3D, { x: 0, z: 0 });

    this.cache = new Texture3DCache(textures);
    this.characters = new CharacterBillboards(this.scene, this.cache);
    this.effects = new WorldEffects3D(this.scene, this.cache);
    this.unsubscribeSettings = onSettingsChange(() => this.applyAtmosphere());

    this.badgeMaterial = new THREE.MeshBasicMaterial({
      map: this.badgeTexture("E"),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const badgeGeometry = buildQuadGeometry([
      { x: 0, y: 0, z: 0, width: 1, height: 1, uv: fullUv() },
    ]);
    this.badge = new THREE.Mesh(badgeGeometry, this.badgeMaterial);
    this.badge.renderOrder = 10;
    this.badge.visible = false;
    this.scene.add(this.badge);

    this.resize();
  }

  /**
   * Where a ground point lands on screen, as a fraction of the canvas (0–1).
   *
   * This is the HUD's way of aiming at the world: the quest compass points at a
   * tile, and the answer depends on the renderer, so the renderer answers it.
   * `{ x: -1, y: -1 }` means the point is behind the camera, which the caller
   * treats as "cannot be pointed at" rather than aiming at a mirrored ghost.
   */
  projectGround(x: number, z: number): { x: number; y: number } {
    const projected = new THREE.Vector3(x, 0, z).project(this.camera);
    if (projected.z > 1) return { x: -1, y: -1 };
    return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
  }

  /** The canvas the world is drawn into, for captures and diagnostics. */
  get worldCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Replace the world with a zone's static geometry. */
  attachZone(input: Zone3DInput): void {
    if (this.zone !== null) {
      this.scene.remove(this.zone.group);
      this.zone.dispose();
      this.zone = null;
    }
    this.zone = buildZone3D(this.cache, input);
    this.scene.add(this.zone.group);
    this.zoneId = input.map.id;
    this.applyAtmosphere();
  }

  /** Fog and motes for the current zone, as the graphics settings allow. */
  private applyAtmosphere(): void {
    if (this.disposed) return;
    const { graphicsQuality, reducedMotion } = getSettings();
    const atmosphere = zoneAtmosphere(this.zoneId);
    const high = graphicsQuality === "high";
    const { colour, near, far } = atmosphere.fog;
    // The background is the fog colour, so the far edge fades into it rather than a seam.
    this.scene.fog = high ? new THREE.Fog(colour, near, far) : null;
    this.scene.background = new THREE.Color(high ? colour : BACKGROUND_COLOUR);
    this.ambient?.dispose();
    this.ambient = null;
    if (high && !reducedMotion) {
      this.ambient = new AmbientParticles(atmosphere.ambient);
      this.scene.add(this.ambient.points);
    }
  }

  /**
   * Park the camera on a tile regardless of where the courier stands.
   *
   * Rendering-only: this moves the camera, never the courier, and its only
   * caller is the visual-baseline capture suite, which needs the same
   * "centred on this landmark" frame the sprite renderer's `centerOn` gives.
   * `null` hands the camera back to the courier.
   */
  setFocusOverride(focus: GroundPoint | null): void {
    this.focusOverride = focus ?? null;
  }

  /** Match the WebGL canvas to the game window's box. */
  resize(): void {
    const width = this.host.clientWidth || GAME_WIDTH;
    const height = this.host.clientHeight || GAME_HEIGHT;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Draw one frame of world state. */
  frame(state: World3DFrame): void {
    if (this.disposed) return;
    this.clock += state.dtSeconds;
    this.effects.step(state.dtSeconds);
    const override = this.focusOverride;
    if (override !== null) {
      // A capture framing: centred exactly on the landmark, no bias and no
      // look-ahead, so the frame matches the sprite renderer's `centerOn`.
      // Motes are hidden so a capture does not depend on the clock.
      this.lookAhead = { x: 0, y: 0 };
      placeCamera(this.camera, CAMERA_3D, override);
      if (this.ambient !== null) this.ambient.points.visible = false;
      this.characters.sync(state.entities);
      this.updateBadge(state.badge, state.badgeTouch);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const framed = framedGroundFocus(
      CAMERA_3D,
      state.framing,
      state.subject,
      state.direction,
      this.lookAhead,
      state.dtSeconds,
    );
    this.lookAhead = framed.lookAhead;
    placeCamera(this.camera, CAMERA_3D, framed.focus);
    if (this.ambient !== null) {
      this.ambient.points.visible = true;
      this.ambient.update(this.clock, framed.focus);
    }
    this.characters.sync(state.entities);
    this.updateBadge(state.badge, state.badgeTouch);
    this.renderer.render(this.scene, this.camera);
  }

  /** Tear the renderer down and release its GPU resources. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSettings();
    this.characters.dispose();
    this.effects.dispose();
    this.ambient?.dispose();
    this.ambient = null;
    if (this.zone !== null) {
      this.scene.remove(this.zone.group);
      this.zone.dispose();
      this.zone = null;
    }
    this.badge.geometry.dispose();
    this.badgeMaterial.dispose();
    for (const texture of this.badgeTextures.values()) texture.dispose();
    this.badgeTextures.clear();
    this.cache.dispose();
    this.renderer.dispose();
    // dispose() keeps the GL context alive; browsers cap live contexts per page.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private badgeTexture(label: string): THREE.Texture {
    const existing = this.badgeTextures.get(label);
    if (existing !== undefined) return existing;
    const texture = createBadgeTexture(label);
    this.badgeTextures.set(label, texture);
    return texture;
  }

  private updateBadge(placement: BadgePlacement | null, touch: boolean): void {
    if (placement === null) {
      this.badge.visible = false;
      return;
    }
    const texture = this.badgeTexture(touch ? "Tap" : "E");
    if (this.badgeMaterial.map !== texture) {
      this.badgeMaterial.map = texture;
      this.badgeMaterial.needsUpdate = true;
    }
    const size = touch ? BADGE_SIZE_TILES * 2 : BADGE_SIZE_TILES;
    this.badge.visible = true;
    this.badge.scale.set(size, size, 1);
    this.badge.position.set(placement.x, placement.y, placement.z);
    this.badge.rotation.y = (CAMERA_3D.yawDeg * Math.PI) / 180;
  }
}
