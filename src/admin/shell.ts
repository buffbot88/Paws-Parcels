/** Admin shell: persistent sidebar + top bar + routed content container. */

import { el, clear } from "./ui.ts";
import type { TierInfo } from "./api.ts";

export interface NavItem {
  label: string;
  hash: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", hash: "#/" }] },
  {
    label: "Players",
    items: [{ label: "Players", hash: "#/players" }],
  },
  {
    label: "Administration",
    items: [
      { label: "Admin Users", hash: "#/admin-users" },
      { label: "Roles & Permissions", hash: "#/roles" },
      { label: "Audit Log", hash: "#/audit" },
      { label: "Server Settings", hash: "#/settings" },
    ],
  },
];

/** Environment label + presence class for badges (spec §9). */
export function environmentBadge(nodeEnv: string, runningInProduction: boolean): { label: string; cls: string } {
  if (runningInProduction) return { label: "LIVE SERVER", cls: "admin-env-badge--live" };
  const lower = nodeEnv.toLowerCase();
  if (lower.includes("stag")) return { label: "STAGING", cls: "admin-env-badge--staging" };
  return { label: "DEVELOPMENT", cls: "admin-env-badge--development" };
}

function envClass(nodeEnv: string, runningInProduction: boolean): string {
  if (runningInProduction) return "admin-sidebar__env--live";
  if (nodeEnv.toLowerCase().includes("stag")) return "admin-sidebar__env--staging";
  return "admin-sidebar__env--development";
}

export class AdminShell {
  private app: HTMLElement;
  private contentEl: HTMLElement;
  private breadcrumbEl: HTMLElement;
  private navEl: HTMLElement;
  private collapsed = false;

  constructor(tier: TierInfo, env: { nodeEnv: string; runningInProduction: boolean }) {
    this.app = el("div", { class: "admin-app" });

    // --- sidebar ---
    const brand = el("div", { class: "admin-sidebar__brand" }, "Paws & Parcels", el("small", {}, "Admin Control"));
    const envChip = el("span", { class: `admin-sidebar__env ${envClass(env.nodeEnv, env.runningInProduction)}` }, env.runningInProduction ? "LIVE" : env.nodeEnv.toUpperCase());
    this.navEl = el("nav", { class: "admin-nav", "aria-label": "Admin sections" });
    this.renderNav("#/");
    const collapseBtn = el("button", { type: "button", class: "admin-sidebar__collapse", onclick: () => this.toggleCollapse() }, "« Collapse");

    const sidebar = el("aside", { class: "admin-sidebar" }, brand, envChip, this.navEl, collapseBtn);

    // --- top bar ---
    this.breadcrumbEl = el("div", { class: "admin-topbar__breadcrumb" }, el("strong", {}, "Dashboard"));
    const badge = environmentBadge(env.nodeEnv, env.runningInProduction);
    const user = el(
      "div",
      { class: "admin-topbar__user" },
      el("span", { class: "admin-topbar__tier" }, tier.tier),
      el("span", {}, tier.displayName),
    );
    const topbar = el(
      "header",
      { class: "admin-topbar" },
      this.breadcrumbEl,
      el("div", { class: "admin-topbar__spacer" }),
      el("span", { class: `admin-env-badge ${badge.cls}` }, badge.label),
      user,
    );

    this.contentEl = el("main", { class: "admin-content", id: "admin-content" });

    const mainWrap = el("div", { class: "admin-main" });
    if (env.runningInProduction) {
      mainWrap.append(el("div", { class: "admin-live-banner" }, "You are editing the LIVE environment."));
    }
    mainWrap.append(topbar, this.contentEl);
    this.app.append(sidebar, mainWrap);
  }

  private toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.app.classList.toggle("admin-app--collapsed", this.collapsed);
  }

  private renderNav(activeHash: string): void {
    clear(this.navEl);
    for (const group of NAV) {
      const groupEl = el("div", { class: "admin-nav__group" }, el("div", { class: "admin-nav__group-label" }, group.label));
      for (const item of group.items) {
        const active = item.hash === activeHash || (item.hash !== "#/" && activeHash.startsWith(item.hash));
        groupEl.append(
          el(
            "a",
            {
              class: `admin-nav__link${active ? " admin-nav__link--active" : ""}`,
              href: item.hash,
            },
            el("span", {}, item.label),
          ),
        );
      }
      this.navEl.append(groupEl);
    }
  }

  /** Set breadcrumb segments and highlight the active nav link. */
  setActive(breadcrumb: string[], activeHash: string): void {
    clear(this.breadcrumbEl);
    breadcrumb.forEach((segment, i) => {
      if (i > 0) this.breadcrumbEl.append(el("span", { "aria-hidden": "true" }, "/"));
      this.breadcrumbEl.append(i === breadcrumb.length - 1 ? el("strong", {}, segment) : document.createTextNode(segment));
    });
    this.renderNav(activeHash);
  }

  /** Clear and return the routed content container. */
  content(): HTMLElement {
    clear(this.contentEl);
    return this.contentEl;
  }

  mount(parent: HTMLElement): void {
    parent.replaceChildren(this.app);
  }
}
