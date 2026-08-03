import Phaser from "phaser";
import "./styles/global.css";
import "./styles/game-ui.css";
import { gameConfig } from "./game/GameConfig.ts";
import { initErrorLogging } from "./game/ErrorLog.ts";
import {
  LoginOverlay,
  clearAuthStorage,
  type AuthFinishDetail,
  type CharacterListItem,
} from "./ui/LoginOverlay.ts";
import { CharacterDesk } from "./ui/CharacterDesk.ts";
import { CharacterMenu } from "./ui/CharacterMenu.ts";
import { deskStepFor } from "./ui/characterFlow.ts";
import { writeSelectedCharacterId } from "./net/bootTarget.ts";
import { NetworkSystem } from "./systems/NetworkSystem.ts";
import { dialoguePanel } from "./scenes/OverworldScene.ts";

initErrorLogging();

type GameWindow = Window & {
  game?: Phaser.Game;
  pawsAccount?: AuthFinishDetail["account"];
  pawsCharacters?: AuthFinishDetail["characters"];
  pawsSelectedCharacterId?: number | null;
};

const win = window as GameWindow;

/** One desk + one HUD menu, reused across boot and in-game switch flows. */
const desk = new CharacterDesk();
const menu = new CharacterMenu();

/**
 * Boot the Phaser game once auth + a playable courier are confirmed (exposed
 * on win.game for test introspection). The chosen courier id is persisted so
 * a reload plays the same character.
 */
function startGame(
  detail: AuthFinishDetail,
  characters: CharacterListItem[],
  selectedId: number | null,
): void {
  win.pawsAccount = detail.account;
  win.pawsCharacters = characters;
  win.pawsSelectedCharacterId = selectedId;
  if (selectedId !== null) writeSelectedCharacterId(selectedId);
  win.game = new Phaser.Game(gameConfig);
  menu.mount({
    account: detail.account,
    characters,
    selectedId,
    onSwitch: (id) => playWith(detail, characters, id),
    onCreate: () => openCreateDesk(detail, characters),
    onSignOut: () => {
      clearAuthStorage();
      window.location.reload();
    },
  });
}

/** Tear down the running game and boot as the given courier. */
function playWith(
  detail: AuthFinishDetail,
  characters: CharacterListItem[],
  selectedId: number,
): void {
  menu.unmount();
  NetworkSystem.get().shutdown();
  dialoguePanel.close(); // don't carry a stale dialogue into the new session
  win.game?.destroy(true);
  win.game = undefined;
  startGame(detail, characters, selectedId);
}

/** Open the courier-desk creation form from the HUD ("create a courier"). */
function openCreateDesk(
  detail: AuthFinishDetail,
  characters: CharacterListItem[],
): void {
  const token = readAuthToken();
  if (token === null) {
    console.warn("CharacterMenu: no JWT in storage — can't open the creation desk");
    return;
  }
  menu.unmount();
  desk.show(
    { account: detail.account, characters, token },
    (nextCharacters, selectedId) => playWith(detail, nextCharacters, selectedId),
    { forceCreate: true },
  );
}

/** The JWT stays in localStorage during play; the desk needs it for /api/classes. */
function readAuthToken(): string | null {
  try {
    return window.localStorage.getItem("paws.auth.token");
  } catch {
    return null;
  }
}

/**
 * Phase 2/3 auth gate (OIDC redirect pattern): validate the stored JWT, then
 * boot straight into the game or show the courier desk based on character
 * count. Phaser never boots before the player is linked to an Ashat identity
 * and has a character to play as (a character id is required for the ws-token).
 */
async function bootAfterAuth(): Promise<void> {
  const overlay = new LoginOverlay();

  try {
    const existing = await overlay.checkExistingSession();
    if (existing !== null) {
      const step = deskStepFor(existing.characters.length).step;
      if (step === "play") {
        const only = existing.characters[0];
        startGame(existing, existing.characters, only?.id ?? null);
      } else {
        desk.show(existing, (characters, selectedId) =>
          startGame(existing, characters, selectedId),
        );
      }
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
