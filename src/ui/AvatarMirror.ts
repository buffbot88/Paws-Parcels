/**
 * The avatar mirror: a canvas preview of a courier look, drawn from the class
 * frame images and recoloured in place, so it works before Phaser boots.
 * Turn it with the arrow buttons, a drag, or ArrowLeft/ArrowRight; play the
 * class animations; zoom the pixel art. Without a 2D context it stays blank.
 */
import { BODY_ART_CLASS, lookArtId, type AvatarLook } from "../game/appearance.ts";
import { recolorPixels } from "../game/avatarPalette.ts";
import { courierFrameUrls, type SpriteAnimation, type SpriteDirection } from "../game/classAssets.ts";

/** Turntable order: turning right swings the courier's front toward screen right. */
const TURN_ORDER: readonly SpriteDirection[] = ["south", "east", "north", "west"];

const FACING_LABELS: Readonly<Record<SpriteDirection, string>> = {
  south: "Front",
  east: "Right",
  north: "Back",
  west: "Left",
};

const ACTIONS: readonly { animation: SpriteAnimation; label: string; fps: number }[] = [
  { animation: "idle", label: "Idle", fps: 0 },
  { animation: "walk", label: "Walk", fps: 10 },
  { animation: "attack", label: "Attack", fps: 16 },
  { animation: "death", label: "Faint", fps: 12 },
];

const ZOOM_MIN = 3;
const ZOOM_MAX = 10;
const ZOOM_DEFAULT = 6;
const DRAG_STEP_PX = 28;
const FAINT_HOLD_MS = 900;
const FRAME_CACHE_LIMIT = 160;

const images = new Map<string, Promise<HTMLImageElement | null>>();
const frameCache = new Map<string, Promise<ImageData[]>>();
let scratch: CanvasRenderingContext2D | null | undefined;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  let pending = images.get(url);
  if (pending === undefined) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

function recolor(image: HTMLImageElement, look: AvatarLook): ImageData | null {
  scratch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (scratch === null) return null;
  const { naturalWidth: width, naturalHeight: height } = image;
  scratch.canvas.width = width;
  scratch.canvas.height = height;
  scratch.drawImage(image, 0, 0);
  const frame = scratch.getImageData(0, 0, width, height);
  frame.data.set(recolorPixels(frame.data, width, height, look.body, look.colors));
  return frame;
}

/** A look's recoloured frames for one animation and direction; empty when the art or a canvas is missing. */
export function lookFrames(
  look: AvatarLook,
  animation: SpriteAnimation,
  direction: SpriteDirection,
): Promise<ImageData[]> {
  const key = `${lookArtId(look)}|${animation}|${direction}`;
  let pending = frameCache.get(key);
  if (pending === undefined) {
    const urls = courierFrameUrls(BODY_ART_CLASS[look.body], animation, direction);
    pending = Promise.all(urls.map(loadImage)).then((loaded) =>
      loaded.flatMap((image) => {
        const frame = image === null ? null : recolor(image, look);
        return frame === null ? [] : [frame];
      }),
    );
  } else {
    frameCache.delete(key);
  }
  frameCache.set(key, pending);
  if (frameCache.size > FRAME_CACHE_LIMIT) {
    const oldest = frameCache.keys().next().value;
    if (oldest !== undefined) frameCache.delete(oldest);
  }
  return pending;
}

function paint(canvas: HTMLCanvasElement, frame: ImageData): void {
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  canvas.getContext("2d")?.putImageData(frame, 0, 0);
}

/** Draw a look's front idle pose into a small canvas (species cards). */
export function drawLookThumbnail(canvas: HTMLCanvasElement, look: AvatarLook): void {
  void lookFrames(look, "idle", "south").then((frames) => {
    const frame = frames[0];
    if (frame !== undefined && canvas.isConnected) paint(canvas, frame);
  });
}

function button(className: string, text: string, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = text;
  btn.setAttribute("aria-label", label);
  return btn;
}

export class AvatarMirror {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly facing: HTMLElement;
  private readonly actionButtons = new Map<SpriteAnimation, HTMLButtonElement>();
  private look: AvatarLook | null = null;
  private direction: SpriteDirection = "south";
  private animation: SpriteAnimation = "idle";
  private frames: ImageData[] = [];
  private frame = 0;
  private zoom = ZOOM_DEFAULT;
  private timer: number | undefined;
  private dragX: number | null = null;
  private destroyed = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "avatar-mirror";

