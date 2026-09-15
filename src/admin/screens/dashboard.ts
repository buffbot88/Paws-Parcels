/** Dashboard screen (spec §10–§14). */

import { api, type Overview, type HealthService, type ZoneStatus, type AuditEntry } from "../api.ts";
import { el, clear, skeletonCard, skeletonBlock, healthDot, formatWhen, emptyState } from "../ui.ts";

export function renderDashboard(content: HTMLElement): void {
  content.append(
    el("h1", { class: "admin-page-title" }, "Game Overview"),
    el("p", { class: "admin-page-sub" }, "Current Paws & Parcels server and LiveOps status."),
  );

  const kpiRow = el("div", { class: "admin-kpi-grid" });
  for (let i = 0; i < 4; i++) kpiRow.append(skeletonCard());
  content.append(kpiRow);

  const healthWrap = el("div", { class: "admin-card" });
  healthWrap.append(el("h2", { class: "admin-card__title" }, "Server Health"), skeletonBlock(120));
  content.append(el("h2", { class: "admin-section-title" }, "Server Health"), healthWrap);

  const zonesWrap = el("div", { class: "admin-zone-grid" });
  content.append(el("h2", { class: "admin-section-title" }, "Zones"), zonesWrap);

  const activityWrap = el("div", { class: "admin-table-wrap" });
  content.append(el("h2", { class: "admin-section-title" }, "Recent Administrative Activity"), activityWrap);

  void Promise.all([
    api.get<Overview>("/api/admin/overview"),
    api.get<{ services: HealthService[] }>("/api/admin/health"),
    api.get<{ zones: ZoneStatus[] }>("/api/admin/zones/status"),
    api.get<{ entries: AuditEntry[] }>("/api/admin/audit?limit=8"),
  ]).then(([overview, health, zones, audit]) => {
    clear(kpiRow);
    kpiRow.append(
      kpi("Players Online", `${overview.playersOnline} / ${overview.maxConcurrentPlayers}`),
      kpi("Registered Players", overview.registeredPlayers.toLocaleString()),
      kpi("Couriers", overview.characters.toLocaleString()),
      kpi("Server Status", overview.serverStatus, overview.serverStatus === "ONLINE" ? undefined : "admin-kpi__value"),
    );

    clear(healthWrap);
    for (const service of health.services) {
      healthWrap.append(
        el(
          "div",
          { class: "admin-health-row" },
          el("span", { class: "admin-health-row__name" }, service.name),
          service.note === undefined ? el("span") : el("span", { class: "admin-health-row__note" }, service.note),
          healthDot(service.status),
          el("span", { class: `admin-health-row__status` }, service.status),
        ),
      );
    }

    clear(zonesWrap);
    if (zones.zones.length === 0) {
      zonesWrap.append(emptyState("🗺️", "No zones are configured."));
    }
    for (const zone of zones.zones) {
      const enabled = zone.playersOnline > 0 || zone.isSafe;
      zonesWrap.append(
        el(
          "div",
          { class: "admin-card" },
          el("strong", {}, zone.name),
          el("div", { class: "admin-zone-card__status" }),
          el("div", { class: "admin-zone-card__status", style: `color:${enabled ? "var(--adm-clover)" : "var(--adm-text-3)"}` }, enabled ? "ENABLED" : "IDLE"),
          el("div", { class: "admin-kpi__hint" }, `Players in zone: ${zone.playersOnline} · cap ${zone.maxPlayers}${zone.isSafe ? " · safe hub" : ""}`),
        ),
      );
    }

    clear(activityWrap);
    if (audit.entries.length === 0) {
      activityWrap.append(emptyState("🌿", "No administrative activity yet."));
    } else {
      const table = el(
        "table",
        { class: "admin-table" },
        el(
          "thead",
          {},
          el("tr", {}, th("Admin"), th("Action"), th("Target"), th("Time")),
        ),
      );
      const tbody = el("tbody");
      for (const entry of audit.entries) {
        tbody.append(
          el(
            "tr",
            { class: "is-clickable", onclick: () => { window.location.hash = `#/audit?entry=${entry.id}`; } },
            td(entry.adminUsername),
            td(entry.action),
            td(entry.targetLabel !== "" ? entry.targetLabel : entry.targetId),
            td(formatWhen(entry.createdAt)),
          ),
        );
      }
      table.append(tbody);
      activityWrap.append(table);
    }
  }).catch((err: unknown) => {
    clear(content);
    content.append(emptyState("⚠️", err instanceof Error ? err.message : "Failed to load dashboard data."));
  });
}

function kpi(label: string, value: string, extraClass?: string): HTMLElement {
  return el(
    "div",
    { class: "admin-kpi" },
    el("div", { class: "admin-kpi__label" }, label),
    el("div", { class: extraClass ?? "admin-kpi__value" }, value),
  );
}

function th(text: string): HTMLElement {
  return el("th", { class: "no-sort" }, text);
}

function td(text: string): HTMLElement {
  return el("td", {}, text);
}
