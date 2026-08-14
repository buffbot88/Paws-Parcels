/**
 * Phase 3 — LoginOverlay (OIDC redirect pattern). The whole page redirects
 * to ASHAT Hub's /authorize endpoint with PKCE; /oidc-callback.html receives
 * the code, POSTs it to /api/auth/oidc/callback, and returns here with a
 * stored JWT. PKCE verifier + state live in sessionStorage so they survive
 * the redirect but die with the tab.
 */
import { SELECTED_CHARACTER_KEY } from "../net/bootTarget.ts";
import { apiPath } from "../config.ts";

const TOKEN_KEY = "paws.auth.token";
const ACCOUNT_KEY = "paws.auth.account";
const CHARACTERS_KEY = "paws.auth.characters";

/** Auth belongs to a browser tab, not shared localStorage. */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const OIDC_STATE_KEY = "paws.oidc.state";
const OIDC_VERIFIER_KEY = "paws.oidc.verifier";

interface AccountPublic {
  id: number;
  username: string;
  display_name: string;
  role: string;
  ashat_user_id: string;
}

export interface CharacterListItem {
  id: number;
  name: string;
  class_id: number;
  zone_id: string;
  pos_x: number;
  pos_y: number;
  level: number;
}

export interface AuthFinishDetail {
  account: AccountPublic & { last_played_character_id?: number | null };
  characters: CharacterListItem[];
  token: string;
}

/** The OS-supplied remote-storage tokens we accept (iOS Safari private mode has none). */
function readToken(): string | null {
  try {
    return sessionStore()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Read the stored session JWT (null when signed out) — for API calls. */
export function readAuthToken(): string | null {
  return readToken();
}

/** Admin is the only role allowed to use in-game developer tools. */
export function hasAdminDevAccess(): boolean {
  try {
    const raw = sessionStore()?.getItem(ACCOUNT_KEY) ?? null;
    if (raw === null) return false;
    const account = JSON.parse(raw) as { role?: unknown };
    return account.role === "Admin";
  } catch {
    return false;
  }
}

function writeToken(
  token: string,
  account: AccountPublic,
  characters: CharacterListItem[],
): void {
  try {
    const storage = sessionStore();
    storage?.setItem(TOKEN_KEY, token);
    storage?.setItem(ACCOUNT_KEY, JSON.stringify(account));
    storage?.setItem(CHARACTERS_KEY, JSON.stringify(characters));
  } catch {
    // If sessionStorage is blocked, the callback will report the sign-in failure.
  }
}

/** Drop the tab-scoped auth and any credentials left by older builds. */
export function clearAuthStorage(): void {
  try {
    const storage = sessionStore();
    storage?.removeItem(TOKEN_KEY);
    storage?.removeItem(ACCOUNT_KEY);
    storage?.removeItem(CHARACTERS_KEY);
    storage?.removeItem(SELECTED_CHARACTER_KEY);
    // One-time migration cleanup: older builds stored the active account in
    // localStorage, which could make two logged-in tabs impersonate each other.
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ACCOUNT_KEY);
    window.localStorage.removeItem(CHARACTERS_KEY);
    window.localStorage.removeItem(SELECTED_CHARACTER_KEY);
  } catch {
    // best effort
  }
}

/** base64url-encode a random byte string (PKCE per RFC 7636). */
function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = "";
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 PKCE challenge for a verifier. */
async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Status string for the cozy status line under the sign-in button. */
export type LoginOverlayStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; message: string };

/**
 * Singleton — the Phaser boot sequence calls LoginOverlay.boot() once before
 * the game starts. The class also wires a global `paws:auth:complete` event
 * so main.ts doesn't have to know about the overlay internals.
 */
export class LoginOverlay {
  private overlayEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private buttonEl: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;

