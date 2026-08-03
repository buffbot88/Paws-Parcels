import Phaser from "phaser";

export interface MoveVector {
  x: number;
  y: number;
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
}

/**
 * Unifies keyboard (WASD/arrows) and touch (drag joystick) into a single
 * normalized movement vector. Phaser 4 ships no virtual joystick, so the
 * touch pad is pointer-based (BuildPlan §6 Phase 2: 4-way + touch).
 */
export class InputSystem {
  static readonly JOYSTICK_RADIUS = 48;
  static readonly DEADZONE = 0.2;

  private readonly scene: Phaser.Scene;
  private readonly keys: KeyMap;
  private joystickActive = false;
  private readonly joystickOrigin = new Phaser.Math.Vector2();
  private readonly joystickDelta = new Phaser.Math.Vector2();
  private joystickBase: Phaser.GameObjects.Arc | null = null;
  private joystickKnob: Phaser.GameObjects.Arc | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.keys = scene.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT",
    ) as unknown as KeyMap;

    scene.input.on("pointerdown", this.handlePointerDown, this);
    scene.input.on("pointermove", this.handlePointerMove, this);
    scene.input.on("pointerup", this.handlePointerUp, this);
    scene.input.on("pointerout", this.handlePointerUp, this);
  }

  /** Removes input listeners (call from the scene's shutdown to avoid leaks on restart). */
  destroy(): void {
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

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    // Ignore presses that start on DOM elements (future UI overlays).
    const target = pointer.event.target as HTMLElement | null;
    if (target && target.tagName !== "CANVAS") return;

    this.joystickActive = true;
    this.joystickOrigin.set(pointer.x, pointer.y);
    this.joystickDelta.set(0, 0);

    if (!this.joystickBase) {
      this.joystickBase = this.scene.add
        .circle(pointer.x, pointer.y, InputSystem.JOYSTICK_RADIUS, 0xffffff, 0.15)
        .setScrollFactor(0)
        .setDepth(1000);
      this.joystickKnob = this.scene.add
        .circle(pointer.x, pointer.y, 18, 0xffffff, 0.35)
        .setScrollFactor(0)
        .setDepth(1001);
    } else {
      this.joystickBase.setPosition(pointer.x, pointer.y).setVisible(true);
      this.joystickKnob?.setPosition(pointer.x, pointer.y).setVisible(true);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.joystickActive) return;
    const dx = pointer.x - this.joystickOrigin.x;
    const dy = pointer.y - this.joystickOrigin.y;
    const len = Math.hypot(dx, dy);
    const max = InputSystem.JOYSTICK_RADIUS;
    const clamp = len > max ? max / len : 1;
    const cx = dx * clamp;
    const cy = dy * clamp;
    this.joystickDelta.set(cx, cy);
    this.joystickKnob?.setPosition(this.joystickOrigin.x + cx, this.joystickOrigin.y + cy);
  }

  private handlePointerUp(): void {
    this.joystickActive = false;
    this.joystickDelta.set(0, 0);
    this.joystickBase?.setVisible(false);
    this.joystickKnob?.setVisible(false);
  }
}
