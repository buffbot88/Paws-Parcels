import { GAME_HEIGHT, GAME_WIDTH } from "../game/GameConfig.ts";

/** Spec: minimum supported client width (design/decisions.md). */
const MIN_WINDOW_WIDTH = 320;

/**
 * Size #game-container to the largest 16:9 box that fits the device viewport
 * (Phaser's Scale.FIT then renders the fixed 960x540 world into it). Called at
 * boot and again on resize / orientation / visual-viewport changes so the game
 * window auto-scales to whatever device is viewing it.
 */
export function fitGameWindow(): void {
  const container = document.getElementById("game-container");
  if (container === null) return;

  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = (window.visualViewport?.height ?? window.innerHeight) -
    (document.getElementById("top-navbar")?.offsetHeight ?? 0);
  const scale = Math.min(
    viewportWidth / GAME_WIDTH,
    viewportHeight / GAME_HEIGHT,
  );
  let width = Math.round(GAME_WIDTH * scale);
  let height = Math.round(GAME_HEIGHT * scale);

  // Keep the game usable on very narrow screens (never below the spec floor).
  if (width < MIN_WINDOW_WIDTH) {
    width = MIN_WINDOW_WIDTH;
    height = Math.round((MIN_WINDOW_WIDTH * GAME_HEIGHT) / GAME_WIDTH);
  }

  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
}

/** Attach the resize listeners; also runs once immediately (pre-boot). */
export function initGameWindowScale(): void {
  fitGameWindow();
  window.addEventListener("resize", fitGameWindow);
  window.addEventListener("orientationchange", fitGameWindow);
  // Mobile URL-bar show/hide changes the visible height without a window
  // resize in some browsers — track the visual viewport too. Ignore events
  // while the user is pinch-zoomed, or the canvas would shrink mid-gesture.
  window.visualViewport?.addEventListener("resize", () => {
    if ((window.visualViewport?.scale ?? 1) !== 1) return;
    fitGameWindow();
  });
}
