/** Audit log screen (spec §68–§69). */

import { api, type AuditEntry } from "../api.ts";
import { el, clear, skeletonTable, formatWhen, emptyState } from "../ui.ts";

const PAGE_SIZE = 50;

export function renderAudit(content: HTMLElement, focusEntryId?: string): void {
  content.append(
    el("h1", { class: "admin-page-title" }, "Audit Log"),
    el("p", { class: "admin-page-sub" }, "Every administrative action, append-only."),
  );

  let category = "";
  let offset = 0;

  const categorySelect = el(
    "select",
    { class: "admin-select", "aria-label": "Category filter" },
    el("option", { value: "" }, "All categories"),
    el("option", { value: "moderation" }, "Moderation"),
    el("option", { value: "economy" }, "Economy"),
    el("option", { value: "settings" }, "Settings"),
    el("option", { value: "general" }, "General"),
  );
  categorySelect.addEventListener("change", () => {
    category = categorySelect.value;
    offset = 0;
    void load();
  });

  content.append(
    el("div", { class: "admin-filterbar" }, el("label", {}, "Category", categorySelect)),
  );

  const tableWrap = el("div", { class: "admin-table-wrap" }, skeletonTable());
  const pagination = el("div", { class: "admin-pagination" });
  content.append(tableWrap, pagination);

  function querystring(): string {
    const params = new URLSearchParams();
    if (category !== "") params.set("category", category);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return params.toString();
  }

  async function load(): Promise<void> {
    clear(tableWrap);
    tableWrap.append(skeletonTable(8));
    clear(pagination);
    try {
      const result = await api.get<{ entries: AuditEntry[]; total: number }>(`/api/admin/audit?${querystring()}`);
      clear(tableWrap);
      if (result.entries.length === 0) {
        tableWrap.append(emptyState("🪶", "No audit entries match this filter."));
        return;
      }
      const table = el(
        "table",
        { class: "admin-table" },
        el(
          "thead",
          {},
          el("tr", {}, th("Timestamp"), th("Admin"), th("Action"), th("Category"), th("Target"), th("Environment"), th("Reason")),
        ),
      );
      const tbody = el("tbody");
      for (const entry of result.entries) {
        const row = el(
          "tr",
          { class: "is-clickable", "data-audit-id": String(entry.id) },
          td(formatWhen(entry.createdAt)),
          td(entry.adminUsername),
          td(entry.action),
          td(entry.category),
          td(entry.targetLabel !== "" ? `${entry.targetType}: ${entry.targetLabel}` : entry.targetType),
          td(entry.environment),
          td(entry.reason || "—"),
        );
        row.addEventListener("click", () => void openDetail(entry.id));
        tbody.append(row);
      }
      table.append(tbody);
      tableWrap.append(table);
      renderPagination(result.total);
      if (focusEntryId !== undefined) void openDetail(Number(focusEntryId));
    } catch (err) {
      clear(tableWrap);
      tableWrap.append(emptyState("⚠️", err instanceof Error ? err.message : "Failed to load the audit log."));
    }
  }

  function renderPagination(total: number): void {
    clear(pagination);
    const from = offset + 1;
    const to = Math.min(offset + PAGE_SIZE, total);
    pagination.append(el("span", {}, `Showing ${from}–${to} of ${total}`));
    const prev = el("button", { type: "button", class: "admin-btn admin-btn--sm", disabled: offset === 0 }, "‹ Prev");
    prev.addEventListener("click", () => {
      offset = Math.max(0, offset - PAGE_SIZE);
      void load();
    });
    const next = el("button", { type: "button", class: "admin-btn admin-btn--sm", disabled: to >= total }, "Next ›");
    next.addEventListener("click", () => {
      offset += PAGE_SIZE;
      void load();
    });
    pagination.append(prev, next);
  }

  async function openDetail(id: number): Promise<void> {
    try {
      const res = await api.get<{ entry: AuditEntry }>(`/api/admin/audit/${id}`);
      const entry = res.entry;
      const dl = el("dl", { class: "admin-detail-list" });
      dl.append(
        dt("Administrator"), dd(`${entry.adminUsername} (#${entry.adminAccountId ?? "?"})`),
        dt("Action"), dd(entry.action),
        dt("Category"), dd(entry.category),
        dt("Affected object"), dd(`${entry.targetType}: ${entry.targetId}${entry.targetLabel !== "" ? ` (${entry.targetLabel})` : ""}`),
        dt("Environment"), dd(entry.environment),
        dt("Reason"), dd(entry.reason || "—"),
        dt("Timestamp"), dd(entry.createdAt),
        dt("Request ID"), dd(entry.requestId || "—"),
        dt("IP"), dd(entry.ip || "—"),
      );
      const beforeEl = el("pre", { class: "admin-diff" }, JSON.stringify(entry.beforeState, null, 2) ?? "—");
      const afterEl = el("pre", { class: "admin-diff" }, JSON.stringify(entry.afterState, null, 2) ?? "—");
      openDrawer(`Audit entry #${entry.id}`, [
        dl,
        el("h3", { class: "admin-card__title", style: "margin-top:16px" }, "Before"),
        beforeEl,
        el("h3", { class: "admin-card__title", style: "margin-top:16px" }, "After"),
        afterEl,
      ]);
    } catch (err) {
      // non-fatal: the drawer simply doesn't open
      console.warn("Audit detail failed", err);
    }
  }

  void load();
}

function openDrawer(title: string, children: HTMLElement[]): void {
  document.querySelector(".admin-modal-backdrop")?.remove();
  const backdrop = el("div", { class: "admin-modal-backdrop" });
  const modal = el("div", { class: "admin-modal", style: "max-width:620px; max-height:80vh; overflow:auto" });
  modal.append(el("h2", { class: "admin-modal__title" }, title));
  for (const child of children) modal.append(child);
  modal.append(el("div", { class: "admin-modal__actions" }, el("button", { type: "button", class: "admin-btn", onclick: () => backdrop.remove() }, "Close")));
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
}

function th(text: string): HTMLElement {
  return el("th", { class: "no-sort" }, text);
}

function td(text: string): HTMLElement {
  return el("td", {}, text);
}

function dt(text: string): HTMLElement {
  return el("dt", {}, text);
}

function dd(text: string): HTMLElement {
  return el("dd", {}, text);
}
