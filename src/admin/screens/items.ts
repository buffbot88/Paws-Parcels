/** Item Database screen (spec §25): searchable, filterable item catalog. */

import { api, type ItemListResponse, type ItemRow } from "../api.ts";
import { el, clear, skeletonTable, formatWhen, emptyState } from "../ui.ts";

const PAGE_SIZE = 25;

interface SortState {
  column: string;
  dir: "asc" | "desc";
}

const COLUMNS: { column: string; label: string; sortable: boolean }[] = [
  { column: "icon", label: "", sortable: false },
  { column: "key", label: "Key", sortable: true },
  { column: "name", label: "Name", sortable: true },
  { column: "category", label: "Category", sortable: true },
  { column: "rarity", label: "Rarity", sortable: true },
  { column: "stack", label: "Stack", sortable: true },
  { column: "value", label: "Value", sortable: true },
  { column: "source", label: "Source", sortable: false },
  { column: "updated", label: "Updated", sortable: true },
  { column: "actions", label: "", sortable: false },
];

export function renderItems(content: HTMLElement): void {
  const filters = { search: "", category: "", rarity: "", source: "", archived: false };
  const sort: SortState = { column: "key", dir: "asc" };
  let offset = 0;
  let canEdit = false;
  let facets: ItemListResponse["facets"] = { categories: [], rarities: [], sources: [] };

  const newBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary", onclick: () => { window.location.hash = "#/items/new"; } }, "+ New Item");
  content.append(
    el(
      "div",
      { class: "admin-page-head" },
      el(
        "div",
        {},
        el("h1", { class: "admin-page-title" }, "Item Database"),
        el("p", { class: "admin-page-sub" }, "Every item the server can grant. Panel edits are live for players and audited; catalog rows come from src/data/items.json."),
      ),
      newBtn,
    ),
  );

  const searchInput = el("input", {
    class: "admin-input",
    type: "search",
    placeholder: "Search key, name, or description…",
    style: "min-width:260px",
    "aria-label": "Search items",
  }) as HTMLInputElement;
  const categorySelect = el("select", { class: "admin-select", "aria-label": "Category filter" }) as HTMLSelectElement;
  const raritySelect = el("select", { class: "admin-select", "aria-label": "Rarity filter" }) as HTMLSelectElement;
  const sourceSelect = el(
    "select",
    { class: "admin-select", "aria-label": "Source filter" },
    el("option", { value: "" }, "Any source"),
    el("option", { value: "content" }, "Content (JSON)"),
    el("option", { value: "admin" }, "Admin"),
  ) as HTMLSelectElement;
  const archivedToggle = el("input", { type: "checkbox", "aria-label": "Include archived items" }) as HTMLInputElement;

  function applyFilters(): void {
    filters.search = searchInput.value.trim();
    filters.category = categorySelect.value;
    filters.rarity = raritySelect.value;
    filters.source = sourceSelect.value;
    offset = 0;
    void load();
  }

  let debounce: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(applyFilters, 300);
  });
  for (const control of [categorySelect, raritySelect, sourceSelect]) control.addEventListener("change", applyFilters);
  archivedToggle.addEventListener("change", () => {
    filters.archived = archivedToggle.checked;
    offset = 0;
    void load();
  });

  const tableWrap = el("div", { class: "admin-table-wrap" }, skeletonTable(8));
  const pagination = el("div", { class: "admin-pagination" });

  content.append(
    el(
      "div",
      { class: "admin-filterbar" },
      el("label", {}, "Search", searchInput),
      el("label", {}, "Category", categorySelect),
      el("label", {}, "Rarity", raritySelect),
      el("label", {}, "Source", sourceSelect),
      el("label", { style: "flex-direction:row; align-items:center; gap:6px; align-self:flex-end" }, archivedToggle, "Archived"),
      el("button", {
        type: "button",
        class: "admin-btn admin-btn--sm",
        style: "align-self:flex-end",
        onclick: () => {
          searchInput.value = "";
          categorySelect.value = "";
          raritySelect.value = "";
          sourceSelect.value = "";
          archivedToggle.checked = false;
          applyFilters();
        },
      }, "Clear"),
    ),
    tableWrap,
    pagination,
  );

  function refreshFacetOptions(): void {
    if (categorySelect.options.length <= 1) {
      categorySelect.append(el("option", { value: "" }, "Any category"));
      for (const facet of facets.categories) {
        categorySelect.append(el("option", { value: facet.value }, `${facet.value} (${facet.count})`));
      }
    }
    if (raritySelect.options.length <= 1) {
      raritySelect.append(el("option", { value: "" }, "Any rarity"));
      for (const facet of facets.rarities) {
        raritySelect.append(el("option", { value: facet.value }, `${facet.value} (${facet.count})`));
      }
    }
  }

  function querystring(): string {
    const params = new URLSearchParams();
    if (filters.search !== "") params.set("search", filters.search);
    if (filters.category !== "") params.set("category", filters.category);
    if (filters.rarity !== "") params.set("rarity", filters.rarity);
    if (filters.source !== "") params.set("source", filters.source);
    if (filters.archived) params.set("archived", "1");
    params.set("sort", sort.column);
    params.set("dir", sort.dir);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return params.toString();
  }

  async function load(): Promise<void> {
    clear(tableWrap);
    tableWrap.append(skeletonTable(8));
    clear(pagination);
    try {
      const result = await api.get<ItemListResponse>(`/api/admin/items?${querystring()}`);
      canEdit = result.canEdit;
      facets = result.facets;
      refreshFacetOptions();
      newBtn.disabled = !canEdit;
      clear(tableWrap);
      if (result.items.length === 0) {
        tableWrap.append(emptyState("📦", "No items match these filters."));
        return;
      }
      tableWrap.append(buildTable(result.items));
      renderPagination(result.total);
    } catch (err) {
      clear(tableWrap);
      tableWrap.append(emptyState("⚠️", err instanceof Error ? err.message : "Failed to load items."));
    }
  }

  function buildTable(items: ItemRow[]): HTMLElement {
    const table = el("table", { class: "admin-table" });
    const headRow = el("tr");
    for (const column of COLUMNS) {
      const isActive = sort.column === column.column;
      const label = column.sortable && isActive ? `${column.label} ${sort.dir === "asc" ? "▲" : "▼"}` : column.label;
      const th = el("th", { class: column.sortable ? undefined : "no-sort" }, label);
      if (column.sortable) {
        th.addEventListener("click", () => {
          sort.dir = sort.column === column.column && sort.dir === "asc" ? "desc" : "asc";
          sort.column = column.column;
          offset = 0;
          void load();
        });
      }
      headRow.append(th);
    }
    table.append(el("thead", {}, headRow));

    const tbody = el("tbody");
    for (const item of items) {
      tbody.append(
        el(
          "tr",
          { class: "is-clickable", onclick: () => { window.location.hash = `#/items/${item.id}`; } },
          el("td", {}, el("span", { class: "admin-icon-swatch", title: item.icon, "aria-hidden": "true" }, "🐾")),
          el("td", { class: "admin-mono" }, item.key),
          el("td", {}, el("strong", {}, item.name), item.isDeleted ? el("span", { class: "admin-badge admin-badge--archived" }, "archived") : null),
          el("td", {}, item.category),
          el("td", {}, el("span", { class: `admin-badge admin-badge--rarity-${item.rarity}` }, item.rarity)),
          el("td", {}, String(item.maxStack)),
          el("td", {}, String(item.value)),
          el("td", {}, el("span", { class: `admin-badge admin-badge--${item.source}` }, item.source === "admin" ? "admin" : "content")),
          el("td", {}, formatWhen(item.updatedAt), el("div", { class: "admin-table__sub" }, item.updatedBy === "" ? "—" : item.updatedBy)),
          el(
            "td",
            {},
            el("button", {
              type: "button",
              class: "admin-btn admin-btn--sm",
              onclick: (e: Event) => {
                e.stopPropagation();
                window.location.hash = `#/items/${item.id}`;
              },
            }, item.isDeleted ? "Restore" : "Edit"),
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
    pagination.append(el("span", {}, `Showing ${from}–${to} of ${total} items`));
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
