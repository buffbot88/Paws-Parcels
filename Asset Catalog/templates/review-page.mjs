        // Summary counts
        const familiesOnPage = [...new Set(catAssets.map((a) => familyOf(a.path)))];
        const completes = catAssets.filter((a) => a.assetRole === "complete").length;
        const components = catAssets.filter((a) => a.assetRole === "component").length;
        const props = catAssets.filter((a) => a.assetRole === "prop").length;
        const others = catAssets.length - completes - components - props;
        const summaryBar = `<div class="summary-bar">${familiesOnPage.length} families · ${catAssets.length} source assets · ${completes} placeable composite${completes !== 1 ? "s" : ""} · ${components} component${components !== 1 ? "s" : ""} · ${props} prop${props !== 1 ? "s" : ""}${others > 0 ? ` · ${others} other` : ""}</div>`;
        // Filter controls
        const filterBar = `<div class="filter-bar">
  <span class="filter-label">Filter:</span>
  <label><input type="checkbox" class="filter-check" data-f="placeable" /> <span>Placeable only</span></label>
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="complete" /> complete</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="component" /> component</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="prop" /> prop</label>
  </span>
  <span class="filter-group">World
    <label><input type="checkbox" class="filter-check" data-f="world" data-v="CLOVER_SAFE" /> Clover</label>
    <label><input type="checkbox" class="filter-check" data-f="world" data-v="SHARED_1_20" /> Shared</label>
    <label><input type="checkbox" class="filter-check" data-f="world" data-v="PVE_1_20" /> PvE</label>
    <label><input type="checkbox" class="filter-check" data-f="world" data-v="FUTURE" /> Future</label>
  </span>
  <span class="filter-group">Status
    <label><input type="checkbox" class="filter-check" data-f="runtime" data-v="runtime-used" /> runtime</label>
    <label><input type="checkbox" class="filter-check" data-f="runtime" data-v="reference-only" /> reference</label>
  </span>
  <button type="button" id="filter-clear">Clear</button>
</div>
<p id="filter-note" class="filter-note"></p>
`;

        let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${packName} ${cat}${label} — Review</title>
