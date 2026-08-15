const INVENTORY_URL = "api/assets.js";
// Fallback for standalone/offline use: set window.INVENTORY_DATA before this script loads.
const REVIEW_STORAGE_KEY = "paws-and-parcels.asset-catalog.review.v1";
const PAGE_SIZE_DEFAULT = 96;

const CATEGORY_DEFINITIONS = [
  { id: "clover-village-roads", label: "Clover Village · roads", prefix: "reference/assets/maps/CloverVillage/Map/PNG/road/", state: "cataloged", catalog: "clover-village-road-catalog.json" },
  { id: "clover-village-ground", label: "Clover Village · ground", prefix: "reference/assets/maps/CloverVillage/Map/PNG/land/", state: "cataloged", catalog: "clover-village-ground-catalog.json" },
  { id: "clover-village-buildings", label: "Clover Village · buildings", prefix: "reference/assets/maps/CloverVillage/Map/PNG/buildings/", state: "cataloged", catalog: "clover-village-building-catalog.json" },
  { id: "clover-village-decor", label: "Clover Village · decor & props", prefix: "reference/assets/maps/CloverVillage/Map/PNG/decor/", state: "cataloged", catalog: "clover-village-decor-catalog.json" },
  { id: "clover-village-npcs", label: "Clover Village · NPCs", prefix: "reference/assets/maps/CloverVillage/NPC/", state: "cataloged", catalog: "clover-village-character-catalog.json" },
  { id: "clover-village-source", label: "Clover Village · source files", prefix: "reference/assets/maps/CloverVillage/Map/", state: "source-format", catalog: "clover-village-building-catalog.json" },
  { id: "happy-valley-map", label: "Happy Valley · map & props", prefix: "reference/assets/maps/HappyValley/Map/", state: "cataloged", catalog: "clover-village-ground-catalog.json" },
  { id: "happy-valley-npcs", label: "Happy Valley · NPCs · next", prefix: "reference/assets/maps/HappyValley/NPC/", state: "uncataloged" },
  { id: "happy-valley-monsters", label: "Happy Valley · monsters", prefix: "reference/assets/maps/HappyValley/Mob/", state: "cataloged", catalog: "happy-valley-monster-catalog.json" },
  { id: "void-desert-map", label: "Void Desert · map · excluded", prefix: "reference/assets/maps/VoidDesert/Map/", state: "excluded-reference" },
  { id: "void-desert-monsters", label: "Void Desert · monsters · next", prefix: "reference/assets/maps/VoidDesert/Mob/", state: "uncataloged" },
  { id: "other-paths", label: "OtherAssets · path composites", prefix: "reference/assets/maps/OtherAssets/Paths/", state: "cataloged", catalog: "clover-village-road-catalog.json" },
  { id: "class-effects", label: "Classes · effects", prefix: "reference/assets/Classes/", include: (path) => path.includes("/AttackEffects/"), state: "cataloged", catalog: "clover-village-effects-catalog.json" },
  { id: "class-characters", label: "Classes · characters", prefix: "reference/assets/Classes/", include: (path) => path.includes("/Idle/"), state: "cataloged", catalog: "clover-village-character-catalog.json" },
  { id: "class-source", label: "Classes · source files", prefix: "reference/assets/Classes/", state: "source-format", catalog: "clover-village-character-catalog.json" },
];

// Maps homepage category ids to the pack|category keys used by the audit status map.
const AUDIT_KEYS = {
  "clover-village-roads": "CloverVillage|road",
  "clover-village-ground": "CloverVillage|ground",
  "clover-village-buildings": "CloverVillage|building",
  "clover-village-decor": "CloverVillage|decor",
  "clover-village-npcs": "CloverVillage|npc",
};

const CATALOG_LINKS = [
  ["Roads & paths", "clover-village-road-catalog.json"],
  ["Ground & terrain", "clover-village-ground-catalog.json"],
  ["Buildings", "clover-village-building-catalog.json"],
  ["Decor & greenery", "clover-village-decor-catalog.json"],
  ["NPCs & playable classes", "clover-village-character-catalog.json"],
  ["Combat effects", "clover-village-effects-catalog.json"],
  ["Happy Valley monsters", "happy-valley-monster-catalog.json"],
  ["Environmental props", "clover-village-props-catalog.json"],
];

