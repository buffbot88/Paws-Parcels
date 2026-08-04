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
import { loadClientConfig } from "./clientConfig.ts";
import { isMaintenance } from "./config.ts";

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
 * Show a cozy maintenance screen after successful auth. The player sees
 * their name and a friendly "game server is being set up" message.
 */
function showMaintenance(detail: AuthFinishDetail): void {
  const overlay = document.getElementById("login-overlay");
  if (overlay === null) return;

  // Reuse the login overlay structure but restyle it as a maintenance card.
  overlay.removeAttribute("hidden");
  overlay.classList.add("login-overlay--visible");

  const card = overlay.querySelector(".login-card");
  if (card === null) return;

  // Replace the card contents with the maintenance message.
  card.textContent = "";
  card.classList.add("maintenance-card");

  const leaf = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaf.classList.add("login-card__leaf");
  leaf.setAttribute("viewBox", "0 0 64 64");
  leaf.setAttribute("aria-hidden", "true");
  leaf.innerHTML = `<path d="M32 6 C 18 12, 14 22, 14 36 C 14 50, 22 58, 32 58 C 42 58, 50 50, 50 36 C 50 22, 46 12, 32 6 Z M 32 10 L 32 56" stroke="#3a5a3a" stroke-width="1.6" fill="rgba(143, 201, 138, 0.55)" stroke-linecap="round" stroke-linejoin="round"/>`;

  const title = document.createElement("h1");
  title.className = "login-card__title";
  title.textContent = "The forest is resting";

  const greeting = document.createElement("p");
  greeting.className = "login-card__tagline";
  greeting.textContent = `Welcome back, ${detail.account.display_name}.`;

  const status = document.createElement("p");
  status.className = "maintenance-status";
  status.textContent = "The game server is currently under maintenance.";

  const detail2 = document.createElement("p");
  detail2.className = "maintenance-detail";
  detail2.textContent = "Our courier bears are setting up the new forest outpost. Check back soon — deliveries will resume shortly.";

  const actions = document.createElement("div");
  actions.className = "desk-actions";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "desk-btn desk-btn--primary";
  refreshBtn.textContent = "Try again";
  refreshBtn.addEventListener("click", () => window.location.reload());

  const signOutBtn = document.createElement("button");
  signOutBtn.type = "button";
  signOutBtn.className = "desk-btn desk-btn--text";
  signOutBtn.textContent = "Sign out";
  signOutBtn.addEventListener("click", () => {
    clearAuthStorage();
    window.location.reload();
  });

  actions.append(refreshBtn, signOutBtn);
  card.append(leaf, title, greeting, status, detail2, actions);
}

/**
 * Phase 2/3 auth gate (OIDC redirect pattern): validate the stored JWT, then
 * boot straight into the game or show the courier desk based on character
 * count. Phaser never boots before the player is linked to an Ashat identity
 * and has a character to play as (a character id is required for the ws-token).
 */
async function bootAfterAuth(): Promise<void> {
  // Load runtime config from server_config.json (on the web server).
  // Falls back to Vite build-time defines for local dev.
  await loadClientConfig();

  const overlay = new LoginOverlay();

  try {
    const existing = await overlay.checkExistingSession();
    if (existing !== null) {
      // Maintenance mode — show the maintenance screen instead of booting.
      if (isMaintenance()) {
        showMaintenance(existing);
        return;
      }
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
