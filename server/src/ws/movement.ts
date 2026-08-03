/**
 * Pure server-side movement validation (design/network-protocol.md §2).
 * The client sends a 4-direction intent; the server decides. All inputs are
 * untrusted: direction bounds, tile walkability, teleport sanity, and a
 * minimum interval between accepted moves (speed cap).
 */

/** A tile coordinate on a zone map. */
export interface TilePos {
  x: number;
  y: number;
}

export type MoveVerdict =
  | { ok: true; to: TilePos }
  | { ok: false; code: "INVALID_DIRECTION" | "MOVE_COLLISION" | "MOVE_TELEPORT_DETECTED" };

export interface ValidateMoveInput {
  /** Current server-authoritative position. */
  from: TilePos;
  /** Client intent, must be in {-1, 0, 1} with |dx + dy| ≤ 1 (4-direction). */
  dx: number;
  dy: number;
  /** Zone bounds (tile units). */
  width: number;
  height: number;
  /** Walkability check for the target tile. */
  isWalkable: (x: number, y: number) => boolean;
  /** Time of the last accepted move (ms epoch) — used for the speed cap. */
  lastMoveAt: number;
  /** Current time (ms epoch). */
  now: number;
  /** Minimum ms between accepted 1-tile moves (derived from max speed). */
  minMoveIntervalMs: number;
}

/**
 * Validate a move intent against the authoritative state.
 *
 * Rules:
 *  - dx/dy must be integers in {-1,0,1} with |dx+dy| ≤ 1 (no diagonals, MVP)
 *  - the target tile must be inside the zone and walkable
 *  - a move faster than one tile per minMoveIntervalMs is a speed hack and is
 *    rejected (the client keeps its last accepted position)
 *  - teleports (a target farther than one tile from `from`) are impossible by
 *    construction, but the check is defensive and explicit.
 */
export function validateMoveIntent(input: ValidateMoveInput): MoveVerdict {
  if (!Number.isInteger(input.dx) || !Number.isInteger(input.dy)) {
    return { ok: false, code: "INVALID_DIRECTION" };
  }
  const dx = input.dx as number;
  const dy = input.dy as number;
  if (
    dx < -1 || dx > 1 || dy < -1 || dy > 1 ||
    Math.abs(dx + dy) > 1 ||
    (dx === 0 && dy === 0)
  ) {
    return { ok: false, code: "INVALID_DIRECTION" };
  }

  const to = { x: input.from.x + dx, y: input.from.y + dy };

  // Teleport sanity: the target must be at most 1 tile from the last
  // accepted position (dx/dy already guarantee this — defensive check).
  if (Math.abs(to.x - input.from.x) > 1 || Math.abs(to.y - input.from.y) > 1) {
    return { ok: false, code: "MOVE_TELEPORT_DETECTED" };
  }

  // Speed cap: reject moves that arrive faster than one tile per interval.
  if (input.now - input.lastMoveAt < input.minMoveIntervalMs) {
    return { ok: false, code: "MOVE_TELEPORT_DETECTED" };
  }

  if (
    to.x < 0 || to.y < 0 ||
    to.x >= input.width || to.y >= input.height ||
    !input.isWalkable(to.x, to.y)
  ) {
    return { ok: false, code: "MOVE_COLLISION" };
  }

  return { ok: true, to };
}

/** Move interval that yields the given tiles-per-second speed. */
export function moveIntervalMsForSpeed(tilesPerSecond: number): number {
  if (tilesPerSecond <= 0) return 1000;
  return Math.max(50, Math.round(1000 / tilesPerSecond));
}
