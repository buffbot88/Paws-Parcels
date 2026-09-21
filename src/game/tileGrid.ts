/**
 * The one place the tile grid is defined.
 *
 * Locked in `design/decisions.md`: a 48x48 tile. This lives on its own because
 * `GameConfig.ts` imports Phaser, and the grid number is needed by modules that
 * have to load in the node test environment — depth sorting, prop sizing, terrain
 * planning. Importing Phaser just to read a constant would break all of them, and
 * copying the literal into each of them is how a grid change becomes a silent
 * inconsistency.
 */
export const TILE_SIZE = 48;