const state = {
  files: [],
  auditStatus: {},
  gapAudit: null,
  packs: [],
  category: "all",
  search: "",
  status: "all",
  review: "all",
  role: "all",
  world: "all",
  structure: "all",
  page: 1,
  pageSize: PAGE_SIZE_DEFAULT,
  reviewNotes: readReviewNotes(),
};

const elements = {
  summary: document.querySelector("#summary"),
  search: document.querySelector("#search"),
  status: document.querySelector("#status"),
  review: document.querySelector("#review"),
  role: document.querySelector("#role"),
  world: document.querySelector("#world"),
  structure: document.querySelector("#structure"),
  categories: document.querySelector("#categories"),
  auditStatus: document.querySelector("#audit-status"),
  gapAuditSection: document.querySelector("#gap-audit"),
  gapAuditSubtitle: document.querySelector("#gap-audit-subtitle"),
  gapAuditSummary: document.querySelector("#gap-audit-summary"),
  gapAuditLaunch: document.querySelector("#gap-audit-launch"),
  gapAuditMatrix: document.querySelector("#gap-audit-matrix"),
  catalogLinks: document.querySelector("#catalog-links"),
  resultsTitle: document.querySelector("#results-title"),
  resultsMeta: document.querySelector("#results-meta"),
  reviewBanner: document.querySelector("#review-banner"),
  assetGrid: document.querySelector("#asset-grid"),
  emptyState: document.querySelector("#empty-state"),
  pagination: document.querySelector("#pagination"),
  pageSize: document.querySelector("#page-size"),
  template: document.querySelector("#asset-card-template"),
  dialog: document.querySelector("#asset-dialog"),
  dialogContent: document.querySelector("#dialog-content"),
};

function readReviewNotes() {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveReviewNotes() {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state.reviewNotes));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function isImage(file) {
  return [".png", ".gif", ".jpg", ".jpeg", ".webp", ".svg"].includes(file.extension);
}

function fileName(file) {
  return file.path.split("/").pop() ?? file.path;
}

function categoryFor(file) {
  const definition = CATEGORY_DEFINITIONS.find((candidate) => {
    if (!file.path.startsWith(candidate.prefix)) return false;
    return candidate.include === undefined || candidate.include(file.path);
  });
  if (definition !== undefined) return definition;
  return { id: "uncategorized", label: "Uncategorized / archive metadata", state: "source-format" };
}

function reviewStateFor(file) {
  const category = categoryFor(file);
  if (/maps\/CloverVillage\/Map\/PNG\/decor\/decor_\d+\.png$/i.test(file.path)) return "unclassified";
  if (category.state === "uncataloged") return "uncataloged";
  if (category.state === "excluded-reference") return "excluded-reference";
  if (category.state === "source-format" || !isImage(file)) return "source-format";
  if (file.reviewStatus === "reviewed" || file.canonicalFamily) return "reviewed";
  return "cataloged";
}

function reviewLabel(value) {
  return {
    cataloged: "Cataloged",
    reviewed: "Reviewed",
    unclassified: "Needs classification",
    uncataloged: "Not yet cataloged",
    "excluded-reference": "Excluded reference",
    "source-format": "Source format",
  }[value] ?? value;
}

function reviewBadgeClass(value) {
  return {
    cataloged: "badge-cataloged",
    reviewed: "badge-cataloged",
    unclassified: "badge-unclassified",
    uncataloged: "badge-uncataloged",
    "excluded-reference": "badge-excluded",
    "source-format": "badge-source",
  }[value] ?? "badge-reference";
}

function assetUrl(file) {
  return file.imageUrl ?? `../${encodeURI(file.path)}`;
}