    const stage = document.createElement("div");
    stage.className = "avatar-mirror__stage";
    const figure = document.createElement("div");
    figure.className = "avatar-mirror__figure";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "avatar-mirror__canvas";
    this.canvas.width = 36;
    this.canvas.height = 36;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    figure.appendChild(this.canvas);
    stage.appendChild(figure);

    const turn = document.createElement("div");
    turn.className = "avatar-mirror__turn";
    const left = button("avatar-mirror__button", "◀", "Turn left");
    const right = button("avatar-mirror__button", "▶", "Turn right");
    left.addEventListener("click", () => this.turn(-1));
    right.addEventListener("click", () => this.turn(1));
    this.facing = document.createElement("span");
    this.facing.className = "avatar-mirror__facing";
    turn.append(left, this.facing, right);

    const actions = document.createElement("div");
    actions.className = "avatar-mirror__actions";
    for (const action of ACTIONS) {
      const btn = button("avatar-mirror__button", action.label, `Play ${action.label.toLowerCase()}`);
      btn.addEventListener("click", () => this.play(action.animation));
      this.actionButtons.set(action.animation, btn);
      actions.appendChild(btn);
    }

    const zoom = document.createElement("label");
    zoom.className = "avatar-mirror__zoom";
    zoom.textContent = "Zoom";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(ZOOM_MIN);
    slider.max = String(ZOOM_MAX);
    slider.step = "1";
    slider.value = String(ZOOM_DEFAULT);
    slider.addEventListener("input", () => this.setZoom(Number(slider.value)));
    zoom.appendChild(slider);

    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragX = event.clientX;
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.dragX === null) return;
      const steps = Math.trunc((event.clientX - this.dragX) / DRAG_STEP_PX);
      if (steps === 0) return;
      this.dragX += steps * DRAG_STEP_PX;
      this.turn(steps);
    });
    const endDrag = (): void => {
      this.dragX = null;
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
    this.canvas.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      this.turn(event.key === "ArrowLeft" ? -1 : 1);
    });

    this.root.append(stage, turn, actions, zoom);
    container.appendChild(this.root);
    this.setZoom(ZOOM_DEFAULT);
    this.play("idle");
  }

  setLook(look: AvatarLook): void {
    this.look = look;
    this.load();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.timer);
    this.root.remove();
  }

  private turn(steps: number): void {
    const index = TURN_ORDER.indexOf(this.direction) + steps;
    this.direction = TURN_ORDER[((index % 4) + 4) % 4] as SpriteDirection;
    this.load();
  }

  private play(animation: SpriteAnimation): void {
    window.clearTimeout(this.timer);
    this.animation = animation;
    this.frame = 0;
    for (const [id, btn] of this.actionButtons) btn.setAttribute("aria-pressed", String(id === animation));
    const fps = ACTIONS.find((action) => action.animation === animation)?.fps ?? 0;
    if (fps > 0) this.timer = window.setInterval(() => this.tick(), 1000 / fps);
    this.load();
  }

  private tick(): void {
    const count = this.frames.length;
    if (count === 0) return;
    if (this.animation === "death" && this.frame >= count - 1) {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.play("idle"), FAINT_HOLD_MS);
      return;
    }
    this.frame = (this.frame + 1) % count;
    this.draw();
  }

  private load(): void {
    this.facing.textContent = FACING_LABELS[this.direction];
    this.canvas.setAttribute(
      "aria-label",
      `Courier preview, facing ${FACING_LABELS[this.direction].toLowerCase()}. Drag or use the arrow keys to turn.`,
    );
    const { look, animation, direction } = this;
    if (look === null) return;
    void lookFrames(look, animation, direction).then((frames) => {
      if (this.destroyed || look !== this.look || animation !== this.animation || direction !== this.direction) return;
      this.frames = frames;
      this.draw();
    });
    for (const other of TURN_ORDER) if (other !== direction) void lookFrames(look, animation, other);
  }

  private draw(): void {
    const frame = this.frames[this.frame % Math.max(1, this.frames.length)];
    if (frame === undefined) return;
    const resized = this.canvas.width !== frame.width || this.canvas.height !== frame.height;
    paint(this.canvas, frame);
    if (resized) this.setZoom(this.zoom);
  }

  private setZoom(zoom: number): void {
    this.zoom = zoom;
    this.canvas.style.width = `${this.canvas.width * zoom}px`;
    this.canvas.style.height = `${this.canvas.height * zoom}px`;
  }
}
