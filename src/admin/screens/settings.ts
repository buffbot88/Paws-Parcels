/** Server settings screen (spec §57–§59). */

import { api, type ServerSettings } from "../api.ts";
import { el, clear, skeletonCard, toast, closeModal, formatWhen } from "../ui.ts";

interface RateCard {
  key: "exp_rate" | "drop_rate" | "honor_rate";
  title: string;
  hint: string;
}

const RATE_CARDS: RateCard[] = [
  { key: "exp_rate", title: "EXP Rate", hint: "Multiplier applied to experience gains." },
  { key: "drop_rate", title: "Drop Rate", hint: "Multiplier applied to monster loot rolls." },
  { key: "honor_rate", title: "Honor Rate", hint: "Multiplier reserved for the honor system." },
];

export function renderSettings(content: HTMLElement): void {
  content.append(
    el("h1", { class: "admin-page-title" }, "Server Settings"),
    el("p", { class: "admin-page-sub" }, "Runtime configuration cards. Every change requires a reason and is audited."),
  );

  const grid = el("div", { class: "admin-settings-grid" });
  for (let i = 0; i < 3; i++) grid.append(skeletonCard());
  content.append(grid);

  const metaWrap = el("div", { class: "admin-card", style: "margin-top:16px" });

  void api.get<{ settings: ServerSettings }>("/api/admin/settings").then((res) => {
    clear(grid);
    const settings = res.settings;

    // Capacity cards (spec §58 — separate cards).
    grid.append(capacityCard("Max Concurrent Players", "max_concurrent_players", settings.maxConcurrentPlayers, "Hard cap on simultaneous online couriers."));
    grid.append(capacityCard("Level Cap", "level_cap", settings.levelCap, "Maximum courier level attainable."));

    // Rate cards (spec §59).
    for (const card of RATE_CARDS) {
      grid.append(rateCard(card, settings));
    }

    clear(metaWrap);
    metaWrap.append(el("h2", { class: "admin-card__title" }, "Setting Metadata"));
    const table = el("table", { class: "admin-table" }, el("thead", {}, el("tr", {}, th("Key"), th("Value"), th("Updated By"), th("Updated At"))));
    const tbody = el("tbody");
    for (const meta of settings.meta) {
      tbody.append(el("tr", {}, td(meta.key), td(meta.value), td(meta.updatedBy), td(formatWhen(meta.updatedAt))));
    }
    table.append(tbody);
    metaWrap.append(table);
  }).catch((err: unknown) => {
    clear(grid);
    grid.append(el("div", { class: "admin-card" }, el("p", {}, err instanceof Error ? err.message : "Failed to load settings.")));
  });

  content.append(metaWrap);
}

function capacityCard(title: string, key: string, value: number, hint: string): HTMLElement {
  const input = el("input", { class: "admin-input", type: "number", value: String(value), min: "1" }) as HTMLInputElement;
  const saveBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary" }, "Save");
  saveBtn.addEventListener("click", () => openReasonModal(key, input.value, title, saveBtn));
  return el(
    "div",
    { class: "admin-card" },
    el("h2", { class: "admin-card__title" }, title),
    el("label", {}, "Value", input),
    el("p", { class: "admin-form-hint" }, hint),
    el("div", { style: "margin-top:12px" }, saveBtn),
  );
}

function rateCard(card: RateCard, settings: ServerSettings): HTMLElement {
  const current = card.key === "exp_rate" ? settings.expRate : card.key === "drop_rate" ? settings.dropRate : settings.honorRate;
  const input = el("input", { class: "admin-input", type: "number", step: "0.05", min: "0", value: String(current) }) as HTMLInputElement;
  const saveBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary" }, "Save");
  saveBtn.addEventListener("click", () => openReasonModal(card.key, input.value, card.title, saveBtn));
  return el(
    "div",
    { class: "admin-card" },
    el("h2", { class: "admin-card__title" }, card.title),
    el("div", { class: "admin-kpi__value" }, `${current.toFixed(2)}×`),
    el("label", { style: "display:block; margin-top:10px" }, "New value", input),
    el("p", { class: "admin-form-hint" }, card.hint),
    el("div", { style: "margin-top:12px" }, saveBtn),
  );
}

/** Ask for the audit reason in-panel (window.prompt is blocked in some browsers). */
function openReasonModal(key: string, rawValue: string, title: string, btn: HTMLButtonElement): void {
  document.querySelector(".admin-modal-backdrop")?.remove();
  const backdrop = el("div", { class: "admin-modal-backdrop" });
  const modal = el("div", { class: "admin-modal" });
  modal.append(el("h2", { class: "admin-modal__title" }, `Update ${title}?`));
  modal.append(el("p", { class: "admin-modal__body" }, `${key} will be set to "${rawValue}". This applies to the running server and is audited.`));
  const reasonInput = el("input", { class: "admin-input", type: "text", placeholder: "Reason (required, min 3 characters)", style: "width:100%" }) as HTMLInputElement;
  modal.append(el("label", { style: "display:flex; flex-direction:column; gap:4px; font-size:12px; font-weight:600; color:var(--adm-text-2)" }, "Reason", reasonInput));
  const confirmBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary" }, "Save");
  confirmBtn.disabled = true;
  reasonInput.addEventListener("input", () => {
    confirmBtn.disabled = reasonInput.value.trim().length < 3;
  });
  confirmBtn.addEventListener("click", () => {
    closeModal();
    btn.disabled = true;
    void api.put("/api/admin/settings", { updates: { [key]: rawValue }, reason: reasonInput.value.trim() })
        .then(() => toast("Settings saved.", "success"))
        .catch((err: unknown) => toast(err instanceof Error ? err.message : "Save failed.", "error"))
        .finally(() => {
          btn.disabled = false;
          // Re-render to show updated values + metadata.
          const content = document.getElementById("admin-content");
          if (content !== null) renderSettings(content as HTMLElement);
        });
  });
  modal.append(
    el(
      "div",
      { class: "admin-modal__actions" },
      el("button", { type: "button", class: "admin-btn", onclick: closeModal }, "Cancel"),
      confirmBtn,
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.append(backdrop);
  window.setTimeout(() => reasonInput.focus(), 30);
}

function th(text: string): HTMLElement {
  return el("th", { class: "no-sort" }, text);
}

function td(text: string): HTMLElement {
  return el("td", {}, text);
}