function matchingFiles() {
  const query = state.search.trim().toLowerCase();
  return state.files.filter((file) => {
    const category = categoryFor(file);
    const reviewState = reviewStateFor(file);
    const matchesCategory = state.category === "all" || category.id === state.category;
    const matchesStatus = state.status === "all" || file.status === state.status;
    const matchesReview = state.review === "all" || reviewState === state.review;
    const matchesRole = state.role === "all" || (file.assetRole ?? "none") === state.role;
    const matchesWorld = state.world === "all" || (file.worldRole ?? "UNASSIGNED") === state.world;
    const matchesStructure = state.structure === "all" || (file.structureType ?? "") === state.structure;
    const haystack = `${file.path} ${category.label} ${file.usedBy ?? ""} ${file.canonicalFamily ?? ""} ${file.suggestedFilename ?? ""}`.toLowerCase();
    return matchesCategory && matchesStatus && matchesReview && matchesRole && matchesWorld && matchesStructure && (query === "" || haystack.includes(query));
  });
}

function renderSummary() {
  const imageCount = state.files.filter(isImage).length;
  const runtimeCount = state.files.filter((file) => file.status === "runtime-used").length;
  const unclassifiedCount = state.files.filter((file) => reviewStateFor(file) === "unclassified").length;
  const uncatalogedCount = state.files.filter((file) => reviewStateFor(file) === "uncataloged").length;
  const rows = [
    ["Files", formatNumber(state.files.length)],
    ["Viewable images", formatNumber(imageCount)],
    ["Runtime-used", formatNumber(runtimeCount)],
    ["Needs classification", formatNumber(unclassifiedCount)],
    ["Not yet cataloged", formatNumber(uncatalogedCount)],
  ];
  elements.summary.replaceChildren(...rows.flatMap(([label, value]) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    return [dt, dd];
  }));
}

