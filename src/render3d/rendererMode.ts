/**
 * Which world renderer a session runs.
 *
 * The 2D sprite world is the shipped default: lighter on the browser and crisp
 * with the pixel-art cast. `?renderer=3d` opts into the billboard world.
 */
export type RendererMode = "3d" | "2d";

/** Read the renderer a session asked for, defaulting to the 2D world. */
export function readRendererMode(search?: string): RendererMode {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const requested = new URLSearchParams(query).get("renderer");
  return requested === "3d" ? "3d" : "2d";
}
