/**
 * The canvas-relative DOM HUD layer.
 *
 * Every world HUD component (status card, minimap, skill bar, quest tracker,
 * chat, inventory) mounts here rather than into `#game-container` itself.
 *
 * Why this exists: `#hud-layer` is absolutely positioned inside the game
 * window, so mounting a panel never takes part in the container's normal
 * flow. Before this, HUD panels were plain in-flow children of
 * `#game-container` with no stylesheet of their own — the status card
 * stretched to the full window width, and because `#game-container` clips its
 * overflow while the canvas filled its whole height, every component mounted
 * after the canvas was pushed out of view entirely.
 *
 * Falls back to the container so the HUD still mounts if the layer is absent.
 */
export function hudLayer(): HTMLElement | null {
  return (
    document.getElementById("hud-layer") ??
    document.getElementById("game-container")
  );
}