  /** Find the overlay mount point that index.html provides. */
  private ensureMounted(): void {
    if (this.overlayEl) return;
    this.overlayEl = document.getElementById("login-overlay");
    this.statusEl = document.getElementById("login-status");
    this.buttonEl = document.getElementById(
      "login-button",
    ) as HTMLButtonElement | null;
    this.errorEl = document.getElementById("login-error");
    if (this.buttonEl) {
      this.buttonEl.addEventListener("click", () => {
        this.openLogin().catch((err: unknown) => {
          this.setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Sign-in failed",
          });
        });
      });
    }
    window.addEventListener("storage", this.handleStorage);
  }

  /** Show the overlay. Used by main.ts when /api/auth/me responds 401. */
  public show(status: LoginOverlayStatus = { kind: "idle" }): void {
    this.ensureMounted();
    if (!this.overlayEl) return;
    this.overlayEl.removeAttribute("hidden");
    this.overlayEl.classList.add("login-overlay--visible");
    this.setStatus(status);
  }

  /** Hide the overlay. Called after a successful sign-in. */
  public hide(): void {
    if (!this.overlayEl) return;
    this.overlayEl.setAttribute("hidden", "");
    this.overlayEl.classList.remove("login-overlay--visible");
  }

  private setStatus(status: LoginOverlayStatus): void {
    if (!this.statusEl || !this.errorEl) return;
    if (status.kind === "error") {
      this.errorEl.textContent = status.message;
      this.errorEl.removeAttribute("hidden");
      this.statusEl.textContent = "The courier's phone line is busy — try again.";
    } else if (status.kind === "loading") {
      this.errorEl.setAttribute("hidden", "");
      this.errorEl.textContent = "";
      this.statusEl.textContent = status.message;
    } else if (status.kind === "ready") {
      this.errorEl.setAttribute("hidden", "");
      this.errorEl.textContent = "";
      this.statusEl.textContent = status.message;
    } else {
      this.errorEl.setAttribute("hidden", "");
      this.errorEl.textContent = "";
      this.statusEl.textContent =
        "Sign in with your ASHAT Hub account to start your day as a courier.";
    }
  }

  /**
   * Kick off the OIDC authorization-code flow: generate PKCE verifier +
   * state, stash them in sessionStorage, ask the server for the authorize
   * URL, and redirect the whole page to ASHAT Hub.
   */
  public async openLogin(): Promise<void> {
    this.ensureMounted();
    this.setStatus({ kind: "loading", message: "Taking you to ASHAT Hub…" });

    const verifier = randomBase64Url(32);
    const state = randomBase64Url(24);
    const challenge = await sha256Challenge(verifier);
    try {
      window.sessionStorage.setItem(OIDC_STATE_KEY, state);
      window.sessionStorage.setItem(OIDC_VERIFIER_KEY, verifier);
    } catch {
      this.setStatus({
        kind: "error",
        message: "This browser blocks session storage — sign-in can't work here.",
      });
      return;
    }

    let authorizeUrl: string | null = null;
    try {
      const res = await fetch(
        apiPath(`/api/auth/login-url?state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(challenge)}`),
        { credentials: "omit" },
      );
      if (res.ok) {
        const body = (await res.json()) as { url?: string };
        if (typeof body.url === "string" && body.url.length > 0) {
          authorizeUrl = body.url;
        }
      }
    } catch {
      // Network blip — fall through to the error message below.
    }

    if (authorizeUrl === null) {
      this.setStatus({
        kind: "error",
        message:
          "The post office is unreachable right now. Check your connection and try again.",
      });
      return;
    }

    window.location.assign(authorizeUrl);
  }

  /**
   * Validate the existing JWT against /api/auth/me. Returns the account if
   * valid; null otherwise. Does NOT show/hide the overlay.
   */
  public async checkExistingSession(): Promise<AuthFinishDetail | null> {
    this.ensureMounted();
    const token = readToken();
    if (token === null || token.length === 0) {
      return null;
    }
    try {
      const res = await fetch(apiPath("/api/auth/me"), {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
      });
      if (res.status === 200) {
        const body = (await res.json()) as {
          account: AccountPublic;
          characters: CharacterListItem[];
        };
        writeToken(token, body.account, body.characters);
        return { ...body, token };
      }
      if (res.status === 401) {
        // JWT invalid/expired — clear so the next visit starts clean.
        clearAuthStorage();
      }
      return null;
    } catch {
      // Server unreachable — keep the token so the next online attempt works.
      return null;
    }
  }

  /**
   * Storage event from another tab logging out — drop our cached copy.
   */
  private handleStorage = (event: StorageEvent): void => {
    if (event.key === TOKEN_KEY && event.newValue === null) {
      this.show({
        kind: "error",
        message: "Signed out in another tab — sign in again to keep playing.",
      });
    }
  };
}
