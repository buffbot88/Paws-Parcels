import Phaser from "phaser";
import { binding, isTextField, phaserKeyList } from "./keybindings.ts";

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
}

/**
 * Unifies keyboard (WASD/arrows), touch (drag joystick) and interaction input.
 * A pointer press becomes a joystick only once it drags past DRAG_THRESHOLD;
 * releasing before that queues a tap (Phase 3 tap-to-interact). E/Space queue
 * a one-shot interact signal and 1 queues a basic attack, consumed by the
 * scene. Phaser 4 ships no built-in virtual joystick, so the touch pad is
 * pointer-based.
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
  private inventoryQueued = false;
  private captureQueued = false;
  private readonly devAccess: boolean;
  /** Edge-triggered bindings (see keybindings.ts) and the queue each one fills. */
  private readonly edgeBindings: readonly [string, (event: KeyboardEvent) => void][] = [
    ["interact", this.queueInteract],
    ["attack", this.queueAttack],
    ["inventory", this.queueInventory],
    ["capture", this.queueCapture],
  ];

  constructor(scene: Phaser.Scene, options: { devAccess?: boolean } = {}) {
    this.devAccess = options.devAccess === true;
    this.scene = scene;
    const kb = scene.input.keyboard!;
    // Capture (preventDefault) only the page-scrolling keys; letters and
    // digits must still reach DOM text fields like the courier-name input.
    this.keys = kb.addKeys(phaserKeyList(this.devAccess), false) as unknown as KeyMap;
    kb.addCapture("SPACE,UP,DOWN,LEFT,RIGHT");
    this.syncKeyboardCapture(document.activeElement);
    document.addEventListener("focusin", this.handleFocusChange);
    document.addEventListener("focusout", this.handleFocusChange);

    for (const [id, handler] of this.edgeBindings) {
      for (const key of binding(id).phaserKeys ?? []) kb.on(`keydown-${key}`, handler, this);
    }

    scene.input.on("pointerdown", this.handlePointerDown, this);
    scene.input.on("pointermove", this.handlePointerMove, this);
    scene.input.on("pointerup", this.handlePointerUp, this);
    scene.input.on("pointerout", this.handlePointerUp, this);
    // Browser gesture takeover (e.g. pull-to-refresh) fires pointercancel with
    // no pointerup — without it the joystick stays stuck.
    scene.input.on("pointercancel", this.handlePointerUp, this);
  }

  /** Removes input listeners (call from the scene's shutdown to avoid leaks on restart). */
  destroy(): void {
    document.removeEventListener("focusin", this.handleFocusChange);
    document.removeEventListener("focusout", this.handleFocusChange);
    const kb = this.scene.input.keyboard;
    if (kb) {
      for (const [id, handler] of this.edgeBindings) {
        for (const key of binding(id).phaserKeys ?? []) kb.off(`keydown-${key}`, handler, this);
      }
    }
    this.scene.input.off("pointerdown", this.handlePointerDown, this);
    this.scene.input.off("pointermove", this.handlePointerMove, this);
    this.scene.input.off("pointerup", this.handlePointerUp, this);
    this.scene.input.off("pointerout", this.handlePointerUp, this);
    this.scene.input.off("pointercancel", this.handlePointerUp, this);
  }

  /** Normalized movement vector (-1..1 per axis); joystick wins over keyboard when active. */
  getMoveVector(): MoveVector {
    if (this.isDomTextInputFocused()) return { x: 0, y: 0 };
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

  /** True exactly once per 1 press (edge-triggered — Phase 3 attack). */
  consumeAttack(): boolean {
    const v = this.attackQueued;
    this.attackQueued = false;
    return v;
  }

  /** True exactly once per I press (edge-triggered). */
  consumeInventory(): boolean {
    const v = this.inventoryQueued;
    this.inventoryQueued = false;
    return v;
  }

  /** True exactly once per Ctrl+Shift+V press (developer visual capture). */
  consumeCapture(): boolean {
    const v = this.captureQueued;
    this.captureQueued = false;
    return v;
  }

  /** The tap (world coords) since the last call, or null. */
  consumeTap(): Tap | null {
    const t = this.tapQueue;
    this.tapQueue = null;
    return t;
  }

  /** Drop every queued one-shot input so nothing fires after a freeze ends. */
  discardQueued(): void {
    this.interactQueued = false;
    this.attackQueued = false;
    this.inventoryQueued = false;
    this.captureQueued = false;
    this.tapQueue = null;
  }

  private queueInteract(): void {
    if (this.isDomTextInputFocused()) return;
    this.interactQueued = true;
  }

  private queueAttack(): void {
    if (this.isDomTextInputFocused()) return;
    this.attackQueued = true;
  }

  private queueInventory(): void {
    if (this.isDomTextInputFocused()) return;
    this.inventoryQueued = true;
  }

  private queueCapture(event: KeyboardEvent): void {
    if (this.isDomTextInputFocused()) return;
    if (!this.devAccess || !event.ctrlKey || !event.shiftKey) return;
    event.preventDefault();
    this.captureQueued = true;
  }

  private isDomTextInputFocused(): boolean {
    if (isTextField(document.activeElement)) return true;
    // Modal DOM panels pause gameplay shortcuts even when focus is on the
    // canvas/body or on a tab/button rather than a text field.
    return document.querySelector<HTMLElement>(".profile-panel:not([hidden]), .local-map-panel:not([hidden]), .character-desk:not([hidden]), .hud-modal:not([hidden])") !== null;
  }

  /**
   * Text fields get native keys (Space, arrows) while focused, and held keys
   * are released on the way in and out — the field swallows their keyup.
   */
  private readonly handleFocusChange = (event: FocusEvent): void => {
    this.syncKeyboardCapture(event.type === "focusin" ? event.target : event.relatedTarget);
    if (isTextField(event.target)) this.scene.input.keyboard?.resetKeys();
  };

  private syncKeyboardCapture(focused: EventTarget | null): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;
    if (isTextField(focused)) kb.disableGlobalCapture();
    else kb.enableGlobalCapture();
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