<style>
  body { font-family: system-ui; max-width: 1200px; margin: 1rem auto; padding: 0 1rem; color: #263228; background: #f3f7f1; }
  h1 { font-size: 1.3rem; }
  nav { margin-bottom: 1rem; }
  nav a { color: #456b4e; margin-right: 1rem; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  .summary-bar { padding: 0.6rem 1rem; margin-bottom: 0.75rem; background: #dce8da; border: 1px solid #b9cfb5; border-radius: 6px; font-size: 0.9rem; font-weight: 600; color: #2e5037; }
  .filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; margin-bottom: 0.25rem; background: #fff; border: 1px solid #d9e3d7; border-radius: 6px; font-size: 0.8rem; }
  .filter-bar .filter-label { font-weight: 600; color: #68766b; }
  .filter-bar .filter-group { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.5rem; background: #f0f4ee; border-radius: 4px; }
  .filter-bar label { display: inline-flex; align-items: center; gap: 0.2rem; cursor: pointer; }
  .filter-bar button { border: 1px solid #b9cfb5; background: #e8f0e6; border-radius: 4px; padding: 0.2rem 0.6rem; cursor: pointer; font-size: 0.8rem; }
  .filter-note { min-height: 1rem; margin: 0.25rem 0 0; font-size: 0.8rem; color: #a36e23; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .card { background: #fff; border: 1px solid #d9e3d7; border-radius: 8px; padding: 0.75rem; }
  .card img { max-width: 100%; max-height: 250px; object-fit: contain; display: block; margin: 0 auto 0.75rem; background: repeating-conic-gradient(#e8ede6 0% 25%, #fff 0% 50%) 50%/16px 16px; border-radius: 4px; }
  .card .filename { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; }
  .card .canonical { font-size: 0.78rem; color: #416f99; font-family: ui-monospace, monospace; margin-top: 0.15rem; }
  .card .path { font-size: 0.75rem; color: #68766b; word-break: break-all; margin-bottom: 0.5rem; }
  .card .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.75rem; }
  .card .meta span { padding: 0.15rem 0.4rem; border-radius: 4px; background: #f0f4ee; }
  .card .meta .runtime { background: #e8f5e9; color: #2e7d32; }
  .card .meta .reference { background: #f5f5f5; color: #666; }
  .card .meta .confirmed { background: #e3f2fd; color: #1565c0; }
  .card .meta .unreviewed { background: #fff3e0; color: #e65100; }
  .family { margin-top: 1.25rem; }
  .family-toggle { display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left; background: #e8f0e6; border: 1px solid #b9cfb5; border-left: 4px solid #456b4e; border-radius: 6px 6px 0 0; padding: 0.65rem 1rem; cursor: pointer; font: inherit; }
  .family-toggle:hover { background: #dce8da; }
  .family-caret { color: #456b4e; font-size: 0.9rem; }
  .family-title { font-weight: 700; font-size: 1.05rem; color: #2e5037; }
  .family-header { padding: 0.6rem 1rem; background: #f2f6f0; border: 1px solid #d9e3d7; border-top: none; }
  .family-header p { margin: 0; font-size: 0.8rem; color: #68766b; }
  .family-header .world-role { font-weight: 600; color: #416f99; }
  .family-header .structure-type { font-weight: 600; color: #2e5037; }
  .family-header .suitability { font-weight: 600; color: #a36e23; }
  .family-header .family-uses { font-size: 0.75rem; color: #68766b; margin-top: 0.25rem; }
  .family-assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; padding: 1rem; background: #fbfdfa; border: 1px solid #d9e3d7; border-top: none; border-radius: 0 0 6px 6px; }
</style>
</head>
<body>
<nav><a href="../index.html">← All Categories</a></nav>
<h1>${packName} / ${cat} — ${catAssets.length} assets</h1>
${summaryBar}
${filterBar}
<div class="grid">
`;
        // Track which families appear on this page
        const seenFamilies = new Set();
        for (const asset of slice) {
          const family = familyOf(asset.path);
          // Family header (first time this family appears on the page)
          if (!seenFamilies.has(family)) {
            seenFamilies.add(family);
            const famAssets = familyMap.get(family) ?? [];
            const completeCount = famAssets.filter((a) => a.assetRole === "complete").length;
            const componentCount = famAssets.filter((a) => a.assetRole === "component").length;
            const propCount = famAssets.filter((a) => a.assetRole === "prop").length;
            const otherCount = famAssets.length - completeCount - componentCount - propCount;
            const familyReview = famAssets.find((a) => a.canonicalFamily);
            const familyLabel = familyReview?.suggestedFamilyName ? `${family} — ${familyReview.suggestedFamilyName}` : family;
            const breakdown = famAssets.length === 0 ? "" : `${famAssets.length} assets · ${completeCount} complete / ${componentCount} components${propCount > 0 ? ` / ${propCount} props` : ""}${otherCount > 0 ? ` / ${otherCount} other` : ""}`;
            const worldRole = familyReview?.worldRole ? ` · <span class="world-role">${familyReview.worldRole}</span>` : "";
            const suitability = familyReview?.suitability ? ` · <span class="suitability">Clover suitability: ${familyReview.suitability}</span>` : "";
            const structureType = familyReview?.structureType ? ` · <span class="structure-type">${familyReview.structureType}</span>` : "";
            const uses = familyReview?.recommendedUses?.length ? ` · Uses: ${familyReview.recommendedUses.slice(0, 4).join(", ")}` : "";
            html += `<section class="family" data-family="${family}"><button type="button" class="family-toggle" aria-expanded="true"><span class="family-caret">▾</span><span class="family-title">${familyLabel}</span></button><div class="family-header"><h2>${familyLabel}</h2><p>${breakdown}${worldRole}${structureType}${suitability}</p>${uses ? `<p class="family-uses">${uses}</p>` : ""}</div><div class="family-assets">
`;
          }
          if (asset.isImage) {
            const canon = asset.canonicalName ? `<div class="canonical">${asset.canonicalName}</div>` : "";
            html += `<div class="card" data-role="${asset.assetRole ?? "none"}" data-world="${asset.worldRole ?? "UNASSIGNED"}" data-runtime="${asset.runtimeStatus}"><img loading="lazy" src="${asset.imageUrl}" alt="${asset.filename}"><div class="filename">${asset.filename}${canon}</div><div class="path">${asset.path}</div><div class="meta"><span>${asset.id}</span>${asset.width && asset.height ? `<span>${asset.width}×${asset.height}</span>` : ""}${asset.assetRole ? `<span>${asset.assetRole}</span>` : ""}${badgeRuntime(asset.runtimeStatus)}${badgeReview(asset.review.status)}</div></div>
`;
          } else {
            html += `<div class="card" data-role="${asset.assetRole ?? "none"}"><div style="height:250px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#666">${asset.extension}</div><div class="filename">${asset.filename}</div><div class="path">${asset.path}</div><div class="meta"><span>${asset.id}</span><span>${asset.category}</span></div></div>
`;
          }
        }
        html += `</div></section></div>
<script>
(function () {
  var families = document.querySelectorAll("section.family");
  // Collapse/expand
  families.forEach(function (sec) {
    var btn = sec.querySelector(".family-toggle");
    var body = sec.querySelector(".family-assets");
    btn.addEventListener("click", function () {
      var open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      btn.setAttribute("aria-expanded", String(!open));
      btn.querySelector(".family-caret").textContent = open ? "▸" : "▾";
    });
  });
  // Filters
  var checks = document.querySelectorAll(".filter-check");
  var clearBtn = document.getElementById("filter-clear");
  function active(f, v) {
    return Array.prototype.some.call(checks, function (ch) {
      return ch.dataset.f === f && (!v || ch.dataset.v === v) && ch.checked;
    });
  }
  function applyFilters() {
    var placeable = active("placeable");
    var cards = document.querySelectorAll(".card");
    var visibleCount = 0;
    cards.forEach(function (card) {
      var show = true;
      if (placeable && card.dataset.role !== "complete") show = false;
      if (show && active("role") && !active("role", card.dataset.role)) show = false;
      if (show && active("world") && !active("world", card.dataset.world)) show = false;
      if (show && active("runtime") && !active("runtime", card.dataset.runtime)) show = false;
      card.style.display = show ? "" : "none";
      if (show) visibleCount += 1;
    });
    // Auto-expand families that still have visible cards; keep manual state otherwise
    families.forEach(function (sec) {
      var body = sec.querySelector(".family-assets");
      if (body.dataset.userCollapsed === "1") return;
      var visible = Array.prototype.some.call(sec.querySelectorAll(".card"), function (c) {
        return c.style.display !== "none";
      });
      body.style.display = visible ? "" : "none";
      sec.querySelector(".family-caret").textContent = visible ? "▾" : "▸";
    });
    var note = document.getElementById("filter-note");
    if (note) note.textContent = visibleCount < cards.length ? "Showing " + visibleCount + " of " + cards.length + " assets" : "";
  }
  checks.forEach(function (ch) { ch.addEventListener("change", applyFilters); });
  if (clearBtn) clearBtn.addEventListener("click", function () { checks.forEach(function (ch) { ch.checked = false; }); applyFilters(); });
  // Track manual collapse state so filters don't override the user
  families.forEach(function (sec) {
    var btn = sec.querySelector(".family-toggle");
    btn.addEventListener("click", function () {
      var body = sec.querySelector(".family-assets");
      var open = body.style.display !== "none";
      if (open) body.dataset.userCollapsed = "1"; else delete body.dataset.userCollapsed;
    });
  });
})();
</script></body></html>
`;
        await writeFile(join(packDir, `${cat}.html`), html, "utf8");
