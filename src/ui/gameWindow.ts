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

  const viewport = window.visualViewport;
  const viewportWidth = Math.max(1, viewport?.width ?? document.documentElement.clientWidth ?? window.innerWidth);
  const viewportHeight = Math.max(1, (viewport?.height ?? document.documentElement.clientHeight ?? window.innerHeight) -
    (document.getElementById("top-navbar")?.offsetHeight ?? 0));
  const safeScale = Math.min(viewportWidth / GAME_WIDTH, viewportHeight / GAME_HEIGHT);
  const orientation = viewportWidth >= viewportHeight ? "landscape" : "portrait";
  let width = Math.floor(GAME_WIDTH * safeScale);
  let height = Math.floor(GAME_HEIGHT * safeScale);

  // Do not force the old minimum on a narrow phone: it would create horizontal
  // scrolling. Phaser and the HUD both remain readable at the actual viewport
  // size, with the portrait media rules handling the denser composition.
  if (viewportWidth >= MIN_WINDOW_WIDTH && width < MIN_WINDOW_WIDTH) {
    width = MIN_WINDOW_WIDTH;
    height = Math.floor((MIN_WINDOW_WIDTH * GAME_HEIGHT) / GAME_WIDTH);
  }
  width = Math.min(width, Math.floor(viewportWidth));
  height = Math.min(height, Math.floor(viewportHeight));

  container.dataset.orientation = orientation;
  container.style.setProperty("--game-scale", String(safeScale));
  container.style.width = `${Math.max(1, width)}px`;
  container.style.height = `${Math.max(1, height)}px`;
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
