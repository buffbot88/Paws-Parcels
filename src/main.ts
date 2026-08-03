import Phaser from "phaser";
import "./styles/global.css";
import "./styles/game-ui.css";
import { gameConfig } from "./game/GameConfig.ts";
import { initErrorLogging } from "./game/ErrorLog.ts";
import {
  LoginOverlay,
  type AuthFinishDetail,
} from "./ui/LoginOverlay.ts";

initErrorLogging();

type GameWindow = Window & {
  game?: Phaser.Game;
  pawsAccount?: AuthFinishDetail["account"];
  pawsCharacters?: AuthFinishDetail["characters"];
};

const win = window as GameWindow;

/**
 * Boot the Phaser game once auth is confirmed. Exposed on win.game so the
 * status scripts in tests / playwright can introspect it.
 */
function startGame(detail: AuthFinishDetail): void {
  win.pawsAccount = detail.account;
  win.pawsCharacters = detail.characters;
  win.game = new Phaser.Game(gameConfig);
}

/**
 * Phase 3 auth gate (OIDC redirect pattern):
 *   1. If a JWT is already in localStorage, ask /api/auth/me if it's still
 *      accepted (handles expiry and account-deletion without trusting the
 *      client clock).
 *   2. If accepted, boot Phaser immediately.
 *   3. Otherwise, show the LoginOverlay. Sign-in redirects the whole page
 *      to ASHAT Hub; /oidc-callback.html exchanges the code, stores the
 *      JWT, and reloads "/" — which runs this gate again and boots.
 *
 * The gate is intentionally a hard prerequisite — Phaser must never boot
 * before we know the player is linked to an Ashat identity.
 */
async function bootAfterAuth(): Promise<void> {
  const overlay = new LoginOverlay();

  try {
    const existing = await overlay.checkExistingSession();
    if (existing !== null) {
      startGame(existing);
      return;
    }
  } catch (err) {
    // Network/HTTP failure — fall through to login. The cozy error message
    // surfaces inside the overlay once we show it.
    console.warn("Phase 3 auth check failed; showing login overlay", err);
  }

  overlay.show();
}

void bootAfterAuth();
