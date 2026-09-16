/** Admin Control Panel entry: auth gate, shell, and routes. */

import "./styles/admin.css";
import { api, readCachedAccount, clearSession, type TierInfo } from "./api.ts";
import { AdminShell } from "./shell.ts";
import { HashRouter } from "./router.ts";
import { el, toast } from "./ui.ts";
import { renderDashboard } from "./screens/dashboard.ts";
import { renderPlayers } from "./screens/players.ts";
import { renderPlayerDetail } from "./screens/playerDetail.ts";
import { renderAudit } from "./screens/audit.ts";
import { renderSettings } from "./screens/settings.ts";
import { renderRoles } from "./screens/roles.ts";
import { renderAdminUsers } from "./screens/adminUsers.ts";
import { renderItems } from "./screens/items.ts";
import { renderItemEditor } from "./screens/itemEditor.ts";

function renderAccessDenied(container: HTMLElement, message: string): void {
  container.replaceChildren(
    el(
      "div",
      { class: "admin-access-denied" },
      el("div", { style: "font-size:36px", "aria-hidden": "true" }, "🐾"),
      el("h1", {}, "Access restricted"),
      el("p", { style: "color:var(--adm-text-2)" }, message),
      el(
        "button",
        {
          type: "button",
          class: "admin-btn admin-btn--primary",
          onclick: () => {
            clearSession();
            window.location.href = "/";
          },
        },
        "Back to the game",
      ),
    ),
  );
}

async function boot(): Promise<void> {
  const container = document.getElementById("admin-app");
  if (container === null) return;

  // The admin panel reuses the game client's session (same origin + cookie).
  // No stored account and no valid session both land on the same screen.
  const cached = readCachedAccount();
  let tier: TierInfo;
  try {
    tier = await api.get<TierInfo>("/api/admin/tier");
  } catch {
    renderAccessDenied(container, cached === null
      ? "Sign in to Paws & Parcels first — the control panel reuses that session."
      : "Your session could not be verified. Sign in to the game again, then return here.");
    return;
  }

  if (tier.tier === "none") {
    renderAccessDenied(container, "Your account does not have admin-panel access. Admin tiers are derived from your ASHAT Hub role.");
    return;
  }

  // Resolve the environment banner from the overview endpoint (falls back to
  // a non-production label if overview is unreachable).
  let env = { nodeEnv: "development", runningInProduction: false };
  try {
    const overview = await api.get<{ environment: { nodeEnv: string; runningInProduction: boolean } }>("/api/admin/overview");
    env = overview.environment;
  } catch {
    // keep the dev fallback — overview failures surface per-screen
  }

  const shell = new AdminShell(tier, env);
  shell.mount(container);

  const router = new HashRouter();
  let currentHash = "#/";

  function route(content: HTMLElement, breadcrumb: string[], hash: string, render: () => void): void {
    shell.setActive(breadcrumb, hash);
    currentHash = hash;
    render();
  }

  router.add("#/", () => {
    route(shell.content(), ["Dashboard"], "#/", () => renderDashboard(shell.content()));
  });
  router.add("#/players", () => {
    route(shell.content(), ["Players"], "#/players", () => renderPlayers(shell.content()));
  });
  router.add("#/players/:accountId", (params) => {
    const id = params.accountId ?? "";
    route(shell.content(), ["Players", `Account #${id}`], `#/players/${id}`, () => renderPlayerDetail(shell.content(), id));
  });
  router.add("#/audit", () => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const focus = params.get("entry") ?? undefined;
    route(shell.content(), ["Audit Log"], "#/audit", () => renderAudit(shell.content(), focus));
  });
  router.add("#/settings", () => {
    route(shell.content(), ["Server Settings"], "#/settings", () => renderSettings(shell.content()));
  });
  router.add("#/roles", () => {
    route(shell.content(), ["Roles & Permissions"], "#/roles", () => renderRoles(shell.content()));
  });
  router.add("#/admin-users", () => {
    route(shell.content(), ["Admin Users"], "#/admin-users", () => renderAdminUsers(shell.content()));
  });
  router.add("#/items", () => {
    route(shell.content(), ["Item Database"], "#/items", () => renderItems(shell.content()));
  });
  // `new` is registered before the :itemId pattern so the literal route wins.
  router.add("#/items/new", () => {
    route(shell.content(), ["Item Database", "New Item"], "#/items/new", () => renderItemEditor(shell.content()));
  });
  router.add("#/items/:itemId", (params) => {
    const id = params.itemId ?? "";
    route(shell.content(), ["Item Database", `Item #${id}`], `#/items/${id}`, () => renderItemEditor(shell.content(), id));
  });

  if (!router.resolve()) {
    window.location.hash = "#/";
    router.resolve();
  }

  window.addEventListener("hashchange", () => {
    if (!router.resolve()) {
      // Unknown hash → dashboard.
      window.location.hash = "#/";
    }
  });

  // Surface a permission change (e.g. an admin demoted mid-session).
  window.setInterval(() => {
    void api.get<TierInfo>("/api/admin/tier").then((fresh) => {
      if (fresh.tier === "none") {
        toast("Your admin access was revoked.", "error");
        window.setTimeout(() => window.location.reload(), 1500);
      }
    }).catch(() => undefined);
  }, 120_000);

  void currentHash;
}

void boot();
