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

/**
 * A bottom-anchored HUD column: panels that stack above one another.
 *
 * Panels here are absolutely positioned one by one, which made "above the
 * chat" a hand-measured offset — correct only until a panel's height changed
 * (a message log that grows, a media query that hides one). Inside a column
 * the relationship is layout, so the quest tracker keeps sitting above the
 * village chat for any height either of them ends up with.
 *
 * The column itself is a layout box rather than a surface: it spans more of
 * the world than the panels it holds, so it must not take pointer events.
 */
export function hudColumn(name: "bottom-left"): HTMLElement | null {
  const layer = hudLayer();
  if (layer === null) return null;
  const id = `hud-column-${name}`;
  const existing = document.getElementById(id);
  if (existing !== null) return existing;
  const column = document.createElement("div");
  column.id = id;
  column.className = `hud-column hud-column--${name}`;
  layer.appendChild(column);
  return column;
}