function renderCategories() {
  const counts = new Map();
  for (const file of state.files) {
    const id = categoryFor(file).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const allButton = createCategoryButton({ id: "all", label: "All archive files" }, state.files.length);
  elements.categories.replaceChildren(allButton);
  for (const definition of CATEGORY_DEFINITIONS) {
    const button = createCategoryButton(definition, counts.get(definition.id) ?? 0);
    elements.categories.append(button);
  }
  elements.categories.append(createCategoryButton({ id: "uncategorized", label: "Uncategorized / metadata" }, counts.get("uncategorized") ?? 0));
}

function createCategoryButton(definition, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `category-button${state.category === definition.id ? " active" : ""}`;
  button.setAttribute("aria-pressed", String(state.category === definition.id));
  const labelWrap = document.createElement("span"); labelWrap.className = "category-label-wrap";
  const label = document.createElement("span"); label.textContent = definition.label;
  labelWrap.append(label);
  const audit = state.auditStatus[AUDIT_KEYS[definition.id]];
  if (audit) {
    const dot = document.createElement("span");
    dot.className = `audit-dot ${audit.tone}`;
    dot.title = `${definition.label}: ${audit.label}`;
    labelWrap.append(dot);
  }
  const number = document.createElement("span"); number.className = "category-count"; number.textContent = formatNumber(count);
  button.append(labelWrap, number);
  button.addEventListener("click", () => {
    state.category = definition.id;
    state.page = 1;
    render();
  });
  return button;
}

function renderAuditProgress() {
  const section = document.querySelector("#audit-progress");
  if (!section) return;
  const packs = state.packs ?? [];
  const list = section.querySelector(".audit-progress-bars");
  list.replaceChildren(...packs.map((pack) => {
    const total = (pack.categories ?? []).length;
    const locked = Object.keys(state.auditStatus).filter((key) => key.startsWith(`${pack.name}|`)).length;
    const pct = total === 0 ? 0 : Math.round((locked / total) * 100);
    const row = document.createElement("div"); row.className = "progress-pack";
    const name = document.createElement("span"); name.className = "pack-name"; name.textContent = pack.name; name.title = `${pack.name} — ${locked} of ${total} categories audited`;
    const track = document.createElement("div"); track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = `progress-fill${locked > 0 && locked === total ? " done" : ""}`;
    fill.style.width = `${pct}%`;
    fill.setAttribute("aria-label", `${locked} of ${total} audited`);
    track.append(fill);
    const count = document.createElement("span"); count.className = "progress-count";
    count.textContent = `${locked}/${total}`;
    row.append(name, track, count);
    return row;
  }));
  const summary = section.querySelector(".audit-progress-summary");
  const lockedTotal = Object.keys(state.auditStatus).length;
  summary.textContent = `${lockedTotal} of ${packs.reduce((sum, p) => sum + (p.categories ?? []).length, 0)} categories locked across ${packs.length} packs`;
  section.hidden = false;
}

function gapBadge(status) {
  const label = status === "ready" ? "READY" : status === "complete" ? "COMPLETE" : status === "warn" ? "PARTIAL" : "MISSING";
  const tone = status === "ready" || status === "complete" ? "ok" : status === "warn" ? "warn" : "missing";
  const el = document.createElement("span");
  el.className = `gap-badge ${tone}`;
  el.textContent = label;
  return el;
}

function renderGapAudit() {
  const section = elements.gapAuditSection;
  if (!section || !state.gapAudit) return;
  const audit = state.gapAudit;
  elements.gapAuditSubtitle.textContent = audit.subtitle;
  const summary = elements.gapAuditSummary;
  summary.replaceChildren();
  const badge = gapBadge(audit.overall.status);
  const label = document.createElement("span");
  label.className = "gap-panel-summary";
  label.textContent = audit.overall.label;
  summary.append(badge, " ", label);
  const launch = elements.gapAuditLaunch;
  launch.replaceChildren();
  for (const tier of audit.launchPlan ?? []) {
    const row = document.createElement("div");
    row.className = `gap-launch-row ${tier.status}`;
    const tierTag = document.createElement("span");
    tierTag.className = "gap-launch-tier";
    tierTag.textContent = `Launch ${tier.tier}`;
    const name = document.createElement("strong");
    name.textContent = tier.world;
    const levels = document.createElement("span");
    levels.className = "gap-tier";
    levels.textContent = `Lv ${tier.levels}`;
    row.append(tierTag, name, levels, gapBadge(tier.status === "current" ? "warn" : "ready"));
    const scope = document.createElement("div");
    scope.className = "gap-launch-scope";
    scope.textContent = `${tier.label} — ${tier.scope}`;
    row.append(scope);
    launch.append(row);
  }
  const matrix = elements.gapAuditMatrix;
  matrix.replaceChildren();
  for (const row of audit.coverageMatrix) {
    const line = document.createElement("div");
    line.className = "gap-panel-row";
    const name = document.createElement("span");
    name.className = "gap-panel-system";
    name.textContent = row.system;
    line.append(name);
    for (const key of ["clover", "happy", "void", "overall"]) {
      line.append(gapBadge(row[key]));
    }
    matrix.append(line);
  }
  section.hidden = false;
}

function renderAuditStatus() {
  if (!elements.auditStatus) return;
  const entries = Object.entries(state.auditStatus);
  elements.auditStatus.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("p"); empty.className = "audit-empty"; empty.textContent = "No categories audited yet.";
    elements.auditStatus.append(empty);
    return;
  }
  const list = document.createElement("div"); list.className = "audit-list";
  for (const [key, status] of entries) {
    const [pack, category] = key.split("|");
    const item = document.createElement("div"); item.className = "audit-item";
    const label = document.createElement("span"); label.className = "audit-label"; label.textContent = `${pack} · ${category}`;
    const pill = document.createElement("span"); pill.className = `audit-pill ${status.tone ?? "todo"}`; pill.textContent = status.label ?? status;
    item.append(label, pill);
    list.append(item);
  }
  elements.auditStatus.append(list);
}

