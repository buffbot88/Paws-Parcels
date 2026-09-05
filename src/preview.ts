import "./styles/global.css";
import "./styles/game-ui.css";
import Phaser from "phaser";
import { gameConfig } from "./game/GameConfig.ts";
import { ZoneKeys } from "./game/GameConstants.ts";
import type { BootCharacter } from "./net/bootTarget.ts";

/**
 * Offline world preview (dev only — see preview.html at the repo root).
 *
 * Seeds the boot state that main.ts normally writes after OIDC auth, then
 * boots the real scene stack unchanged. The NetworkSystem attempts
 * /api/ws-token through the Vite dev proxy, fails without a server, and
 * settles into its offline status path — world rendering is unaffected, which
 * is exactly what the map/art review workflow needs.
 */

const previewCourier: BootCharacter = {
  id: 1,
  name: "Preview",
  class_id: 3,
  zone_id: ZoneKeys.CloverVillage,
  pos_x: 37,
  pos_y: 31,
  level: 1,
};

(window as { pawsCharacters?: BootCharacter[] }).pawsCharacters = [previewCourier];

const win = window as Window & { game?: Phaser.Game };
try {
  win.game = new Phaser.Game(gameConfig);
} catch (error) {
  console.error("Preview Phaser startup failed", error);
}
