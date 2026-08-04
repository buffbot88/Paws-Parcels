import Phaser from "phaser";

export interface MoveVector {
  x: number;
  y: number;
}

/** A pointer press released before turning into a drag (tap-to-interact). */
export interface Tap {
  worldX: number;
  worldY: number;
}

interface KeyMap {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  UP: Phaser.Input.Keyboard.Key;
  DOWN: Phaser.Input.Keyboard.Key;
  LEFT: Phaser.Input.Keyboard.Key;
  RIGHT: Phaser.Input.Keyboard.Key;
  E: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
  /** Phase 3 — basic attack (J). */
  J: Phaser.Input.Keyboard.Key;
}

/**
 * Unifies keyboard (WASD/arrows), touch (drag joystick) and interaction input.
 * A pointer press becomes a joystick only once it drags past DRAG_THRESHOLD;
 * releasing before that queues a tap (Phase 3 tap-to-interact). E/Space queue
 * a one-shot interact signal consumed by the scene. Phaser 4 ships no built-in
 * virtual joystick, so the touch pad is pointer-based.
 */
export class InputSystem {
  static readonly JOYSTICK_RADIUS = 48;
  static readonly DEADZONE = 0.2;
  /** Travel (px) before a pointer press engages the joystick (below = tap). */
  static readonly DRAG_THRESHOLD = 8;

  private readonly scene: Phaser.Scene;
  private readonly keys: KeyMap;
  private joystickActive = false;
  private joystickEngaged = false;
  private readonly joystickOrigin = new Phaser.Math.Vector2();
  private readonly joystickDelta = new Phaser.Math.Vector2();
  private joystickBase: Phaser.GameObjects.Arc | null = null;
  private joystickKnob: Phaser.GameObjects.Arc | null = null;

  /** The pointer currently tracked for joystick/tap; null when none is down. */
  private pointerDownId: number | null = null;
  private tapQueue: Tap | null = null;
  private interactQueued = false;
  private attackQueued = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.keys = scene.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,J",
    ) as unknown as KeyMap;

    const kb = scene.input.keyboard!;
    kb.on("keydown-E", this.queueInteract, this);
    kb.on("keydown-SPACE", this.queueInteract, this);
    kb.on("keydown-J", this.queueAttack, this);

    scene.input.on("pointerdown", this.handlePointerDown, this);
    scene.input.on("pointermove", this.handlePointerMove, this);
    scene.input.on("pointerup", this.handlePointerUp, this);
    scene.input.on("pointerout", this.handlePointerUp, this);
  }

  /** Removes input listeners (call from the scene's shutdown to avoid leaks on restart). */
  destroy(): void {
    const kb = this.scene.input.keyboard;
    if (kb) {
      kb.off("keydown-E", this.queueInteract, this);
      kb.off("keydown-SPACE", this.queueInteract, this);
      kb.off("keydown-J", this.queueAttack, this);
    }
    this.scene.input.off("pointerdown", this.handlePointerDown, this);
    this.scene.input.off("pointermove", this.handlePointerMove, this);
    this.scene.input.off("pointerup", this.handlePointerUp, this);
    this.scene.input.off("pointerout", this.handlePointerUp, this);
  }

  /** Normalized movement vector (-1..1 per axis); joystick wins over keyboard when active. */
  getMoveVector(): MoveVector {
    if (this.joystickActive) {
      const jx = this.joystickDelta.x / InputSystem.JOYSTICK_RADIUS;
      const jy = this.joystickDelta.y / InputSystem.JOYSTICK_RADIUS;
      const len = Math.hypot(jx, jy);
      if (len <= InputSystem.DEADZONE) return { x: 0, y: 0 };
      return { x: jx / len, y: jy / len };
    }

    let x = 0;
    let y = 0;
    if (this.keys.LEFT.isDown || this.keys.A.isDown) x -= 1;
    if (this.keys.RIGHT.isDown || this.keys.D.isDown) x += 1;
    if (this.keys.UP.isDown || this.keys.W.isDown) y -= 1;
    if (this.keys.DOWN.isDown || this.keys.S.isDown) y += 1;

    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** True exactly once per E/Space press (edge-triggered). */
  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  /** True exactly once per J press (edge-triggered — Phase 3 attack). */
  consumeAttack(): boolean {
    const v = this.attackQueued;
    this.attackQueued = false;
    return v;
  }

  /** The tap (world coords) since the last call, or null. */
  consumeTap(): Tap | null {
    const t = this.tapQueue;
    this.tapQueue = null;
    return t;
  }

  private queueInteract(): void {
    this.interactQueued = true;
  }

  private queueAttack(): void {
    this.attackQueued = true;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    // Ignore presses that start on DOM elements (UI overlays).
    const target = pointer.event.target as HTMLElement | null;
    if (target && target.tagName !== "CANVAS") return;
    // Only track the first pointer (multi-touch safety).
    if (this.pointerDownId !== null) return;

    this.pointerDownId = pointer.id;
    this.joystickEngaged = false;
    this.joystickActive = false;
    this.joystickOrigin.set(pointer.x, pointer.y);
    this.joystickDelta.set(0, 0);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerDownId) return;
    const dx = pointer.x - this.joystickOrigin.x;
    const dy = pointer.y - this.joystickOrigin.y;
    if (!this.joystickEngaged) {
      if (Math.hypot(dx, dy) < InputSystem.DRAG_THRESHOLD) return;
      this.joystickEngaged = true;
      this.joystickActive = true;
      if (!this.joystickBase) {
        this.joystickBase = this.scene.add
          .circle(this.joystickOrigin.x, this.joystickOrigin.y, InputSystem.JOYSTICK_RADIUS, 0xffffff, 0.15)
          .setScrollFactor(0)
          .setDepth(1000);
        this.joystickKnob = this.scene.add
          .circle(this.joystickOrigin.x, this.joystickOrigin.y, 18, 0xffffff, 0.35)
          .setScrollFactor(0)
          .setDepth(1001);
      } else {
        this.joystickBase.setPosition(this.joystickOrigin.x, this.joystickOrigin.y).setVisible(true);
        this.joystickKnob?.setPosition(this.joystickOrigin.x, this.joystickOrigin.y).setVisible(true);
      }
    }
    const len = Math.hypot(dx, dy);
    const max = InputSystem.JOYSTICK_RADIUS;
    const clamp = len > max ? max / len : 1;
    const cx = dx * clamp;
    const cy = dy * clamp;
    this.joystickDelta.set(cx, cy);
    this.joystickKnob?.setPosition(this.joystickOrigin.x + cx, this.joystickOrigin.y + cy);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerDownId) return;
    if (this.joystickActive) {
      this.joystickBase?.setVisible(false);
      this.joystickKnob?.setVisible(false);
    } else {
      // Released before dragging → tap-to-interact (world coords for hit tests).
      this.tapQueue = { worldX: pointer.worldX, worldY: pointer.worldY };
    }
    this.joystickActive = false;
    this.joystickDelta.set(0, 0);
    this.pointerDownId = null;
  }
}
