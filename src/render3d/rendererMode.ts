/**
 * Which world renderer a session runs.
 *
 * The 3D renderer is the shipped world; `?renderer=2d` keeps the sprite-based
 * path reachable so a visual regression can be compared against the world it
 * replaced without a code change.
 */
export type RendererMode = "3d" | "2d";

/** Read the renderer a session asked for, defaulting to the 3D world. */
export function readRendererMode(search?: string): RendererMode {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const requested = new URLSearchParams(query).get("renderer");
  return requested === "2d" ? "2d" : "3d";
}