function renderCatalogLinks() {
  elements.catalogLinks.replaceChildren(...CATALOG_LINKS.map(([label, file]) => {
    const link = document.createElement("a");
    link.href = `../design/assets/${file}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = label;
    return link;
  }));
}

function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`;
  badge.textContent = text;
  return badge;
}

function createCard(file) {
  const category = categoryFor(file);
  const reviewState = reviewStateFor(file);
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".asset-card");
  const preview = fragment.querySelector(".asset-preview");
  const image = fragment.querySelector("img");
  const previewLabel = fragment.querySelector(".preview-label");
  const extension = fragment.querySelector(".asset-extension");
  const name = fragment.querySelector(".asset-name");
  const path = fragment.querySelector(".asset-path");
  const badges = fragment.querySelector(".badge-row");
  const meta = fragment.querySelector(".asset-meta");
  const reviewSelect = fragment.querySelector(".review-select");
  const reviewNote = fragment.querySelector(".review-note");
  const saveButton = fragment.querySelector(".button-save");

  card.dataset.review = reviewState;
  card.dataset.path = file.path;
  name.textContent = fileName(file);
  path.textContent = file.path;
  extension.textContent = file.extension || "file";
  previewLabel.textContent = isImage(file) ? "Open image detail" : "Open file detail";
  if (isImage(file)) {
    image.src = assetUrl(file);
    image.alt = `${fileName(file)} — ${category.label} — ${reviewLabel(reviewState)}`;
  } else {
    image.remove();
    preview.classList.add("source-preview");
    preview.textContent = file.extension ? file.extension.replace(".", ".") : "source file";
  }
  badges.append(
    createBadge(file.status === "runtime-used" ? "Runtime-used" : "Reference-only", file.status === "runtime-used" ? "badge-runtime" : "badge-reference"),
    createBadge(reviewLabel(reviewState), reviewBadgeClass(reviewState)),
  );
  const metadata = [
    ["Category", category.label],
    ["Canonical family", file.canonicalFamily ?? "—"],
    ["Canonical name", file.suggestedFilename || file.canonicalName ? (file.suggestedFilename || file.canonicalName) : "—"],
    ["Role", file.assetRole ?? "—"],
    ["World", file.worldRole ?? "—"],
    ["Type", file.structureType ?? "—"],
    ["Dimensions", file.width && file.height ? `${file.width} × ${file.height}` : "—"],
    ["Size", formatBytes(file.bytes)],
    ["Used by", file.usedBy ?? "—"],
  ];
  if (file.renameStatus) metadata.push(["Rename", file.renameStatus]);
  meta.replaceChildren(...metadata.flatMap(([label, value]) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    return [dt, dd];
  }));

  const existingReview = state.reviewNotes[file.path];
  if (existingReview !== undefined) {
    reviewSelect.value = existingReview.classification ?? "";
    reviewNote.value = existingReview.note ?? "";
  }
  saveButton.addEventListener("click", () => {
    state.reviewNotes[file.path] = {
      classification: reviewSelect.value,
      note: reviewNote.value.trim(),
      updatedAt: new Date().toISOString(),
      sourcePath: file.path,
    };
    saveReviewNotes();
    saveButton.textContent = "Saved";
    window.setTimeout(() => { saveButton.textContent = "Save review"; }, 1200);
  });
  preview.addEventListener("click", () => openDialog(file));
  return fragment;
}

function openDialog(file) {
  const category = categoryFor(file);
  const reviewState = reviewStateFor(file);
  elements.dialogContent.replaceChildren();
  const layout = document.createElement("div"); layout.className = "dialog-layout";
  if (isImage(file)) {
    const image = document.createElement("img"); image.src = assetUrl(file); image.alt = fileName(file); layout.append(image);
  } else {
    const source = document.createElement("div"); source.className = "source-preview dialog-source-preview"; source.textContent = file.extension || "source file"; layout.append(source);
  }
  const details = document.createElement("div"); details.className = "dialog-details";
  const heading = document.createElement("h2"); heading.textContent = fileName(file);
  const path = document.createElement("p"); path.textContent = file.path; path.className = "asset-path";
  const list = document.createElement("dl");
  const rows = [["Category", category.label], ["Asset status", file.status], ["Review state", reviewLabel(reviewState)], ["Dimensions", file.width && file.height ? `${file.width} × ${file.height}` : "—"], ["File size", formatBytes(file.bytes)], ["Used by", file.usedBy ?? "—"]];
  list.append(...rows.flatMap(([label, value]) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd]; }));
  const note = document.createElement("p"); note.textContent = "Use the card review controls to save a suggested classification and note locally, then export the review file for a follow-up catalog pass.";
  details.append(heading, path, list, note); layout.append(details); elements.dialogContent.append(layout);
  elements.dialog.showModal();
}

