import Phaser from "phaser";
import "./styles/global.css";
import "./styles/game-ui.css";
import { initClientUpdateMonitor } from "./clientUpdate.ts";
import { gameConfig } from "./game/GameConfig.ts";
import { initErrorLogging } from "./game/ErrorLog.ts";
import {
  LoginOverlay,
  clearAuthStorage,
  readAuthToken,
  type AuthFinishDetail,
  type CharacterListItem,
} from "./ui/LoginOverlay.ts";
import { CharacterDesk } from "./ui/CharacterDesk.ts";
import { CharacterMenu } from "./ui/CharacterMenu.ts";
import { CharacterProfilePanel } from "./ui/CharacterProfilePanel.ts";
import { deskStepFor } from "./ui/characterFlow.ts";
import {
  pickCharacter,
  resolveBootTarget,
  writeSelectedCharacterId,
} from "./net/bootTarget.ts";
import { NetworkSystem } from "./systems/NetworkSystem.ts";
import { dialoguePanel } from "./scenes/OverworldScene.ts";
import { loadClientConfig } from "./clientConfig.ts";
import { isMaintenance } from "./config.ts";
import { initGameWindowScale } from "./ui/gameWindow.ts";

initErrorLogging();
initClientUpdateMonitor();
// Size the game window to the device before the auth flow (and keep it in
// sync on resize/orientation) so Phaser boots into a correctly scaled canvas.
initGameWindowScale();

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
const profilePanel = new CharacterProfilePanel();

function updateNavbar(account: AuthFinishDetail["account"]): void {
  const name = document.getElementById("navbar-account");
  const accountMenu = document.getElementById("navbar-account-menu");
  const signOut = document.getElementById("navbar-sign-out");
  if (accountMenu !== null) {
    document.getElementById("hud-overlays")?.appendChild(accountMenu);
  }
  if (name instanceof HTMLButtonElement) {
    name.textContent = `${account.display_name}${account.role === "Admin" ? " ▾" : ""}`;
    name.removeAttribute("hidden");
    if (account.role === "Admin") {
      name.addEventListener("click", () => {
        if (accountMenu === null) return;
        const isOpen = !accountMenu.hidden;
        accountMenu.hidden = isOpen;
        name.setAttribute("aria-expanded", String(!isOpen));
      });
      document.addEventListener("pointerdown", (event) => {
        if (accountMenu === null || name.contains(event.target as Node)) return;
        if (!accountMenu.contains(event.target as Node)) {
          accountMenu.hidden = true;
          name.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || accountMenu === null) return;
        accountMenu.hidden = true;
        name.setAttribute("aria-expanded", "false");
      });
    } else {
      name.removeAttribute("aria-haspopup");
    }
  }
  if (accountMenu !== null) {
    accountMenu.replaceChildren();
    // The server remains the authority for /admin.html access. This client
    // gate keeps the link out of ordinary players' menus as well.
    if (account.role === "Admin") {
      const adminLink = document.createElement("a");
      adminLink.href = "/admin.html";
      adminLink.className = "navbar-account-menu__link";
      adminLink.setAttribute("role", "menuitem");
      adminLink.textContent = "⚙ Admin Control Panel";
      adminLink.addEventListener("click", () => {
        accountMenu.hidden = true;
        name?.setAttribute("aria-expanded", "false");
      });
      accountMenu.appendChild(adminLink);
    }
    accountMenu.hidden = account.role !== "Admin";
  }
  if (signOut !== null) {
    signOut.removeAttribute("hidden");
    signOut.addEventListener("click", () => {
      clearAuthStorage();
      window.location.reload();
    }, { once: true });
  }
}

/** Keep startup failures visible instead of leaving a silent offline canvas. */
function showConnectionDiagnostic(title: string, detail: string): void {
  const container = document.getElementById("game-container");
  if (container === null) return;
  const existing = container.querySelector<HTMLElement>(".connection-diagnostic");
  existing?.remove();
  const panel = document.createElement("div");
  panel.className = "connection-diagnostic";
  panel.setAttribute("role", "alert");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const message = document.createElement("span");
  message.textContent = detail;
  panel.append(heading, message);
  container.appendChild(panel);
}

NetworkSystem.get().onError = (code, message, requestType) => {
  // Intent rejections (requestType set) are gameplay feedback, not a broken
  // connection — the scary diagnostic panel is reserved for real failures.
  if (requestType !== undefined) return;
  showConnectionDiagnostic("Village connection failed", `${code}: ${message}`);
};

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
  updateNavbar(detail.account);
  win.pawsCharacters = characters;
  win.pawsSelectedCharacterId = selectedId;
  // Resolve one authoritative courier for this boot and persist that exact id
  // before either the socket or Phaser scene reads tab state.
  const resolvedCharacter = pickCharacter(characters, selectedId);
  const resolvedCharacterId = resolvedCharacter?.id ?? null;
  if (resolvedCharacterId !== null) writeSelectedCharacterId(resolvedCharacterId);
  // Begin the authenticated multiplayer session before Phaser initializes any
  // scenes or optional art. This guarantees /api/ws-token is attempted even
  // when a renderer/asset/UI error prevents the overworld from being created.
  const bootTarget = resolveBootTarget(characters, resolvedCharacterId);
  if (resolvedCharacterId !== null) {
    NetworkSystem.get().start(bootTarget.zoneId, resolvedCharacterId);
  }
  try {
    win.game = new Phaser.Game(gameConfig);
  } catch (error) {
    showConnectionDiagnostic(
      "The forest could not open",
      error instanceof Error ? error.message : String(error),
    );
    console.error("Phaser startup failed", error);
  }
  menu.mount({
    account: detail.account,
    characters,
    selectedId,
    onSwitch: (id) => playWith(detail, characters, id),
    onCreate: () => openCreateDesk(detail, characters),
    onOpenProfile: () => {
      const activeId = selectedId ?? characters[0]?.id;
      const token = readAuthToken();
      if (activeId !== undefined && token !== null) profilePanel.open(activeId, token);
    },
    onSignOut: () => {
      profilePanel.close();
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
  profilePanel.close();
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
    window.location.assign("https://www.agpstudios.org/");
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
        updateNavbar(existing.account);
        showMaintenance(existing);
        return;
      }
      const serverSelectedId = existing.account.last_played_character_id ?? null;
      const serverCharacter = existing.characters.find((c) => c.id === serverSelectedId);
      const step = deskStepFor(existing.characters.length).step;
      // The account row is authoritative. If the server remembers a valid
      // courier, refresh boots directly into it instead of reopening select.
      if (serverCharacter !== undefined || step === "play") {
        startGame(existing, existing.characters, serverCharacter?.id ?? existing.characters[0]?.id ?? null);
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

  // No Paws JWT: start OIDC immediately so an existing Hub session is reused.
  await overlay.openLogin();
}

void bootAfterAuth();
