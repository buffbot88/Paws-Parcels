/** Players list screen (spec §15–§17). */

import { api, type PlayerRow } from "../api.ts";
import { el, clear, skeletonTable, statusDot, statusBadge, formatWhen, emptyState, toast } from "../ui.ts";

interface Filters {
  search: string;
  status: string;
  levelMin: string;
  levelMax: string;
}

const PAGE_SIZE = 25;

export function renderPlayers(content: HTMLElement): void {
  content.append(
    el("h1", { class: "admin-page-title" }, "Players"),
    el("p", { class: "admin-page-sub" }, "Search accounts, inspect couriers, and open player profiles."),
  );

  const filters: Filters = { search: "", status: "", levelMin: "", levelMax: "" };
  let offset = 0;
  let selected = new Set<number>();

  const bulkbar = el("div", { class: "admin-bulkbar", hidden: true });
  const tableWrap = el("div", { class: "admin-table-wrap" }, skeletonTable());
  const pagination = el("div", { class: "admin-pagination" });

  const searchInput = el("input", { class: "admin-input", type: "search", placeholder: "Search username, display name, or courier…", style: "min-width:280px", "aria-label": "Search players" });
  const statusSelect = el(
    "select",
    { class: "admin-select", "aria-label": "Account status filter" },
    el("option", { value: "" }, "Any status"),
    el("option", { value: "active" }, "Active"),
    el("option", { value: "suspended" }, "Suspended"),
    el("option", { value: "banned" }, "Banned"),
  );
  const levelMinInput = el("input", { class: "admin-input", type: "number", min: "1", placeholder: "Min", style: "width:90px", "aria-label": "Minimum level" });
  const levelMaxInput = el("input", { class: "admin-input", type: "number", min: "1", placeholder: "Max", style: "width:90px", "aria-label": "Maximum level" });

  function applyFilters(): void {
    filters.search = searchInput.value.trim();
    filters.status = statusSelect.value;
    filters.levelMin = levelMinInput.value;
    filters.levelMax = levelMaxInput.value;
    offset = 0;
    selected = new Set();
    void load();
  }

  let debounce: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(applyFilters, 300);
  });
  statusSelect.addEventListener("change", applyFilters);
  levelMinInput.addEventListener("change", applyFilters);
  levelMaxInput.addEventListener("change", applyFilters);

  content.append(
    el(
      "div",
      { class: "admin-filterbar" },
      el("label", {}, "Search", searchInput),
      el("label", {}, "Account", statusSelect),
      el("label", {}, "Level min", levelMinInput),
      el("label", {}, "Level max", levelMaxInput),
    ),
    bulkbar,
    tableWrap,
    pagination,
  );

  function updateBulkbar(total: number): void {
    bulkbar.hidden = selected.size === 0;
    clear(bulkbar);
    if (selected.size === 0) return;
    bulkbar.append(
      el("span", {}, `${selected.size} selected of ${total}`),
      el("button", { type: "button", class: "admin-btn admin-btn--sm", onclick: () => { selected.clear(); updateBulkbar(total); void load(); } }, "Clear selection"),
      el("button", {
        type: "button",
        class: "admin-btn admin-btn--sm",
        onclick: () => {
          toast("Export is not available yet — coming with the bulk-management phase.", "info");
        },
      }, "Export"),
    );
  }

  function querystring(): string {
    const params = new URLSearchParams();
    if (filters.search !== "") params.set("search", filters.search);
    if (filters.status !== "") params.set("status", filters.status);
    if (filters.levelMin !== "") params.set("levelMin", filters.levelMin);
    if (filters.levelMax !== "") params.set("levelMax", filters.levelMax);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return params.toString();
  }

  async function load(): Promise<void> {
    clear(tableWrap);
    tableWrap.append(skeletonTable());
    clear(pagination);
    try {
      const result = await api.get<{ players: PlayerRow[]; total: number }>(`/api/admin/players?${querystring()}`);
      clear(tableWrap);
      if (result.players.length === 0) {
        tableWrap.append(emptyState("🐾", "No players match these filters."));
        return;
      }
      tableWrap.append(buildTable(result.players));
      updateBulkbar(result.total);
      renderPagination(result.total);
    } catch (err) {
      clear(tableWrap);
      tableWrap.append(emptyState("⚠️", err instanceof Error ? err.message : "Failed to load players."));
    }
  }

  function buildTable(players: PlayerRow[]): HTMLElement {
    const table = el("table", { class: "admin-table" });
    table.append(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { class: "no-sort" }, ""),
          el("th", { class: "no-sort" }, "Status"),
          th("Username"),
          th("Character"),
          th("Level"),
          th("Zone"),
          th("Stamps"),
          th("Last Login"),
          th("Account Status"),
          el("th", { class: "no-sort" }, "Actions"),
        ),
      ),
    );
    const tbody = el("tbody");
    for (const player of players) {
      const primary = player.characters[0];
      const checkbox = el("input", { type: "checkbox", "aria-label": `Select ${player.username}` }) as HTMLInputElement;
      checkbox.checked = selected.has(player.accountId);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(player.accountId);
        else selected.delete(player.accountId);
        updateBulkbar(players.length);
      });
      const statusWord = player.status === "active" ? (primary === undefined ? "offline" : "offline") : "suspended";
      tbody.append(
        el(
          "tr",
          { class: "is-clickable", onclick: (e: Event) => {
            if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "BUTTON") return;
            window.location.hash = `#/players/${player.accountId}`;
          } },
          el("td", {}, checkbox),
          el("td", { title: statusWord }, statusDot(statusWord), statusWord),
          td(player.username),
          td(primary?.name ?? "—"),
          td(primary === undefined ? "—" : String(primary.level)),
          td(primary?.zoneId ?? "—"),
          td(primary === undefined ? "—" : String(primary.stamps)),
          td(formatWhen(player.lastLoginAt)),
          el("td", {}, statusBadge(player.status)),
          el(
            "td",
            {},
            el("button", {
              type: "button",
              class: "admin-btn admin-btn--sm",
              onclick: (e: Event) => {
                e.stopPropagation();
                window.location.hash = `#/players/${player.accountId}`;
              },
            }, "Open"),
          ),
        ),
      );
    }
    table.append(tbody);
    return table;
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

  void load();
}

function th(text: string): HTMLElement {
  return el("th", { class: "no-sort" }, text);
}

function td(text: string): HTMLElement {
  return el("td", {}, text);
}