function renderPagination(total) {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;
  elements.pagination.replaceChildren();
  if (pages <= 1) return;
  const addButton = (label, page, disabled = false, active = false) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `page-button${active ? " active" : ""}`; button.textContent = label; button.disabled = disabled;
    button.addEventListener("click", () => { state.page = page; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }); elements.pagination.append(button);
  };
  addButton("‹", Math.max(1, state.page - 1), state.page === 1);
  const start = Math.max(1, state.page - 3); const end = Math.min(pages, start + 6);
  for (let page = start; page <= end; page += 1) addButton(String(page), page, false, page === state.page);
  addButton("›", Math.min(pages, state.page + 1), state.page === pages);
}

function render() {
  const filtered = matchingFiles();
  const category = CATEGORY_DEFINITIONS.find((definition) => definition.id === state.category);
  elements.resultsTitle.textContent = category?.label ?? (state.category === "uncategorized" ? "Uncategorized / archive metadata" : "All archive files");
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageFiles = filtered.slice(start, start + state.pageSize);
  elements.resultsMeta.textContent = `${formatNumber(filtered.length)} matching files · showing ${filtered.length === 0 ? 0 : start + 1}–${Math.min(start + state.pageSize, filtered.length)} · page ${state.page} of ${pages}`;
  elements.assetGrid.replaceChildren(...pageFiles.map(createCard));
  elements.emptyState.hidden = filtered.length !== 0;
  renderPagination(filtered.length);
  renderCategories();
  const hasReviewFilter = state.review === "unclassified" || state.review === "uncataloged";
  elements.reviewBanner.hidden = !hasReviewFilter;
  if (hasReviewFilter) elements.reviewBanner.textContent = state.review === "unclassified" ? "These assets need visual classification. Do not infer a role from the filename alone." : "These packs have not received a dedicated catalog yet. Treat classifications as provisional.";
}

function exportReview() {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), source: "Asset Catalog", reviews: state.reviewNotes }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "asset-review-notes.json"; link.click(); URL.revokeObjectURL(link.href);
}

async function boot() {
  try {
    let inventory;
    if (window.INVENTORY_DATA || window.ASSETS_DATA) {
      inventory = window.INVENTORY_DATA ?? window.ASSETS_DATA;
    } else {
      // Load the .js file (avoids Apache .json block) which sets window.ASSETS_DATA
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = INVENTORY_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${INVENTORY_URL}`));
        document.head.append(script);
      });
      inventory = window.ASSETS_DATA;
    }
    state.files = inventory.assets ?? inventory.files ?? [];
    state.auditStatus = inventory.auditStatus ?? {};
    state.gapAudit = inventory.gapAudit ?? null;
    state.packs = inventory.packs ?? [];
    renderSummary(); renderAuditProgress(); renderGapAudit(); renderAuditStatus(); renderCatalogLinks(); render();
  } catch (error) {
    elements.resultsMeta.textContent = `Could not load the inventory: ${error instanceof Error ? error.message : String(error)}`;
  }
}

elements.search.addEventListener("input", (event) => { state.search = event.target.value; state.page = 1; render(); });
elements.status.addEventListener("change", (event) => { state.status = event.target.value; state.page = 1; render(); });
elements.review.addEventListener("change", (event) => { state.review = event.target.value; state.page = 1; render(); });
elements.role?.addEventListener("change", (event) => { state.role = event.target.value; state.page = 1; render(); });
elements.world?.addEventListener("change", (event) => { state.world = event.target.value; state.page = 1; render(); });
elements.structure?.addEventListener("change", (event) => { state.structure = event.target.value; state.page = 1; render(); });
elements.pageSize.addEventListener("change", (event) => { state.pageSize = Number(event.target.value); state.page = 1; render(); });
document.querySelector("#export-review").addEventListener("click", exportReview);
document.querySelector("#clear-review").addEventListener("click", () => { if (window.confirm("Clear all locally saved review notes?")) { state.reviewNotes = {}; saveReviewNotes(); render(); } });
document.querySelector("#close-dialog").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });

boot();
