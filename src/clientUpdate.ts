const UPDATE_POLL_MS = 30_000;
const UPDATE_RELOAD_DELAY_MS = 1_200;
const UPDATE_RETRY_MS = 1_000;

interface UpdateWindow extends Window {
  __pawsUpdateReloading?: boolean;
}

export interface ClientUpdateReloadState {
  visibilityState: DocumentVisibilityState;
  activeElementTagName: string | null;
  activeElementContentEditable: boolean;
  hasBlockingOverlay: boolean;
}

let reloadTimer: number | null = null;

/** Start the production-only client bundle monitor. */
export function initClientUpdateMonitor(): void {
  if (!import.meta.env.PROD) return;

  const check = () => {
    void checkForClientUpdate();
  };
  const retryReload = () => scheduleSafeReload(0);
  void checkForClientUpdate();
  window.setInterval(check, UPDATE_POLL_MS);
  window.addEventListener("focus", check, { passive: true });
  window.addEventListener("focus", retryReload, { passive: true });
  document.addEventListener("visibilitychange", retryReload);
  document.addEventListener("input", retryReload);
}

async function checkForClientUpdate(): Promise<void> {
  const currentEntry = currentClientEntry();
  if (currentEntry === null) return;

  try {
    const response = await fetch(`./client-version.txt?ts=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return;
    const deployedEntry = (await response.text()).trim();
    if (!isNewClientEntry(currentEntry, deployedEntry)) return;
    showUpdateNotice();
  } catch {
    // A transient version-check failure must never interrupt the running game.
  }
}

/** Return the hashed production entry filename currently executing. */
function currentClientEntry(): string | null {
  const scripts = Array.from(document.scripts);
  for (const script of scripts) {
    const source = script.getAttribute("src") ?? "";
    const entry = source.replace(/^\.\//, "").replace(/^\//, "").split("?")[0] ?? "";
    if (isValidClientEntry(entry)) return entry;
  }
  return null;
}

/** Compare only safe hashed entry filenames; malformed values are ignored. */
export function isNewClientEntry(current: string, deployed: string): boolean {
  if (!isValidClientEntry(current)) return false;
  if (!isValidClientEntry(deployed)) return false;
  return current !== deployed;
}

function isValidClientEntry(value: string): boolean {
  return /^(?:[A-Za-z0-9_-]+\/)*index-[A-Za-z0-9_-]+\.js$/.test(value);
}

/** Keep automatic reloads away from user input, hidden tabs, and open dialogs. */
export function isSafeToReloadUpdate(state: ClientUpdateReloadState): boolean {
  if (state.visibilityState !== "visible" || state.hasBlockingOverlay) return false;
  if (
    state.activeElementTagName === "INPUT" ||
    state.activeElementTagName === "TEXTAREA" ||
    state.activeElementTagName === "SELECT"
  ) {
    return false;
  }
  return !state.activeElementContentEditable;
}

function readReloadSafety(): ClientUpdateReloadState {
  const active = document.activeElement;
  const activeElementTagName = active?.tagName ?? null;
  const activeElementContentEditable =
    active instanceof HTMLElement && active.isContentEditable;
  const hasBlockingOverlay =
    document.querySelector(
      '[role="dialog"]:not([hidden]):not(.hidden), .dialogue-panel:not(.hidden)',
    ) !== null;

  return {
    visibilityState: document.visibilityState,
    activeElementTagName,
    activeElementContentEditable,
    hasBlockingOverlay,
  };
}

function scheduleSafeReload(delayMs = UPDATE_RELOAD_DELAY_MS): void {
  if (reloadTimer !== null) return;
  reloadTimer = window.setTimeout(() => {
    reloadTimer = null;
    const win = window as UpdateWindow;
    if (!win.__pawsUpdateReloading) return;
    if (!isSafeToReloadUpdate(readReloadSafety())) {
      scheduleSafeReload(UPDATE_RETRY_MS);
      return;
    }
    window.location.reload();
  }, delayMs);
}

function showUpdateNotice(): void {
  const win = window as UpdateWindow;
  if (win.__pawsUpdateReloading) return;
  win.__pawsUpdateReloading = true;

  const container = document.getElementById("game-container") ?? document.body;
  const notice = document.createElement("div");
  notice.className = "client-update-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");

  const copy = document.createElement("span");
  copy.textContent = "A fresh forest update is ready.";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "client-update-notice__button";
  reload.textContent = "Reload now";
  reload.addEventListener("click", () => window.location.reload());

  notice.append(copy, reload);
  container.appendChild(notice);
  scheduleSafeReload();
}
