#!/usr/bin/env node
/**
 * Generates a complete static API for the Asset Catalog.
 * All files are plain JSON/HTML served directly by Apache.
 *
 * Output structure:
 *   api/
 *     packs.json                    — pack list with counts
 *     assets/{pack}.json            — all assets in a pack
 *     assets/{pack}/{category}.json — filtered by pack + category
 *     assets/{pack}/page-{n}.json   — paginated (50 per page)
 *     asset/{id}.json               — individual asset detail
 *     families.json                 — grouped family taxonomy (building_1..18)
 *   review/{pack}/{category}.html   — consolidated audit pages (one per category)
 *   contact-sheets/                 — pack-level visual grids
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const deployDir = join(root, "deploy", "asset-catalog");
const PAGE_SIZE = 50;

// Audit status for cataloged categories — keeps the review index and the catalog
// homepage useful at a glance.
// key = pack + '|' + category. Values: { label, tone } where tone in ok/warn/todo.
const AUDIT_STATUS = {
  "CloverVillage|building": { label: "COMPLETE · PRODUCTION READY", tone: "ok" },
  "CloverVillage|ground": { label: "COMPLETE · TOPOLOGY VERIFIED", tone: "ok" },
  "CloverVillage|decor": { label: "COMPLETE", tone: "ok" },
  "CloverVillage|road": { label: "CATALOG COMPLETE · KIT INCOMPLETE (5 tiles)", tone: "warn" },
  "CloverVillage|npc": { label: "CLASSIFIED · 3 IDENTITIES / 5 ANIMATIONS", tone: "ok" },
  "CloverVillage|other": { label: "COMPLETE · SOURCE MASTERS ONLY", tone: "ok" },
  "Classes-Archer|class": { label: "COMPLETE · 6 FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
  "Classes-Mage|class": { label: "COMPLETE · 6 FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
  "Classes-Warrior|class": { label: "COMPLETE · 6 FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
  "HappyValley|other": { label: "COMPLETE · 12 FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
  "HappyValley|monster": { label: "COMPLETE · 5 IDENTITIES / 4 FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
  "HappyValley|npc": { label: "COMPLETE · 3 IDENTITIES / 5 FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
  "VoidDesert|nature": { label: "COMPLETE · 6 NATURE FAMILIES / 0 UNCLASSIFIED", tone: "ok" },
};

function stableId(filePath) {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 12);
}

function categoryFromPath(path) {
  const s = path.replace(/^\/?reference\/assets\//, "");
  if (/land\//.test(s)) return "ground";
  if (/road\//.test(s)) return "road";
  if (/buildings?\//.test(s)) return "building";
  if (/decor\//.test(s)) return "decor";
  if (/NPC\//i.test(s)) return "npc";
  if (/Mob\//.test(s)) return "monster";
  if (/Classes\//.test(s)) return "class";
  if (/AttackEffects?\//.test(s)) return "effect";
  if (/Idle\//.test(s)) return "character";
  if (/Paths?\//.test(s)) return "path-composite";
  if (/Greenery|stones|tree/.test(s)) return "nature";
  return "other";
}

function packFromPath(path) {
  const s = path.replace(/^\/?reference\/assets\//, "");
  const parts = s.split("/");
  if (parts[0] === "maps" && parts[1]) return parts[1];
  if (parts[0] === "Classes" && parts[1]) return `Classes-${parts[1]}`;
  return parts[0] ?? "unknown";
}

function isImage(ext) {
  return [".png", ".gif", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext);
}

// Family name for an asset path (parent folder), e.g. building_10
function familyOf(path) {
  return path.split("/").slice(0, -1).pop() ?? "misc";
}

function buildNpcIdentityStrip(assets) {
  const identities = [
    { id: "artist", label: "Artist", desc: "Hooded artisan identity — owns greeting/idle/walk/communication/idle_blink render sets." },
    { id: "astrologer", label: "Astrologer", desc: "Hooded, bearded identity — owns greeting/idle/walk/communication/idle_blink render sets." },
    { id: "citizen", label: "Citizen", desc: "Villager identity — owns greeting/idle/walk/communication/idle_blink render sets." },
  ];
  const cards = identities.map((id) => {
    // representative frame: runtime-confirmed idle front frame for this NPC
    const rep = assets.find((a) => a.npcId === id.id && a.animation === "idle" && a.direction === "front" && a.runtimeStatus === "runtime-used")
      ?? assets.find((a) => a.npcId === id.id && a.animation === "idle" && a.direction === "front");
    const img = rep ? `<img src="${rep.imageUrl}" alt="${id.label}" title="${rep.canonicalName ?? rep.filename}">` : "";
    const animCounts = {};
    for (const a of assets) if (a.npcId === id.id && a.animation) animCounts[a.animation] = (animCounts[a.animation] || 0) + 1;
    const animList = Object.entries(animCounts).map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(" · ");
    return `<div class="identity-card">${img}<div class="identity-body"><div class="identity-name">${id.label}</div><div class="identity-id">npc_clover_${id.id}</div><div class="identity-desc">${id.desc}</div><div class="identity-anims">${animList}</div></div></div>`;
  });
  return `<div class="identity-strip"><h2 class="identity-heading">NPC Characters — 3 identities</h2><div class="identity-grid">${cards.join("")}</div></div>`;
}

function buildHvNpcIdentityStrip(assets) {
  const identities = [
    { id: "blacksmith", label: "Blacksmith", desc: "Profession NPC — 7 expressive animation states (chagrin, communication, greeting, greeting_2, idle, idle_blink, joy)." },
    { id: "jeweler", label: "Jeweler", desc: "Profession NPC — 7 expressive animation states. Gems prop exists as EPS authoring source." },
    { id: "sage", label: "Sage", desc: "Profession NPC — 7 expressive animation states. Stick + shield props." },
  ];
  const cards = identities.map((id) => {
    // representative frame: first idle frame for this NPC
    const rep = assets.find((a) => a.npcId === id.id && a.animation === "idle")
      ?? assets.find((a) => a.npcId === id.id && a.assetRole === "animation-frame");
    const img = rep ? `<img src="${rep.imageUrl}" alt="${id.label}" title="${rep.canonicalName ?? rep.filename}">` : "";
    const animCounts = {};
    for (const a of assets) if (a.npcId === id.id && a.animation) animCounts[a.animation] = (animCounts[a.animation] || 0) + 1;
    const animList = Object.entries(animCounts).map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(" · ");
    return `<div class="identity-card">${img}<div class="identity-body"><div class="identity-name">${id.label}</div><div class="identity-id">npc_happyvalley_${id.id}</div><div class="identity-desc">${id.desc}</div><div class="identity-anims">${animList}</div></div></div>`;
  });
  return `<div class="identity-strip"><h2 class="identity-heading">NPC Characters — 3 identities (frontal expressive package)</h2><div class="identity-grid">${cards.join("")}</div></div>`;
}

function badgeRuntime(status) {
  return status === "runtime-used"
    ? '<span class="runtime">Runtime</span>'
    : '<span class="reference">Reference</span>';
}

function badgeReview(status) {
  return status === "confirmed"
    ? '<span class="confirmed">Confirmed</span>'
    : status === "reviewed"
    ? '<span class="confirmed">Reviewed</span>'
    : '<span class="unreviewed">Unreviewed</span>';
}

function lightweight(asset) {
  const base = {
    id: asset.id,
    filename: asset.filename,
    path: asset.path,
    imageUrl: asset.imageUrl,
    pack: asset.pack,
    category: asset.category,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    isImage: asset.isImage,
    runtimeStatus: asset.runtimeStatus,
    reviewStatus: asset.review.status,
    description: asset.review.description || "",
    suggestedFilename: asset.review.suggestedName || "",
  };
  if (asset.assetRole) base.assetRole = asset.assetRole;
  if (asset.buildingFamily) base.buildingFamily = asset.buildingFamily;
  if (asset.canonicalFamily) base.canonicalFamily = asset.canonicalFamily;
  if (asset.suggestedFamilyName) base.suggestedFamilyName = asset.suggestedFamilyName;
  if (asset.structureType) base.structureType = asset.structureType;
  if (asset.worldRole) base.worldRole = asset.worldRole;
  if (asset.suitability) base.suitability = asset.suitability;
  if (asset.collision) base.collision = asset.collision;
  if (asset.gameplayRole) base.gameplayRole = asset.gameplayRole;
  if (asset.recommendedUses?.length) base.recommendedUses = asset.recommendedUses;
  if (asset.recommendedUse) base.recommendedUse = asset.recommendedUse;
  if (asset.renameStatus) base.renameStatus = asset.renameStatus;
  if (asset.reviewConfidence) base.reviewConfidence = asset.reviewConfidence;
  if (asset.catalogCategory) base.catalogCategory = asset.catalogCategory;
  if (asset.notes) base.notes = asset.notes;
  if (asset.canonicalName) base.canonicalName = asset.canonicalName;
  if (asset.displayName) base.displayName = asset.displayName;
  if (asset.roadRole) base.roadRole = asset.roadRole;
  if (asset.candidateRole) base.candidateRole = asset.candidateRole;
  if (asset.roadType) base.roadType = asset.roadType;
  if (asset.surfaceType) base.surfaceType = asset.surfaceType;
  if (asset.terrainRole) base.terrainRole = asset.terrainRole;
  if (asset.tileMode) base.tileMode = asset.tileMode;
  if (asset.variant) base.variant = asset.variant;
  if (asset.decorRole) base.decorRole = asset.decorRole;
  if (asset.placementMode) base.placementMode = asset.placementMode;
  if (asset.depthMode) base.depthMode = asset.depthMode;
  if (asset.density) base.density = asset.density;
  if (asset.anchor) base.anchor = asset.anchor;
  if (asset.subtype) base.subtype = asset.subtype;
  if (asset.topology) base.topology = asset.topology;
  if (asset.envFamilyType) base.envFamilyType = asset.envFamilyType;
  if (asset.envRole) base.envRole = asset.envRole;
  if (asset.treeRole) base.treeRole = asset.treeRole;
  if (asset.objectRole) base.objectRole = asset.objectRole;
  if (asset.orientation) base.orientation = asset.orientation;
  if (asset.size) base.size = asset.size;
  if (asset.monsterFamilyType) base.monsterFamilyType = asset.monsterFamilyType;
  if (asset.monsterId) base.monsterId = asset.monsterId;
  if (asset.shadowMode) base.shadowMode = asset.shadowMode;
  if (asset.duplicateOf) base.duplicateOf = asset.duplicateOf;
  if (asset.catalogVisible !== undefined) base.catalogVisible = asset.catalogVisible;
  if (asset.npcPackage) base.npcPackage = asset.npcPackage;
  if (asset.hvNpcFamilyType) base.hvNpcFamilyType = asset.hvNpcFamilyType;
  if (asset.npcFamilyType) base.npcFamilyType = asset.npcFamilyType;
  if (asset.npcId) base.npcId = asset.npcId;
  if (asset.npcPackage) base.npcPackage = asset.npcPackage;
  if (asset.classId) base.classId = asset.classId;
  if (asset.classFamilyType) base.classFamilyType = asset.classFamilyType;
  if (asset.effect) base.effect = asset.effect;
  if (asset.element) base.element = asset.element;
  if (asset.effectType) base.effectType = asset.effectType;
  if (asset.shape) base.shape = asset.shape;
  if (asset.effectVariant) base.effectVariant = asset.effectVariant;
  if (asset.sourceOf) base.sourceOf = asset.sourceOf;
  if (asset.animation) base.animation = asset.animation;
  if (asset.frame !== null && asset.frame !== undefined) base.frame = asset.frame;
  if (asset.frameCount) base.frameCount = asset.frameCount;
  if (asset.bodyPart) base.bodyPart = asset.bodyPart;
  if (asset.side) base.side = asset.side;
  if (asset.renderMode) base.renderMode = asset.renderMode;
  if (asset.placeable !== undefined) base.placeable = asset.placeable;
  if (asset.sourceRole) base.sourceRole = asset.sourceRole;
  if (asset.format) base.format = asset.format;
  if (asset.runtimeEligible !== undefined) base.runtimeEligible = asset.runtimeEligible;
  if (asset.uiAsset) base.uiAsset = asset.uiAsset;
  if (asset.envFamilyType) base.envFamilyType = asset.envFamilyType;
  if (asset.envRole) base.envRole = asset.envRole;
  if (asset.treeRole) base.treeRole = asset.treeRole;
  if (asset.objectRole) base.objectRole = asset.objectRole;
  if (asset.orientation) base.orientation = asset.orientation;
  if (asset.size) base.size = asset.size;
  if (asset.monsterFamilyType) base.monsterFamilyType = asset.monsterFamilyType;
  if (asset.monsterId) base.monsterId = asset.monsterId;
  if (asset.shadowMode) base.shadowMode = asset.shadowMode;
  if (asset.duplicateOf) base.duplicateOf = asset.duplicateOf;
  if (asset.catalogVisible !== undefined) base.catalogVisible = asset.catalogVisible;
  if (asset.sharedVisual !== undefined) base.sharedVisual = asset.sharedVisual;
  if (asset.walkable !== undefined) base.walkable = asset.walkable;
  if (asset.natureFamilyType) base.natureFamilyType = asset.natureFamilyType;
  if (asset.natureRole) base.natureRole = asset.natureRole;
  if (asset.formationType) base.formationType = asset.formationType;
  if (asset.material) base.material = asset.material;
  if (asset.scaleClass) base.scaleClass = asset.scaleClass;
  if (asset.occlusion !== undefined) base.occlusion = asset.occlusion;
  if (asset.treeType) base.treeType = asset.treeType;
  return base;
}

async function writeJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function build() {
  console.log("Generating static API...");

  const INVENTORY = JSON.parse(await readFile(join(root, "design", "assets", "asset-inventory.json"), "utf8"));
  console.log(`  ${INVENTORY.summary.files} files from inventory`);

  // Load review data if available
  let REVIEWS = {};
  try {
    const reviewData = JSON.parse(await readFile(join(root, "design", "assets", "asset-reviews.json"), "utf8"));
    for (const [familyKey, family] of Object.entries(reviewData.reviews ?? {})) {
      for (const [assetPath, review] of Object.entries(family.assets ?? {})) {
        const merged = { ...review, buildingFamily: family.buildingFamily, canonicalFamily: family.canonicalFamily, suggestedFamilyName: family.suggestedFamilyName, structureType: family.structureType, worldRole: family.worldRole, suitability: family.suitability, collision: family.collision, gameplayRole: family.gameplayRole, recommendedUse: family.recommendedUse, recommendedUses: family.recommendedUses, notes: family.notes, catalogCategory: family.catalogCategory, roadType: family.roadType, terrainRole: review.terrainRole ?? family.terrainRole, tileMode: family.tileMode, decorRole: review.decorRole ?? family.decorRole, placementMode: review.placementMode ?? family.placementMode, topology: review.topology ?? family.topology, variant: review.variant ?? null, collision: review.collision ?? family.collision, depthMode: review.depthMode ?? family.depthMode, density: review.density ?? family.density, anchor: review.anchor ?? family.anchor, npcFamilyType: family.npcFamilyType, npcId: review.npcId ?? null, npcPackage: review.npcPackage ?? null, classId: review.classId ?? family.classId ?? null, classFamilyType: family.classFamilyType ?? null, effect: review.effect ?? null, element: review.element ?? null, effectType: review.effectType ?? null, shape: review.shape ?? null, effectVariant: review.effectVariant ?? null, sourceOf: review.sourceOf ?? null, animation: review.animation ?? null, direction: review.direction ?? null, frame: review.frame ?? null, frameCount: review.frameCount ?? null, bodyPart: review.bodyPart ?? null, side: review.side ?? null, renderMode: review.renderMode ?? null, placeable: review.placeable ?? true, sourceRole: review.sourceRole ?? null, format: review.format ?? null, runtimeEligible: review.runtimeEligible ?? null, uiAsset: review.uiAsset ?? null, sharedVisual: review.sharedVisual ?? null, walkable: family.walkable, envFamilyType: family.envFamilyType, envRole: review.envRole ?? null, treeRole: review.treeRole ?? null, objectRole: review.objectRole ?? null, orientation: review.orientation ?? null, size: review.size ?? null, monsterFamilyType: family.monsterFamilyType, monsterId: review.monsterId ?? null, shadowMode: review.shadowMode ?? null, duplicateOf: review.duplicateOf ?? null, catalogVisible: review.catalogVisible ?? true, hvNpcFamilyType: family.hvNpcFamilyType, natureFamilyType: family.natureFamilyType ?? null, natureRole: review.natureRole ?? null, formationType: review.formationType ?? null, material: review.material ?? null, scaleClass: review.scaleClass ?? null, occlusion: review.occlusion ?? null, treeType: review.treeType ?? null, status: family.status, catalogStatus: family.catalogStatus, topologyStatus: family.topologyStatus, kitStatus: family.kitStatus, recoveryStatus: family.recoveryStatus, runtimeReady: family.runtimeReady, artRequired: family.artRequired, artTask: family.artTask, recovery: family.recovery };
        // Normalize review runtime status to inventory-style values used by badges/filters
        if (merged.runtimeStatus === "runtime") merged.runtimeStatus = "runtime-used";
        if (merged.runtimeStatus === "reference") merged.runtimeStatus = "reference-only";
        REVIEWS[assetPath] = merged;
      }
    }
    console.log(`  ${Object.keys(REVIEWS).length} reviewed assets loaded`);
  } catch (error) {
    console.warn(`  No review data: ${error.message}`);
  }

  // Helper: find review for an asset path
  function findReview(filePath) {
    if (REVIEWS[filePath]) return REVIEWS[filePath];
    for (const [key, review] of Object.entries(REVIEWS)) {
      if (filePath.endsWith(key)) return review;
    }
    return null;
  }

  const BASE_URL = "https://pawsandparcels.agpstudios.org";

  // Build full asset list
  const assets = INVENTORY.files.map((file) => {
    const ext = file.extension || "";
    const urlPath = posix.join("reference", "assets", file.path.replace(/^\/?reference\/assets\//, ""));
    return {
      id: stableId(file.path),
      filename: file.path.split("/").pop(),
      path: file.path,
      imageUrl: `${BASE_URL}/${urlPath}`,
      pack: packFromPath(file.path),
      category: categoryFromPath(file.path),
      extension: ext,
      width: file.width ?? null,
      height: file.height ?? null,
      bytes: file.bytes,
      isImage: isImage(ext),
      runtimeStatus: file.status,
      usedBy: file.usedBy ?? null,
      ...(findReview(file.path) ?? {}),
      review: {
        status: findReview(file.path) ? "reviewed" : (file.status === "runtime-used" ? "confirmed" : "unreviewed"),
        suggestedName: findReview(file.path)?.canonicalName ?? "",
        description: findReview(file.path)?.description ?? "",
        notes: "",
      },
    };
  });

  // Group by pack
  const byPack = {};
  for (const a of assets) {
    if (!byPack[a.pack]) byPack[a.pack] = [];
    byPack[a.pack].push(a);
  }

  const apiDir = join(deployDir, "api");
  await mkdir(apiDir, { recursive: true });

  // --- packs.json ---
  const packList = Object.entries(byPack)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, packAssets]) => ({
      name,
      total: packAssets.length,
      images: packAssets.filter((a) => a.isImage).length,
      categories: [...new Set(packAssets.map((a) => a.category))].sort(),
    }));
  await writeJson(join(apiDir, "packs.json"), { packs: packList });
  console.log(`  api/packs.json: ${packList.length} packs`);

  // --- Per-pack full asset files ---
  const assetsDir = join(apiDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  for (const [packName, packAssets] of Object.entries(byPack)) {
    await writeJson(join(assetsDir, `${packName}.json`), {
      pack: packName,
      total: packAssets.length,
      assets: packAssets.map(lightweight),
    });

    const byCategory = {};
    for (const a of packAssets) {
      if (!byCategory[a.category]) byCategory[a.category] = [];
      byCategory[a.category].push(a);
    }
    const catDir = join(assetsDir, packName);
    await mkdir(catDir, { recursive: true });
    for (const [cat, catAssets] of Object.entries(byCategory)) {
      await writeJson(join(catDir, `${cat}.json`), {
        pack: packName,
        category: cat,
        total: catAssets.length,
        assets: catAssets.map(lightweight),
      });
    }

    const pages = Math.ceil(packAssets.length / PAGE_SIZE);
    for (let page = 0; page < pages; page++) {
      const slice = packAssets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      await writeJson(join(catDir, `page-${page + 1}.json`), {
        pack: packName,
        page: page + 1,
        pageSize: PAGE_SIZE,
        total: packAssets.length,
        totalPages: pages,
        assets: slice.map(lightweight),
      });
    }
    console.log(`  api/assets/${packName}: ${packAssets.length} assets, ${Object.keys(byCategory).length} categories, ${pages} pages`);
  }

  // --- Individual asset detail files ---
  const assetDir = join(apiDir, "asset");
  await mkdir(assetDir, { recursive: true });
  for (const a of assets) {
    await writeJson(join(assetDir, `${a.id}.json`), a);
  }
  console.log(`  api/asset/: ${assets.length} detail files`);

  // --- families.json: grouped family taxonomy (buildings + roads + ground + decor + npc) ---
  const familyKeyOf = (a) => (a.roadRole ? a.canonicalFamily : a.terrainRole ? a.canonicalFamily : a.decorRole ? a.canonicalFamily : a.npcId ? a.canonicalFamily : a.buildingFamily);
  const familyMap = new Map();
  for (const a of assets) {
    const k = familyKeyOf(a);
    if (!k) continue;
    if (!familyMap.has(k)) familyMap.set(k, []);
    familyMap.get(k).push(a);
  }
  const families = [...familyMap.entries()].map(([familyKey, famAssets]) => {
    const first = famAssets[0];
    const completes = famAssets.filter((a) => a.assetRole === "complete");
    const components = famAssets.filter((a) => a.assetRole === "component");
    const props = famAssets.filter((a) => a.assetRole === "prop");
    const roadRoles = {};
    for (const a of famAssets) if (a.roadRole) roadRoles[a.roadRole] = (roadRoles[a.roadRole] || 0) + 1;
    const family = {
      sourceFamily: familyKey,
      canonicalFamily: first.canonicalFamily ?? null,
      displayName: first.suggestedFamilyName ?? null,
      structureType: first.structureType ?? null,
      worldRole: first.worldRole ?? null,
      suitability: first.suitability ?? null,
      collision: first.collision ?? null,
      recommendedUses: first.recommendedUses ?? [],
      notes: first.notes ?? "",
      status: first.status ?? null,
      catalogStatus: first.catalogStatus ?? null,
      topologyStatus: first.topologyStatus ?? null,
      kitStatus: first.kitStatus ?? null,
      recoveryStatus: first.recoveryStatus ?? null,
      runtimeReady: first.runtimeReady ?? null,
      artRequired: first.artRequired ?? null,
      artTask: first.artTask ?? null,
      recovery: first.recovery ?? null,
      assetCount: famAssets.length,
      composition: { complete: completes.length, component: components.length, prop: props.length },
      completeAssets: completes.map((a) => ({ id: a.id, filename: a.filename, canonicalName: a.canonicalName ?? "", imageUrl: a.imageUrl, runtimeStatus: a.runtimeStatus })),
    };
    if (first.roadType) {
      family.roadType = first.roadType;
      family.surfaceType = first.surfaceType ?? null;
      family.topology = first.topology ?? null;
      family.walkable = first.walkable ?? null;
      family.roadRoles = roadRoles;
    }
    if (first.terrainRole) {
      family.terrainRole = first.terrainRole;
      family.tileMode = first.tileMode ?? null;
      family.topology = first.topology ?? null;
      family.walkable = first.walkable ?? null;
    }
    if (first.decorRole) {
      family.decorRole = first.decorRole;
      family.placementRole = first.placementRole ?? null;
      family.depthMode = first.depthMode ?? null;
      family.collision = first.collision ?? null;
    }
    if (first.npcFamilyType) {
      family.npcFamilyType = first.npcFamilyType;
      family.assetRoles = {};
      for (const a of famAssets) family.assetRoles[a.assetRole] = (family.assetRoles[a.assetRole] || 0) + 1;
    }
    return family;
  }).sort((a, b) => {
    const isRoadA = a.roadType != null;
    const isRoadB = b.roadType != null;
    const isGroundA = a.terrainRole != null;
    const isGroundB = b.terrainRole != null;
    const isDecorA = a.decorRole != null;
    const isDecorB = b.decorRole != null;
    const isNpcA = a.npcFamilyType != null;
    const isNpcB = b.npcFamilyType != null;
    if (isRoadA !== isRoadB) return isRoadA ? 1 : -1;
    if (isGroundA !== isGroundB) return isGroundA ? 1 : -1;
    if (isDecorA !== isDecorB) return isDecorA ? 1 : -1;
    if (isNpcA !== isNpcB) return isNpcA ? 1 : -1;
    if (isRoadA) return a.canonicalFamily.localeCompare(b.canonicalFamily);
    if (isGroundA) return a.canonicalFamily.localeCompare(b.canonicalFamily);
    if (isDecorA) return a.canonicalFamily.localeCompare(b.canonicalFamily);
    if (isNpcA) return a.canonicalFamily.localeCompare(b.canonicalFamily);
    const na = parseInt(a.sourceFamily.replace(/\D/g, "")) || 0;
    const nb = parseInt(b.sourceFamily.replace(/\D/g, "")) || 0;
    return na - nb;
  });
  const buildingCount = families.filter((f) => f.roadType == null && f.terrainRole == null && f.decorRole == null && f.npcFamilyType == null).length;
  const roadCount = families.filter((f) => f.roadType != null).length;
  const groundCount = families.filter((f) => f.terrainRole != null).length;
  const decorCount = families.filter((f) => f.decorRole != null).length;
  const npcCount = families.filter((f) => f.npcFamilyType != null).length;
  await writeJson(join(apiDir, "families.json"), {
    pack: "CloverVillage",
    category: "building + road + ground + decor + npc",
    familyCount: families.length,
    buildingFamilyCount: buildingCount,
    roadFamilyCount: roadCount,
    groundFamilyCount: groundCount,
    decorFamilyCount: decorCount,
    npcFamilyCount: npcCount,
    sourceAssetCount: families.reduce((sum, f) => sum + f.assetCount, 0),
    note: `${buildingCount} architectural families + ${roadCount} road families + ${groundCount} ground families + ${decorCount} decor families + ${npcCount} npc families. Families, not placeable assets.`,
    families,
  });
  console.log(`  api/families.json: ${families.length} families`);

  // --- Root assets.json (summary only) ---
  await writeJson(join(apiDir, "assets.json"), {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalAssets: assets.length,
    totalBytes: INVENTORY.summary.bytes,
    packs: packList,
    endpoints: {
      packs: "/asset-catalog/api/packs.json",
      byPack: "/asset-catalog/api/assets/{pack}.json",
      byPackCategory: "/asset-catalog/api/assets/{pack}/{category}.json",
      paginated: "/asset-catalog/api/assets/{pack}/page-{n}.json",
      assetDetail: "/asset-catalog/api/asset/{id}.json",
      families: "/asset-catalog/api/families.json",
    },
    auditStatus: AUDIT_STATUS,
  });
  console.log(`  api/assets.json: ${assets.length} assets`);

  // --- api/assets.js: full browse payload (used by the catalog homepage).
  // Written as .js to bypass any Apache .json block; sets window.ASSETS_DATA. ---
  const browsePayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalAssets: assets.length,
    totalBytes: INVENTORY.summary.bytes,
    packs: packList,
    categories: [...new Set(assets.map((a) => a.category))].sort(),
    assetCount: assets.length,
    assets: assets.map(lightweight),
    auditStatus: AUDIT_STATUS,
  };
  await writeFile(join(apiDir, "assets.js"), `window.ASSETS_DATA = ${JSON.stringify(browsePayload)};\n`, "utf8");
  console.log(`  api/assets.js: ${browsePayload.assets.length} assets (full browse payload)`);

  // --- Contact sheets ---
  console.log("  Generating contact sheets...");
  const contactDir = join(deployDir, "contact-sheets");
  await mkdir(contactDir, { recursive: true });

  let indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Asset Contact Sheets</title>
<style>
  body { font-family: system-ui; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #263228; background: #f3f7f1; }
  h1 { font-size: 1.5rem; }
  .pack-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
  .pack-card { background: #fff; border: 1px solid #d9e3d7; border-radius: 8px; padding: 1rem; text-decoration: none; color: inherit; }
  .pack-card:hover { border-color: #456b4e; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .pack-card h2 { font-size: 1rem; margin: 0 0 0.5rem; }
  .pack-card .count { color: #68766b; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Asset Contact Sheets</h1>
<div class="pack-grid">
`;
  for (const pack of packList) {
    indexHtml += `<a class="pack-card" href="${pack.name}.html"><h2>${pack.name}</h2><p class="count">${pack.total} files, ${pack.images} images</p></a>\n`;
  }
  indexHtml += `</div></body></html>`;
  await writeFile(join(contactDir, "index.html"), indexHtml, "utf8");

  for (const [packName, packAssets] of Object.entries(byPack)) {
    const pages = Math.ceil(packAssets.length / PAGE_SIZE);
    for (let page = 0; page < pages; page++) {
      const slice = packAssets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const label = pages > 1 ? ` (page ${page + 1}/${pages})` : "";
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${packName} Contact Sheet${label}</title>
<style>
  body { font-family: system-ui; max-width: 1400px; margin: 1rem auto; padding: 0 1rem; color: #263228; background: #f3f7f1; }
  h1 { font-size: 1.3rem; }
  nav { margin-bottom: 1rem; }
  nav a { color: #456b4e; margin-right: 1rem; }
  .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
  .card { background: #fff; border: 1px solid #d9e3d7; border-radius: 6px; padding: 0.5rem; text-align: center; }
  .card img { max-width: 120px; max-height: 120px; object-fit: contain; display: block; margin: 0 auto 0.5rem; background: repeating-conic-gradient(#e8ede6 0% 25%, #fff 0% 50%) 50%/16px 16px; border-radius: 4px; }
  .card .name { font-size: 0.7rem; word-break: break-all; }
  .card .id { font-size: 0.6rem; color: #999; font-family: monospace; }
  .card .meta { font-size: 0.65rem; color: #68766b; margin-top: 0.25rem; }
  .non-image { background: #f0f0f0; display: flex; align-items: center; justify-content: center; height: 120px; font-size: 0.7rem; color: #666; }
  .pagination { margin-top: 1.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .pagination a, .pagination span { padding: 0.3rem 0.7rem; border-radius: 4px; font-size: 0.85rem; text-decoration: none; color: #263228; background: #fff; border: 1px solid #d9e3d7; }
  .pagination .current { background: #456b4e; color: #fff; border-color: #456b4e; }
</style>
</head>
<body>
<nav><a href="index.html">← All Packs</a> ${pages > 1 ? Array.from({length: pages}, (_, i) => i === page ? `<span class="current">${i + 1}</span>` : `<a href="${packName}-${i + 1}.html">${i + 1}</a>`).join(" ") : ""}</nav>
<h1>${packName} — ${packAssets.length} assets${label}</h1>
<div class="sheet">
`;
      for (const asset of slice) {
        if (asset.isImage) {
          html += `<div class="card"><img loading="lazy" src="${asset.imageUrl}" alt="${asset.filename}"><div class="name">${asset.filename}</div><div class="id">${asset.id}</div><div class="meta">${asset.width && asset.height ? `${asset.width}×${asset.height}` : ""} · ${asset.category}</div></div>\n`;
        } else {
          html += `<div class="card"><div class="non-image">${asset.extension}</div><div class="name">${asset.filename}</div><div class="id">${asset.id}</div><div class="meta">${asset.category}</div></div>\n`;
        }
      }
      html += `</div></body></html>`;
      const fname = pages > 1 ? `${packName}-${page + 1}.html` : `${packName}.html`;
      await writeFile(join(contactDir, fname), html, "utf8");
    }
  }
  console.log(`  contact-sheets/: ${Object.keys(byPack).length} pack pages`);

  // --- Review pages: one consolidated page per category with filters ---
  console.log("  Generating review pages...");
  const reviewDir = join(deployDir, "review");
  await mkdir(reviewDir, { recursive: true });

  // GitHub-style audit progress strip per pack — same look as the catalog homepage.
  const packRows = [];
  let totalCategories = 0;
  for (const [packName, packAssets] of Object.entries(byPack).sort(([a], [b]) => a.localeCompare(b))) {
    const categories = [...new Set(packAssets.map((a) => a.category))].sort();
    totalCategories += categories.length;
    const locked = categories.filter((cat) => AUDIT_STATUS[`${packName}|${cat}`]).length;
    const pct = categories.length === 0 ? 0 : Math.round((locked / categories.length) * 100);
    packRows.push(`<div class="progress-pack" title="${packName} — ${locked} of ${categories.length} categories audited">
    <span class="pack-name">${packName}</span>
    <div class="progress-track"><div class="progress-fill${locked > 0 && locked === categories.length ? " done" : ""}" style="width:${pct}%" aria-label="${locked} of ${categories.length} audited"></div></div>
    <span class="progress-count">${locked}/${categories.length}</span>
  </div>`);
  }
  const progressStrip = `<section class="audit-progress">
  <div class="audit-progress-head">
    <h2>Audit progress</h2>
    <span class="audit-progress-summary">${Object.keys(AUDIT_STATUS).length} of ${totalCategories} categories locked across ${Object.keys(byPack).length} packs</span>
  </div>
  <div class="audit-progress-bars">
  ${packRows.join("\n")}
  </div>
</section>`;

  let reviewIndex = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Asset Review Pages</title>
<style>
  body { font-family: system-ui; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #263228; background: #f3f7f1; }
  h1 { font-size: 1.5rem; }
  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin-top: 1rem; }
  .cat-card { background: #fff; border: 1px solid #d9e3d7; border-radius: 8px; padding: 1rem; text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 0.35rem; }
  .cat-card:hover { border-color: #456b4e; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .cat-card h2 { font-size: 1rem; margin: 0; }
  .cat-card .pack { color: #68766b; font-size: 0.85rem; }
  .cat-card .status { align-self: flex-start; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.03em; }
  .cat-card .status.ok { background: #e8f5e9; color: #1b5e20; border: 1px solid #a5d6a7; }
  .cat-card .status.warn { background: #fff3e0; color: #e65100; border: 1px solid #ffcc80; }
  .cat-card .status.todo { background: #f5f5f5; color: #757575; border: 1px solid #e0e0e0; }
  .audit-progress { margin-bottom: 1rem; }
  .audit-progress-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px; }
  .audit-progress-head h2 { font-size: 1.1rem; margin: 0; }
  .audit-progress-summary { color: #68766b; font-size: 0.85rem; }
  .audit-progress-bars { display: grid; gap: 10px; padding: 14px 16px; background: #fff; border: 1px solid #d9e3d7; border-radius: 10px; box-shadow: 0 4px 18px rgba(41,68,42,0.05); }
  .progress-pack { display: grid; grid-template-columns: 150px 1fr 52px; align-items: center; gap: 12px; }
  .pack-name { font-weight: 700; font-size: 0.85rem; color: #2e5037; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .progress-track { height: 10px; border-radius: 999px; background: #e3eae1; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #6a9e70, #93c39a); }
  .progress-fill.done { background: linear-gradient(90deg, #2e7d32, #66bb6a); }
  .progress-count { text-align: right; font-size: 0.78rem; font-weight: 800; color: #68766b; }
</style>
</head>
<body>
<h1>Asset Review Pages</h1>
<p>Per-category visual audit pages. Each category is one page; families are shown whole.</p>
${progressStrip}
<div class="cat-grid">
`;

  for (const [packName, packAssets] of Object.entries(byPack).sort()) {
    const byCat = {};
    for (const a of packAssets) {
      if (!byCat[a.category]) byCat[a.category] = [];
      byCat[a.category].push(a);
    }
    for (const [cat, catAssets] of Object.entries(byCat).sort()) {
      const href = `${packName}/${cat}.html`;
      const status = AUDIT_STATUS[`${packName}|${cat}`];
      const statusHtml = status
        ? `<span class="status ${status.tone}">${status.label}</span>`
        : `<span class="status todo">NOT AUDITED</span>`;
      reviewIndex += `<a class="cat-card" href="${href}"><h2>${cat}</h2><p class="pack">${packName} · ${catAssets.length} assets</p>${statusHtml}</a>\n`;
    }
  }
  reviewIndex += `</div></body></html>`;
  await writeFile(join(reviewDir, "index.html"), reviewIndex, "utf8");

  // Per-category review pages
  for (const [packName, packAssets] of Object.entries(byPack)) {
    const packDir = join(reviewDir, packName);
    await mkdir(packDir, { recursive: true });
    const byCat = {};
    for (const a of packAssets) {
      if (!byCat[a.category]) byCat[a.category] = [];
      byCat[a.category].push(a);
    }
    for (const [cat, catAssets] of Object.entries(byCat)) {
      const isRoad = catAssets.some((a) => a.roadRole);
      const isGround = catAssets.some((a) => a.terrainRole);
      const isDecor = catAssets.some((a) => a.decorRole);
      const isNpc = catAssets.some((a) => a.npcId && a.npcPackage !== "happyvalley");
      const isHvNpc = catAssets.some((a) => a.npcPackage === "happyvalley");
      const isClass = catAssets.some((a) => a.classId);
      const isEnv = catAssets.some((a) => a.envFamilyType);
      const isMonster = catAssets.some((a) => a.monsterFamilyType);
      const isNature = catAssets.some((a) => a.natureFamilyType);
      const isSource = catAssets.some((a) => a.assetRole === "authoring-source" || a.assetRole === "documentation");
      const familyKeyOf = (a) => (a.buildingFamily ? a.buildingFamily : a.envFamilyType ? a.canonicalFamily : a.monsterFamilyType ? a.canonicalFamily : a.natureFamilyType ? a.canonicalFamily : a.npcPackage === "happyvalley" ? a.canonicalFamily : a.roadRole ? a.canonicalFamily : a.terrainRole ? a.canonicalFamily : a.decorRole ? a.canonicalFamily : a.npcId ? a.canonicalFamily : a.classId ? a.canonicalFamily : (a.assetRole === "authoring-source" || a.assetRole === "documentation") ? a.canonicalFamily : null) || familyOf(a.path);
      const familyMap = new Map();
      for (const a of catAssets) {
        const f = familyKeyOf(a);
        if (!familyMap.has(f)) familyMap.set(f, []);
        familyMap.get(f).push(a);
      }

      // Summary counts
      const familiesOnPage = [...new Set(catAssets.map(familyKeyOf))];
      const completes = catAssets.filter((a) => a.assetRole === "complete").length;
      const components = catAssets.filter((a) => a.assetRole === "component").length;
      const props = catAssets.filter((a) => a.assetRole === "prop").length;
      const others = catAssets.length - completes - components - props;
      let summaryBar;
      if (isEnv) {
        const envFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const gameFams = new Set(catAssets.filter((a) => a.envFamilyType !== "source").map((a) => a.canonicalFamily).filter(Boolean));
        const terrainTiles = catAssets.filter((a) => a.assetRole === "terrain-tile").length;
        const terrainEps = catAssets.filter((a) => a.assetRole === "authoring-source" && a.envFamilyType === "terrain").length;
        const propCount = catAssets.filter((a) => a.envFamilyType !== "terrain" && a.envFamilyType !== "source" && a.assetRole !== "authoring-source").length;
        const sourceCount = catAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "authoring-master").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        const famParts = [...gameFams].map((f) => {
          const famAssets = catAssets.filter((a) => a.canonicalFamily === f);
          const famName = (famAssets.find((a) => a.canonicalFamily === f)?.suggestedFamilyName ?? f).replace(/\s*\(.*$/, "");
          return `${famAssets.filter((a) => a.assetRole !== "authoring-source").length} ${famName}`;
        });
        summaryBar = `<div class="summary-bar">${catAssets.length} source records · ${gameFams.size} semantic families · ${terrainTiles} terrain tiles + ${terrainEps} EPS · ${propCount} props/structures · ${sourceCount} source/support · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount} · 0 unclassified</div>`;
        summaryBar += `<div class="summary-bar env-note">🌳 HappyValley environment kit — ${gameFams.size} gameplay families + 1 source family (${[...envFams].filter((f) => f !== "happyvalley_source").length} PNG families). Terrain per-tile compass roles marked needs-verification until an alpha-silhouette pass; the 4 base tiles (Ground 14/23 dirt, 43/52 grass) are confirmed.</div>`;
      } else if (isRoad) {
        const roadFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const autotileFams = new Set(catAssets.filter((a) => a.roadType === "autotile").map((a) => a.canonicalFamily).filter(Boolean));
        const seamlessFams = new Set(catAssets.filter((a) => a.roadType === "seamless-texture").map((a) => a.canonicalFamily).filter(Boolean));
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        summaryBar = `<div class="summary-bar">${catAssets.length} source assets · ${roadFams.size} road families · ${autotileFams.size} autotile famil${autotileFams.size === 1 ? "y" : "ies"} · ${seamlessFams.size} seamless surface famil${seamlessFams.size === 1 ? "y" : "ies"} · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount}</div>`;
      } else if (isGround) {
        const groundFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const baseCount = catAssets.filter((a) => a.canonicalFamily === "clover_grass_base").length;
        const patchCount = catAssets.filter((a) => a.canonicalFamily === "clover_grass_patch").length;
        const edgeCount = catAssets.filter((a) => a.canonicalFamily === "clover_grass_edge").length;
        const cornerCount = catAssets.filter((a) => a.canonicalFamily === "clover_grass_corner").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        summaryBar = `<div class="summary-bar">${catAssets.length} source assets · ${groundFams.size} terrain families · ${baseCount} seamless base texture · ${patchCount} irregular patch · ${edgeCount} edge tile${edgeCount !== 1 ? "s" : ""} · ${cornerCount} corner/transition tile${cornerCount !== 1 ? "s" : ""} · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount}</div>`;
      } else if (isDecor) {
        const decorFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        const famParts = [...decorFams].map((f) => {
          const famAssets = catAssets.filter((a) => a.canonicalFamily === f);
          const famName = (famAssets.find((a) => a.canonicalFamily === f)?.suggestedFamilyName ?? f).replace(/\s*\(.*$/, "");
          return `${famAssets.length} ${famName}`;
        });
        summaryBar = `<div class="summary-bar">${catAssets.length} source assets · ${decorFams.size} semantic families · ${famParts.join(" · ")} · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount}</div>`;
      } else if (isHvNpc) {
        const npcFams = new Set(catAssets.filter((a) => a.hvNpcFamilyType !== "source").map((a) => a.canonicalFamily).filter(Boolean));
        const identities = ["blacksmith", "jeweler", "sage"];
        const frameCount = catAssets.filter((a) => a.assetRole === "animation-frame").length;
        const componentCount = catAssets.filter((a) => a.assetRole === "character-component" || a.assetRole === "animation-source").length;
        const propCount = catAssets.filter((a) => a.assetRole === "profession-prop").length;
        const uiCount = catAssets.filter((a) => a.assetRole === "dialogue-ui").length;
        const sourceCount = catAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "authoring-master").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        const animStates = [...new Set(catAssets.filter((a) => a.animation).map((a) => a.animation))].sort();
        summaryBar = `<div class="summary-bar">${catAssets.length} source records · ${identities.length} identities (${identities.join(", ")}) · ${npcFams.size} semantic families · ${frameCount} animation frames (${animStates.length} states × 3 NPCs × 30 · ${animStates.join(" + ")}) · ${componentCount} components · ${propCount} profession props · ${uiCount} dialogue UI · ${sourceCount} authoring/source · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount} · 0 unclassified</div>`;
        summaryBar += `<div class="summary-bar env-note">🗣 Frontal expressive/dialogue package — NOT a directional movement set (no front/back/side dirs in source). greeting_2 preserved as its own ID. popup PNGs logically deduped to ui_dialogue_bubble_small/large (identical sizes across NPCs). Nothing runtime-confirmed — stays reference.</div>`;
      } else if (isNpc) {
        const npcFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const frameCount = catAssets.filter((a) => a.assetRole === "animation-frame").length;
        const componentCount = catAssets.filter((a) => a.assetRole === "character-component").length;
        const uiCount = catAssets.filter((a) => a.assetRole === "dialogue-ui").length;
        const sourceCount = catAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "documentation").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        const animStates = [...new Set(catAssets.filter((a) => a.animation).map((a) => a.animation))].sort();
        const identityNames = ["artist", "astrologer", "citizen"];
        summaryBar = `<div class="summary-bar">${catAssets.length} source assets · ${npcFams.size} npc families · ${identityNames.length} identities (${identityNames.join(", ")}) · ${frameCount} animation frames (${animStates.join(" + ")}) · ${componentCount} components · ${uiCount} dialogue UI · ${sourceCount} authoring/doc · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount}</div>`;
      } else if (isClass) {
        const classFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const gameFams = new Set(catAssets.filter((a) => a.classFamilyType && a.classFamilyType !== "support").map((a) => a.canonicalFamily).filter(Boolean));
        const charFrames = catAssets.filter((a) => a.assetRole === "character-frame").length;
        const animFrames = catAssets.filter((a) => a.assetRole === "animation-frame").length;
        const effectFrames = catAssets.filter((a) => a.assetRole === "projectile-effect-frame" || a.assetRole === "spell-effect-frame" || a.assetRole === "melee-effect-frame").length;
        const effectVariants = [...new Set(catAssets.filter((a) => a.effectVariant).map((a) => a.effectVariant))].sort();
        const supportCount = catAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "animation-preview" || a.assetRole === "metadata" || a.assetRole === "system-file").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        const anims = [...new Set(catAssets.filter((a) => a.animation).map((a) => a.animation))].sort();
        const effs = [...new Set(catAssets.filter((a) => a.effect).map((a) => a.effect))];
        summaryBar = `<div class="summary-bar">${catAssets.length} source records · ${gameFams.size} semantic families · ${charFrames} idle pose${charFrames !== 1 ? "s" : ""} · ${animFrames} animation frames (${anims.join(" + ")}) · ${effectFrames} effect frames (${effs.join(" + ")}${effectVariants.length ? ` · ${effectVariants.length} slash variant${effectVariants.length !== 1 ? "s" : ""}` : ""}) · ${supportCount} source/support · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount} · 0 unclassified</div>`;
      } else if (isMonster) {
        const monFams = new Set(catAssets.filter((a) => a.monsterFamilyType !== "system").map((a) => a.canonicalFamily).filter(Boolean));
        const identities = [...new Set(catAssets.map((a) => a.monsterId).filter(Boolean))];
        const sheets = catAssets.filter((a) => a.assetRole === "animation-sheet").length;
        const shadows = catAssets.filter((a) => a.assetRole === "shadow").length;
        const srcCount = catAssets.filter((a) => a.assetRole === "authoring-source").length;
        const tiledCount = catAssets.filter((a) => a.assetRole === "tiled-resource" || a.assetRole === "tiled-map").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        summaryBar = `<div class="summary-bar">${catAssets.length} source records · ${identities.length} monster identities (${identities.join(", ")}) · ${monFams.size} semantic families · ${sheets} animation sheets (${sheets / 2} without + ${sheets / 2} embedded shadow) · ${shadows} standalone shadows · ${srcCount} Aseprite sources · ${tiledCount} tiled resources · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount} · 0 unclassified</div>`;
        summaryBar += `<div class="summary-bar env-note">🐾 Spawnable entity resources (mob/entity definitions), not placeable level-decoration sprites. shadowMode is a rendering variant (embedded | none | separate). Nothing runtime-confirmed — entire package stays reference until runtime usage proves otherwise.</div>`;
      } else if (isNature) {
        const natureFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const rockCount = catAssets.filter((a) => a.canonicalFamily === "voiddesert_rock").length;
        const cutCount = catAssets.filter((a) => a.canonicalFamily === "voiddesert_cut_stone").length;
        const ringCount = catAssets.filter((a) => a.canonicalFamily === "voiddesert_stone_formation").length;
        const mesaCount = catAssets.filter((a) => a.canonicalFamily === "voiddesert_mesa").length;
        const palmCount = catAssets.filter((a) => a.canonicalFamily === "voiddesert_palm").length;
        const treeCount = catAssets.filter((a) => a.canonicalFamily === "voiddesert_desert_tree").length;
        const runtimeCount = catAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        summaryBar = `<div class="summary-bar">${catAssets.length} source assets · ${natureFams.size} semantic nature families · ${rockCount} rocks · ${cutCount} cut stone · ${ringCount} stone formation · ${mesaCount} mesa formations · ${palmCount} palms · ${treeCount} desert trees · Runtime: ${runtimeCount} · Reference: ${catAssets.length - runtimeCount} · Reviewed: ${reviewedCount} · 0 unclassified</div>`;
        summaryBar += `<div class="summary-bar env-note">🏜 Clean set of 24 game-ready/reference PNG nature assets — no authoring files or junk records. NOT tiles: transparent standalone overlays/world objects (no tileMode/topology edges). Trees collide on TRUNK footprint (not sprite rect/canopy). Mesas are landmark-scale (occlusion recommended). Everything stays reference.</div>`;
      } else if (isSource) {
        const sourceFams = new Set(catAssets.map((a) => a.canonicalFamily).filter(Boolean));
        const reviewedCount = catAssets.filter((a) => a.review.status === "reviewed").length;
        const gameplayCount = catAssets.filter((a) => a.assetRole !== "authoring-source" && a.assetRole !== "documentation").length;
        summaryBar = `<div class="summary-bar">${catAssets.length} source assets · ${sourceFams.size} source famil${sourceFams.size === 1 ? "y" : "ies"} · ${gameplayCount} gameplay assets · 0 unclassified · Reviewed: ${reviewedCount}</div>`;
      } else {
        summaryBar = `<div class="summary-bar">${familiesOnPage.length} families · ${catAssets.length} source assets · ${completes} placeable composite${completes !== 1 ? "s" : ""} · ${components} component${components !== 1 ? "s" : ""} · ${props} prop${props !== 1 ? "s" : ""}${others > 0 ? ` · ${others} other` : ""}</div>`;
      }
      // Filter controls
      const placeableFilter = (isRoad || isGround || isDecor || isNpc || isHvNpc || isClass || isEnv || isMonster || isNature || isSource) ? "" : `
  <label><input type="checkbox" class="filter-check" data-f="placeable" /> <span>Placeable only</span></label>`;
      const roleFilter = (isRoad || isGround || isDecor || isNpc || isHvNpc || isClass || isEnv || isMonster || isNature || isSource) ? "" : `
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="complete" /> complete</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="component" /> component</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="prop" /> prop</label>
  </span>`;
      const npcFilter = isNpc ? `
  <span class="filter-group">NPC
    <label><input type="checkbox" class="filter-check" data-f="npc" data-v="artist" /> artist</label>
    <label><input type="checkbox" class="filter-check" data-f="npc" data-v="astrologer" /> astrologer</label>
    <label><input type="checkbox" class="filter-check" data-f="npc" data-v="citizen" /> citizen</label>
  </span>
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="character" /> character</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="animation-frame" /> frame</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="character-component" /> component</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="dialogue-ui" /> dialogue ui</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-source" /> source</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="documentation" /> docs</label>
  </span>
  <span class="filter-group">Animation
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="greeting" /> greeting</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="idle" /> idle</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="walk" /> walk</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="communication" /> communication</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="idle_blink" /> idle blink</label>
  </span>
  <span class="filter-group">Direction
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="front" /> front</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="back" /> back</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="side" /> side</label>
  </span>` : "";          const classEffectOptions = isClass ? [...new Set(catAssets.filter((a) => a.effect).map((a) => a.effect))].sort().map((e) => `<label><input type="checkbox" class="filter-check" data-f="effect" data-v="${e}" /> ${e.replace(/_/g, " ")}</label>`).join("") : "";
          const classVariantOptions = isClass ? [...new Set(catAssets.filter((a) => a.effectVariant).map((a) => a.effectVariant))].sort().map((v) => `<label><input type="checkbox" class="filter-check" data-f="effectvariant" data-v="${v}" /> ${v}</label>`).join("") : "";
          const envFilter = isEnv ? `
  <span class="filter-group">Type
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="terrain" /> terrain</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="bush" /> bush</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="tree" /> tree/stump</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="rock" /> rock</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="banner" /> banner/flag</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="building" /> building</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="fortification" /> fortification</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="landmark" /> landmark</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="camp" /> camp</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="interactable" /> interactable</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="woodwork" /> woodwork</label>
    <label><input type="checkbox" class="filter-check" data-f="envtype" data-v="source" /> source</label>
  </span>
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="terrain-tile" /> terrain tile</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="decor" /> prop</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-source" /> source</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-master" /> master</label>
  </span>
  <span class="filter-group">Terrain
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="autotile-kit" /> autotile kit</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="base-grass" /> base grass</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="base-dirt" /> base dirt</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="autotile" /> tile (unverified)</label>
  </span>` : "";
          const hvNpcFilter = isHvNpc ? `
  <span class="filter-group">NPC
    <label><input type="checkbox" class="filter-check" data-f="npc" data-v="blacksmith" /> blacksmith</label>
    <label><input type="checkbox" class="filter-check" data-f="npc" data-v="jeweler" /> jeweler</label>
    <label><input type="checkbox" class="filter-check" data-f="npc" data-v="sage" /> sage</label>
  </span>
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="animation-frame" /> frame</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="character-component" /> component</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="profession-prop" /> prop</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="dialogue-ui" /> dialogue ui</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="animation-source" /> scml</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-source" /> source</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-master" /> master</label>
  </span>
  <span class="filter-group">Animation
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="chagrin" /> chagrin</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="communication" /> communication</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="greeting" /> greeting</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="greeting_2" /> greeting 2</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="idle" /> idle</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="idle_blink" /> idle blink</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="joy" /> joy</label>
  </span>
  <span class="filter-group">Direction
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="front" /> front</label>
  </span>` : "";
          const monsterFilter = isMonster ? `
  <span class="filter-group">Monster
    <label><input type="checkbox" class="filter-check" data-f="monster" data-v="black_grouse" /> black grouse</label>
    <label><input type="checkbox" class="filter-check" data-f="monster" data-v="boar" /> boar</label>
    <label><input type="checkbox" class="filter-check" data-f="monster" data-v="deer" /> deer</label>
    <label><input type="checkbox" class="filter-check" data-f="monster" data-v="fox" /> fox</label>
    <label><input type="checkbox" class="filter-check" data-f="monster" data-v="hare" /> hare</label>
  </span>
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="animation-sheet" /> sheet</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="shadow" /> shadow</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-source" /> source</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="tiled-resource" /> tiled copy</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="tiled-map" /> tiled map</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="system-file" /> system</label>
  </span>
  <span class="filter-group">Animation
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="idle" /> idle</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="walk" /> walk</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="run" /> run</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="flight" /> flight</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="attack" /> attack</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="hurt" /> hurt</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="death" /> death</label>
  </span>
  <span class="filter-group">Shadow
    <label><input type="checkbox" class="filter-check" data-f="shadowmode" data-v="embedded" /> embedded</label>
    <label><input type="checkbox" class="filter-check" data-f="shadowmode" data-v="none" /> none</label>
    <label><input type="checkbox" class="filter-check" data-f="shadowmode" data-v="separate" /> separate</label>
  </span>
  <span class="filter-group">Direction
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="front" /> front</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="back" /> back</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="left" /> left</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="right" /> right</label>
  </span>` : "";
          const natureFilter = isNature ? `
  <span class="filter-group">Nature
    <label><input type="checkbox" class="filter-check" data-f="nature" data-v="voiddesert_rock" /> rocks</label>
    <label><input type="checkbox" class="filter-check" data-f="nature" data-v="voiddesert_cut_stone" /> cut stone</label>
    <label><input type="checkbox" class="filter-check" data-f="nature" data-v="voiddesert_stone_formation" /> stone ring</label>
    <label><input type="checkbox" class="filter-check" data-f="nature" data-v="voiddesert_mesa" /> mesas</label>
    <label><input type="checkbox" class="filter-check" data-f="nature" data-v="voiddesert_palm" /> palms</label>
    <label><input type="checkbox" class="filter-check" data-f="nature" data-v="voiddesert_desert_tree" /> desert trees</label>
  </span>
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="nature" /> nature</label>
  </span>
  <span class="filter-group">Collision
    <label><input type="checkbox" class="filter-check" data-f="collision" data-v="footprint" /> footprint</label>
    <label><input type="checkbox" class="filter-check" data-f="collision" data-v="trunk" /> trunk</label>
  </span>` : "";
          const classFilter = isClass ? `
  <span class="filter-group">Role
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="character-frame" /> idle pose</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="animation-frame" /> anim frame</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="projectile-effect-frame" /> projectile</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="spell-effect-frame" /> spell frame</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="authoring-source" /> source</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="animation-preview" /> preview</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="metadata" /> metadata</label>
    <label><input type="checkbox" class="filter-check" data-f="role" data-v="system-file" /> system</label>
  </span>
  <span class="filter-group">Animation
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="idle" /> idle</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="walk" /> walk</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="lead_jab" /> lead jab</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="pickup" /> pickup</label>
    <label><input type="checkbox" class="filter-check" data-f="animation" data-v="death_fall_back" /> fall back</label>
  </span>
  <span class="filter-group">Direction
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="east" /> east</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="north" /> north</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="south" /> south</label>
    <label><input type="checkbox" class="filter-check" data-f="direction" data-v="west" /> west</label>
  </span>
  <span class="filter-group">Effect
    ${classEffectOptions}
  </span>${classVariantOptions ? `
  <span class="filter-group">Slash variant
    ${classVariantOptions}
  </span>` : ""}` : "";
      const decorFilter = isDecor ? `
  <span class="filter-group">Decor type
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="utility" /> utility</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="signage" /> signage</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="container" /> container</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="storage" /> storage</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="landmark" /> landmark</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="water-feature" /> water</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="natural-prop" /> natural prop</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="material-pile" /> material</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="vegetation" /> vegetation</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="stone" /> stone</label>
    <label><input type="checkbox" class="filter-check" data-f="decorrole" data-v="tree" /> tree</label>
  </span>
  <span class="filter-group">Collision
    <label><input type="checkbox" class="filter-check" data-f="collision" data-v="none" /> none</label>
    <label><input type="checkbox" class="filter-check" data-f="collision" data-v="small-footprint" /> small</label>
    <label><input type="checkbox" class="filter-check" data-f="collision" data-v="object-footprint" /> object</label>
    <label><input type="checkbox" class="filter-check" data-f="collision" data-v="trunk-footprint" /> trunk</label>
  </span>
  <span class="filter-group">Depth
    <label><input type="checkbox" class="filter-check" data-f="depthmode" data-v="ground" /> ground</label>
    <label><input type="checkbox" class="filter-check" data-f="depthmode" data-v="object" /> object</label>
    <label><input type="checkbox" class="filter-check" data-f="depthmode" data-v="tall-object" /> tall</label>
  </span>
  <span class="filter-group">Density
    <label><input type="checkbox" class="filter-check" data-f="density" data-v="sparse" /> sparse</label>
    <label><input type="checkbox" class="filter-check" data-f="density" data-v="normal" /> normal</label>
    <label><input type="checkbox" class="filter-check" data-f="density" data-v="frequent" /> frequent</label>
  </span>` : "";
      const groundFilter = isGround ? `
  <span class="filter-group">Terrain role
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="base-texture" /> base</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="patch" /> patch</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="edge" /> edge</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="outer-corner" /> outer corner</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="compound-corner" /> compound corner</label>
    <label><input type="checkbox" class="filter-check" data-f="terrainrole" data-v="hard-corner" /> hard corner</label>
  </span>
  <span class="filter-group">Tile mode
    <label><input type="checkbox" class="filter-check" data-f="tilemode" data-v="repeat" /> repeat</label>
    <label><input type="checkbox" class="filter-check" data-f="tilemode" data-v="manual" /> manual</label>
  </span>
  <span class="filter-group">Variant
    <label><input type="checkbox" class="filter-check" data-f="variant" data-v="a" /> variant a</label>
    <label><input type="checkbox" class="filter-check" data-f="variant" data-v="b" /> variant b</label>
  </span>` : "";
      const roadFilter = isRoad ? `
  <span class="filter-group">Road
    <label><input type="checkbox" class="filter-check" data-f="roadtype" data-v="autotile" /> autotile</label>
    <label><input type="checkbox" class="filter-check" data-f="roadtype" data-v="seamless-texture" /> seamless</label>
  </span>
  <span class="filter-group">Surface
    <label><input type="checkbox" class="filter-check" data-f="surface" data-v="dirt" /> dirt</label>
    <label><input type="checkbox" class="filter-check" data-f="surface" data-v="cobblestone" /> cobble</label>
    <label><input type="checkbox" class="filter-check" data-f="surface" data-v="stone-paver" /> paver</label>
    <label><input type="checkbox" class="filter-check" data-f="surface" data-v="brick" /> brick</label>
    <label><input type="checkbox" class="filter-check" data-f="surface" data-v="natural-stone" /> natural stone</label>
  </span>
  <span class="filter-group">Topology
    <label><input type="checkbox" class="filter-check" data-f="topology" data-v="verified" /> verified</label>
    <label><input type="checkbox" class="filter-check" data-f="topology" data-v="needs-verification" /> needs verification</label>
  </span>` : "";
      const filterBar = `<div class="filter-bar">
  <span class="filter-label">Filter:</span>${placeableFilter}${roleFilter}${roadFilter}${groundFilter}${decorFilter}${classFilter}${npcFilter}${hvNpcFilter}${envFilter}${monsterFilter}${natureFilter}
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
<title>${packName} ${cat} — Review</title>
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
  .grid { display: block; }
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
  .card .meta .road-role { background: #ede7f6; color: #4527a0; font-weight: 600; }
  .card .meta .terrain-role { background: #e0f2f1; color: #00695c; font-weight: 600; }
  .card .meta .decor-role { background: #fce4ec; color: #ad1457; font-weight: 600; }
  .card .meta .subtype-badge { background: #f3e5f5; color: #7b1fa2; font-size: 0.7rem; }
  .card .meta .depth-badge { background: #e3f2fd; color: #1565c0; font-weight: 600; }
  .card .meta .density-badge { background: #fff3e0; color: #e65100; font-weight: 600; }
  .card .meta .npc-role { background: #eceff1; color: #37474f; font-weight: 600; }
  .card .meta .anim-badge { background: #e8f5e9; color: #2e7d32; font-weight: 600; }
  .card .meta .dir-badge { background: #e3f2fd; color: #1565c0; font-weight: 600; }
  .card .meta .frame-badge { background: #fce4ec; color: #ad1457; font-weight: 600; }
  .family-header .npc-note { font-size: 0.75rem; color: #37474f; margin-top: 0.25rem; }
  .identity-strip { margin-bottom: 1rem; }
  .identity-heading { font-size: 1rem; color: #2e5037; margin: 0 0 0.5rem; }
  .identity-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .identity-card { display: flex; gap: 0.75rem; background: #fff; border: 1px solid #b9cfb5; border-left: 4px solid #456b4e; border-radius: 8px; padding: 0.75rem; }
  .identity-card img { width: 96px; height: 96px; object-fit: contain; background: repeating-conic-gradient(#e8ede6 0% 25%, #fff 0% 50%) 50%/16px 16px; border-radius: 6px; }
  .identity-name { font-weight: 700; font-size: 1rem; color: #2e5037; }
  .identity-id { font-size: 0.75rem; color: #416f99; font-family: ui-monospace, monospace; margin: 0.1rem 0 0.3rem; }
  .identity-desc { font-size: 0.78rem; color: #68766b; }
  .identity-anims { font-size: 0.72rem; color: #2e7d32; margin-top: 0.35rem; }
  .card .meta .variant-badge { background: #fff8e1; color: #f57f17; font-weight: 600; }
  .card .meta .candidate-role { background: #f3e5f5; color: #7b1fa2; font-weight: 600; }
  .card .meta .topology { background: #fff8e1; color: #f57f17; }
  .family-header .topology-note { font-size: 0.75rem; color: #00695c; margin-top: 0.25rem; }
  .family-header .topology-note a { color: #00695c; }
  .family-header .depth-note { font-size: 0.75rem; color: #6a1b9a; margin-top: 0.25rem; }
  .family-header .status-badge { font-weight: 600; color: #2e5037; margin-top: 0.35rem; }
  .family-header .status-badge strong { color: #456b4e; }
  .family-header .art-required { font-weight: 600; color: #b71c1c; margin-top: 0.25rem; }
  .family-header .recovery-note { font-size: 0.75rem; color: #5d4037; margin-top: 0.3rem; line-height: 1.45; }
  .art-task { margin-top: 0.5rem; background: #fff8f0; border: 1px solid #e6c9a8; border-radius: 6px; padding: 0.6rem 0.8rem; font-size: 0.8rem; }
  .art-task h4 { margin: 0 0 0.35rem; font-size: 0.82rem; color: #a36e23; }
  .art-task ul { margin: 0; padding-left: 1.1rem; }
  .art-task li { margin: 0.2rem 0; }
  .art-task .tt { font-family: ui-monospace, monospace; color: #416f99; }
  .family-header .family-details { font-size: 0.8rem; color: #2e5037; margin-top: 0.35rem; }
  .family-header .family-details strong { color: #456b4e; }
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
${isNpc ? buildNpcIdentityStrip(catAssets) : ""}${isHvNpc ? buildHvNpcIdentityStrip(catAssets) : ""}
<div class="grid">
`;
      // Family order = first-seen in the category; assets naturally sorted within each family
      const familyOrder = [];
      for (const a of catAssets) {
        const f = familyKeyOf(a);
        if (!familyOrder.includes(f)) familyOrder.push(f);
      }
      const naturalCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
      for (const family of familyOrder) {
        const famAssets = [...(familyMap.get(family) ?? [])].sort((x, y) => naturalCmp(x.filename, y.filename));
          const completeCount = famAssets.filter((a) => a.assetRole === "complete").length;
          const componentCount = famAssets.filter((a) => a.assetRole === "component").length;
          const propCount = famAssets.filter((a) => a.assetRole === "prop").length;
          const otherCount = famAssets.length - completeCount - componentCount - propCount;
          const familyReview = famAssets.find((a) => a.canonicalFamily);
          const isRoadFam = !!familyReview?.roadType;
          const isEnvFam = !!familyReview?.envFamilyType;
          const isGroundFam = !!familyReview?.terrainRole && !isEnvFam;
          const isDecorFam = !!familyReview?.decorRole && !isEnvFam;
          const isNpcFam = !!familyReview?.npcFamilyType;
          const isHvNpcFam = !!familyReview?.hvNpcFamilyType;
          const isClassFam = !!familyReview?.classFamilyType;
          const isMonsterFam = !!familyReview?.monsterFamilyType;
          const isNatureFam = !!familyReview?.natureFamilyType;
          const isSourceFam = famAssets.some((a) => a.assetRole === "authoring-source" || a.assetRole === "documentation");
          const familyLabel = familyReview?.suggestedFamilyName
            ? (familyReview.buildingFamily ? `${family} — ${familyReview.suggestedFamilyName}` : familyReview.suggestedFamilyName)
            : family;
          let breakdown;
          if (isRoadFam) {
            const centerCount = famAssets.filter((a) => a.roadRole === "center").length;
            const autotileCount = famAssets.filter((a) => a.roadRole === "autotile").length;
            const seamlessCount = famAssets.filter((a) => a.roadRole === "seamless").length;
            const parts = [];
            if (autotileCount) parts.push(`${autotileCount} connectivity tile${autotileCount !== 1 ? "s" : ""}`);
            if (centerCount) parts.push(`${centerCount} center/fill`);
            if (seamlessCount) parts.push(`${seamlessCount} seamless texture`);
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""}${parts.length ? " · " + parts.join(", ") : ""}`;
          } else if (isGroundFam) {
            const variants = famAssets.filter((a) => a.variant).length;
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""} · ${famAssets.length - variants} unique role${famAssets.length - variants !== 1 ? "s" : ""}${variants ? ` + ${variants} variants` : ""}`;
          } else if (isDecorFam) {
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""} · ${famAssets.filter((a) => a.runtimeStatus === "runtime-used").length} runtime`;
          } else if (isNpcFam) {
            const frames = famAssets.filter((a) => a.assetRole === "animation-frame").length;
            const comps = famAssets.filter((a) => a.assetRole === "character-component").length;
            const ui = famAssets.filter((a) => a.assetRole === "dialogue-ui").length;
            const src = famAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "documentation").length;
            const chars = famAssets.filter((a) => a.assetRole === "character").length;
            const parts = [];
            if (chars) parts.push(`${chars} identity${chars !== 1 ? "ies" : "y"}`);
            if (frames) parts.push(`${frames} animation frames`);
            if (comps) parts.push(`${comps} components`);
            if (ui) parts.push(`${ui} shared UI`);
            if (src) parts.push(`${src} authoring/doc`);
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""}${parts.length ? " · " + parts.join(" · ") : ""}`;
          } else if (isEnvFam) {
            const pngCount = famAssets.filter((a) => a.isImage).length;
            const srcCount = famAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "authoring-master").length;
            const runtime = famAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
            if (familyReview.envFamilyType === "terrain") {
              const baseGrass = famAssets.filter((a) => a.terrainRole === "base-grass").length;
              const baseDirt = famAssets.filter((a) => a.terrainRole === "base-dirt").length;
              const unverified = famAssets.filter((a) => a.terrainRole === "autotile").length;
              breakdown = `${pngCount} terrain tile${pngCount !== 1 ? "s" : ""} · ${baseGrass} base-grass + ${baseDirt} base-dirt + ${unverified} connectivity tiles (roles needs-verification) · ${srcCount} EPS · ${runtime} runtime`;
            } else if (familyReview.envFamilyType === "source") {
              breakdown = `${famAssets.length} master${famAssets.length !== 1 ? "s" : ""} · 0 gameplay · 0 runtime`;
            } else {
              breakdown = `${pngCount} PNG prop${pngCount !== 1 ? "s" : ""} · ${srcCount} EPS · ${runtime} runtime`;
            }
          } else if (isMonsterFam) {
            const sheets = famAssets.filter((a) => a.assetRole === "animation-sheet").length;
            const shadows = famAssets.filter((a) => a.assetRole === "shadow").length;
            const src = famAssets.filter((a) => a.assetRole === "authoring-source").length;
            const tiled = famAssets.filter((a) => a.assetRole === "tiled-resource" || a.assetRole === "tiled-map").length;
            const sys = famAssets.filter((a) => a.assetRole === "system-file").length;
            const mons = [...new Set(famAssets.map((a) => a.monsterId).filter(Boolean))];
            const runtime = famAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
            const parts = [];
            if (mons.length) parts.push(`${mons.length} monster${mons.length !== 1 ? "s" : ""} (${mons.join(", ")})`);
            if (sheets) parts.push(`${sheets} animation sheet${sheets !== 1 ? "s" : ""}`);
            if (shadows) parts.push(`${shadows} standalone shadow${shadows !== 1 ? "s" : ""}`);
            if (src) parts.push(`${src} Aseprite source${src !== 1 ? "s" : ""}`);
            if (tiled) parts.push(`${tiled} tiled resource${tiled !== 1 ? "s" : ""}`);
            if (sys) parts.push(`${sys} system`);
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""}${parts.length ? " · " + parts.join(" · ") : ""} · ${runtime} runtime`;
          } else if (isHvNpcFam) {
            const frames = famAssets.filter((a) => a.assetRole === "animation-frame").length;
            const comps = famAssets.filter((a) => a.assetRole === "character-component").length;
            const props = famAssets.filter((a) => a.assetRole === "profession-prop").length;
            const ui = famAssets.filter((a) => a.assetRole === "dialogue-ui").length;
            const scml = famAssets.filter((a) => a.assetRole === "animation-source").length;
            const src = famAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "authoring-master").length;
            const npcs = [...new Set(famAssets.map((a) => a.npcId).filter(Boolean))];
            const runtime = famAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
            const parts = [];
            if (npcs.length) parts.push(`${npcs.length} NPCs (${npcs.join(", ")})`);
            if (frames) parts.push(`${frames} animation frames`);
            if (comps) parts.push(`${comps} components`);
            if (props) parts.push(`${props} profession prop${props !== 1 ? "s" : ""}`);
            if (ui) parts.push(`${ui} shared UI`);
            if (scml) parts.push(`${scml} SCML`);
            if (src) parts.push(`${src} authoring/source`);
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""}${parts.length ? " · " + parts.join(" · ") : ""} · ${runtime} runtime`;
          } else if (isNatureFam) {
            const runtime = famAssets.filter((a) => a.runtimeStatus === "runtime-used").length;
            const variants = famAssets.filter((a) => a.variant).length;
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""} · ${variants} semantic variant${variants !== 1 ? "s" : ""} · ${runtime} runtime`;
          } else if (isSourceFam) {
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""} · ${famAssets.filter((a) => a.assetRole === "authoring-source").length} authoring master${famAssets.filter((a) => a.assetRole === "authoring-source").length !== 1 ? "s" : ""} · 0 gameplay`;
          } else if (isClassFam) {
            const frames = famAssets.filter((a) => a.assetRole === "animation-frame" || a.assetRole === "character-frame").length;
            const proj = famAssets.filter((a) => a.assetRole === "projectile-effect-frame").length;
            const src = famAssets.filter((a) => a.assetRole === "authoring-source" || a.assetRole === "animation-preview" || a.assetRole === "metadata" || a.assetRole === "system-file").length;
            const dirs = [...new Set(famAssets.map((a) => a.direction).filter(Boolean))].length;
            const parts = [];
            if (frames) parts.push(`${frames} character/animation frame${frames !== 1 ? "s" : ""}${dirs ? ` · ${dirs} directions` : ""}`);
            if (proj) parts.push(`${proj} projectile frame${proj !== 1 ? "s" : ""}`);
            if (src) parts.push(`${src} source/support`);
            breakdown = `${famAssets.length} asset${famAssets.length !== 1 ? "s" : ""}${parts.length ? " · " + parts.join(" · ") : ""}`;
          } else {
            breakdown = famAssets.length === 0 ? "" : `${famAssets.length} assets · ${completeCount} complete / ${componentCount} components${propCount > 0 ? ` / ${propCount} props` : ""}${otherCount > 0 ? ` / ${otherCount} other` : ""}`;
          }
          const worldRole = familyReview?.worldRole ? ` · <span class="world-role">${familyReview.worldRole}</span>` : "";
          const suitability = familyReview?.suitability ? ` · <span class="suitability">Clover suitability: ${familyReview.suitability}</span>` : "";
          const structureType = familyReview?.structureType ? ` · <span class="structure-type">${familyReview.structureType}</span>` : "";
          const uses = familyReview?.recommendedUses?.length ? ` · Uses: ${familyReview.recommendedUses.slice(0, 4).join(", ")}` : "";          let roadDetails = "";
          if (isRoadFam) {
            const bits = [];
            if (familyReview.roadType) bits.push(`Type: <strong>${familyReview.roadType === "autotile" ? "Autotile" : "Seamless Surface"}</strong>`);
            if (familyReview.surfaceType) bits.push(`Surface: ${familyReview.surfaceType}`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            if (familyReview.walkable !== undefined) bits.push(`Walkable: ${familyReview.walkable ? "Yes" : "No"}`);
            if (familyReview.collision) bits.push(`Collision: ${familyReview.collision}`);
            if (familyReview.suitability) bits.push(`Suitability: ${familyReview.suitability}`);
            if (familyReview.topology) bits.push(`Topology: ${familyReview.topology === "verified" ? "Verified" : "Needs Verification"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
          } else if (isGroundFam) {
            const bits = [];
            if (familyReview.terrainRole) bits.push(`Role: <strong>${familyReview.terrainRole}</strong>`);
            if (familyReview.tileMode) bits.push(`Tile mode: ${familyReview.tileMode}`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            if (familyReview.walkable !== undefined) bits.push(`Walkable: ${familyReview.walkable ? "Yes" : "No"}`);
            if (familyReview.collision) bits.push(`Collision: ${familyReview.collision}`);
            if (familyReview.topology) bits.push(`Topology: ${familyReview.topology === "verified" ? "Verified" : "Needs Verification"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            roadDetails += `<p class="family-details topology-note">🔍 Verified by alpha-silhouette analysis — preview: <a href="../terrain/index.html">Terrain Topology Preview</a></p>`;
          } else if (isDecorFam) {
            const bits = [];
            if (familyReview.decorRole) bits.push(`Type: <strong>${familyReview.decorRole}</strong>`);
            if (familyReview.placementMode) bits.push(`Placement: ${familyReview.placementMode}`);
            if (familyReview.topology) bits.push(`Topology: ${familyReview.topology}`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            if (familyReview.collision) bits.push(`Collision: ${familyReview.collision} (recommended)`);
            if (familyReview.depthMode) bits.push(`Depth: ${familyReview.depthMode}`);
            if (familyReview.density) bits.push(`Density: ${familyReview.density}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            roadDetails += `<p class="family-details depth-note">🎯 Anchor: bottom-center (2.5D depth/collision anchor at footprint base — player walks behind tall objects, not through them)</p>`;
          } else if (isClassFam) {
            const bits = [];
            if (familyReview.classId) bits.push(`Class: <strong>${familyReview.classId}</strong>`);
            if (familyReview.classFamilyType) bits.push(`Type: <strong>${familyReview.classFamilyType.replace(/-/g, " ")}</strong>`);
            const anims = [...new Set(famAssets.map((a) => a.animation).filter(Boolean))];
            if (anims.length) bits.push(`Animations: ${anims.join(", ")}`);
            const dirs = [...new Set(famAssets.map((a) => a.direction).filter(Boolean))];
            if (dirs.length) bits.push(`Directions: ${dirs.join(", ")}`);
            const effs = [...new Set(famAssets.map((a) => a.effect).filter(Boolean))];
            if (effs.length) bits.push(`Effects: ${effs.join(", ")}`);
            const els = [...new Set(famAssets.map((a) => a.element).filter(Boolean))];
            if (els.length) bits.push(`Elements: ${els.join(", ")}`);
            bits.push(`Placeable: ${famAssets.some((a) => a.placeable) ? "yes" : "no"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            if (familyReview.classFamilyType === "projectile-effect") roadDetails += `<p class="family-details npc-note">🎯 Spawned combat effects — fire_arrow (runtime PNG, 600x320) and water_arrow (reference PNG, 480x360). AI/EPS/GIF are authoring sources, not placeable sprites.</p>`;
            if (familyReview.classFamilyType === "interaction") roadDetails += `<p class="family-details npc-note">📦 Picking Up stays REFERENCE — do not promote to runtime just because the neighboring Archer animations are confirmed.</p>`;
            if (familyReview.classFamilyType === "support") roadDetails += `<p class="family-details npc-note">🗂 metadata.json + .DS_Store — provenance only, catalogVisible false, not runtime-eligible.</p>`;
          } else if (isEnvFam) {
            const bits = [];
            if (familyReview.envFamilyType) bits.push(`Type: <strong>${familyReview.envFamilyType === "terrain" ? "Dirt + Grass Autotile Kit" : familyReview.envFamilyType}</strong>`);
            if (familyReview.terrainRole) bits.push(`Kit: ${familyReview.terrainRole.replace(/-/g, " ")}`);
            if (familyReview.tileMode) bits.push(`Tile mode: ${familyReview.tileMode}`);
            if (familyReview.decorRole) bits.push(`Decor: ${familyReview.decorRole}`);
            if (familyReview.placementMode) bits.push(`Placement: ${familyReview.placementMode}`);
            const variants = [...new Set(famAssets.map((a) => a.variant).filter(Boolean))];
            if (variants.length) bits.push(`Variants: ${variants.join(", ")}`);
            const sizes = [...new Set(famAssets.map((a) => a.size).filter(Boolean))];
            if (sizes.length) bits.push(`Sizes: ${sizes.join(", ")}`);
            const orient = [...new Set(famAssets.map((a) => a.orientation).filter(Boolean))];
            if (orient.length) bits.push(`Orientation: ${orient.join(", ")}`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            if (familyReview.walkable !== undefined) bits.push(`Walkable: ${familyReview.walkable ? "Yes" : "No"}`);
            if (familyReview.collision) bits.push(`Collision: ${familyReview.collision} (recommended)`);
            if (familyReview.topology) bits.push(`Topology: ${familyReview.topology === "verified" ? "Verified" : "Needs Verification"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            if (familyReview.envFamilyType === "terrain") roadDetails += `<p class="family-details npc-note">🔍 56-tile dirt+grass autotile kit. Ground 14/23 (dirt) and 43/52 (grass) are confirmed base tiles; the other 52 keep per-tile roles needs-verification until an alpha-silhouette pass (same method as Clover ground). Visually similar tiles are TRUE VARIANTS — kept for repetition variety.</p>`;
            if (familyReview.envFamilyType === "tree") roadDetails += `<p class="family-details npc-note">🎯 Anchor: bottom-center — players walk behind the canopy, not through the trunk (2.5D).</p>`;
            if (familyReview.envFamilyType === "source") roadDetails += `<p class="family-details npc-note">📦 Master authoring sources — .ai / .eps are <strong>formats</strong>, not asset families. Kept for provenance; never runtime-eligible or placeable.</p>`;
          } else if (isMonsterFam) {
            const bits = [];
            if (familyReview.monsterFamilyType) bits.push(`Type: <strong>${familyReview.monsterFamilyType === "animation" ? "Animation Sheets" : familyReview.monsterFamilyType}</strong>`);
            const mons = [...new Set(famAssets.map((a) => a.monsterId).filter(Boolean))];
            if (mons.length) bits.push(`Monsters: ${mons.join(", ")}`);
            const anims = [...new Set(famAssets.map((a) => a.animation).filter(Boolean))];
            if (anims.length) bits.push(`Animations: ${anims.join(", ")}`);
            const dirs = [...new Set(famAssets.map((a) => a.direction).filter(Boolean))];
            if (dirs.length) bits.push(`Directions: ${dirs.join(", ")}`);
            const shadowModes = [...new Set(famAssets.map((a) => a.shadowMode).filter(Boolean))];
            if (shadowModes.length) bits.push(`Shadow: ${shadowModes.join(", ")}`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            bits.push(`Runtime-eligible: ${famAssets.some((a) => a.runtimeEligible) ? "yes" : "no"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            if (familyReview.monsterFamilyType === "animation") roadDetails += `<p class="family-details npc-note">🎬 Sprite sheets are one sheet per animation with both with-shadow and without-shadow versions. shadowMode is a RENDERING VARIANT (embedded | none), not a different family. Directions come from the Aseprite filenames (front/back/left/right) — not inferred visually.</p>`;
            if (familyReview.monsterFamilyType === "shadow") roadDetails += `<p class="family-details npc-note">💠 Standalone shadows (shadowMode: separate). Runtime may precomposite sheets or render shadows separately — both representations of the same animation are kept.</p>`;
            if (familyReview.monsterFamilyType === "source") roadDetails += `<p class="family-details npc-note">📦 Aseprite authoring sources — direction is EXPLICIT in each filename, so direction metadata is deterministic. Never runtime-eligible or placeable.</p>`;
            if (familyReview.monsterFamilyType === "tiled") roadDetails += `<p class="family-details npc-note">🗺 Tiled editor export — copied PNGs are NOT duplicate monster identities; each is marked duplicateOf its canonical sheet. Animals.tmx is only runtime-eligible if the runtime actually loads it.</p>`;
            if (familyReview.monsterFamilyType === "system") roadDetails += `<p class="family-details npc-note">🗂 .DS_Store system files — catalogVisible false, not counted in family tallies.</p>`;
          } else if (isHvNpcFam) {
            const bits = [];
            if (familyReview.hvNpcFamilyType) bits.push(`Type: <strong>${familyReview.hvNpcFamilyType === "animation" ? "Animation Frames" : familyReview.hvNpcFamilyType}</strong>`);
            const npcs = [...new Set(famAssets.map((a) => a.npcId).filter(Boolean))];
            if (npcs.length) bits.push(`NPCs: ${npcs.join(", ")}`);
            const anims = [...new Set(famAssets.map((a) => a.animation).filter(Boolean))];
            if (anims.length) bits.push(`Animations: ${anims.join(", ")}`);
            const comps = [...new Set(famAssets.map((a) => a.component).filter(Boolean))];
            if (comps.length) bits.push(`Components: ${comps.join(", ")}`);
            const props = [...new Set(famAssets.map((a) => a.propRole).filter(Boolean))];
            if (props.length) bits.push(`Props: ${props.join(", ")}`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            bits.push(`Runtime-eligible: ${famAssets.some((a) => a.runtimeEligible) ? "yes" : "no"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            if (familyReview.hvNpcFamilyType === "animation") roadDetails += `<p class="family-details npc-note">🗣 Frontal expressive/dialogue package — NOT directional. greeting_2 preserved as its own ID (not guessed). Decor particles in Joy frames are part of the complete render, not separate props.</p>`;
            if (familyReview.hvNpcFamilyType === "component") roadDetails += `<p class="family-details npc-note">🧩 Reusable assembly components + Animations.scml per NPC — never individually placeable.</p>`;
            if (familyReview.hvNpcFamilyType === "profession-prop") roadDetails += `<p class="family-details npc-note">⚒ NPC assembly props (anvil shared across all 3 NPC folders, sage stick). Jeweler gems + sage shield exist as EPS sources only. Not world-decor unless runtime uses them independently.</p>`;
            if (familyReview.hvNpcFamilyType === "ui") roadDetails += `<p class="family-details npc-note">💬 Shared UI — popup_1 (415x376) and popup_2 (767x540) identical across all 3 NPCs; logical dedupe only, source files kept as aliases.</p>`;
            if (familyReview.hvNpcFamilyType === "source") roadDetails += `<p class="family-details npc-note">📦 61 EPS (sourceOf-linked to components/props/popups) + 6 AI masters — provenance only, never runtime-eligible or placeable.</p>`;
          } else if (isNatureFam) {
            const bits = [];
            if (familyReview.natureFamilyType) bits.push(`Type: <strong>${familyReview.natureFamilyType.replace(/-/g, " ")}</strong>`);
            if (familyReview.natureRole) bits.push(`Role: ${familyReview.natureRole}`);
            const variants = [...new Set(famAssets.map((a) => a.variant).filter(Boolean))];
            if (variants.length) bits.push(`Variants: ${variants.join(", ")}`);
            const treeTypes = [...new Set(famAssets.map((a) => a.treeType).filter(Boolean))];
            if (treeTypes.length) bits.push(`Tree types: ${treeTypes.join(", ")}`);
            if (familyReview.material) bits.push(`Material: ${familyReview.material}`);
            const formations = [...new Set(famAssets.map((a) => a.formationType).filter(Boolean))];
            if (formations.length) bits.push(`Formation: ${formations.join(", ")}`);
            if (familyReview.scaleClass) bits.push(`Scale: ${familyReview.scaleClass}`);
            if (familyReview.occlusion) bits.push(`Occlusion: yes`);
            if (familyReview.worldRole) bits.push(`World: ${familyReview.worldRole}`);
            if (familyReview.walkable !== undefined) bits.push(`Walkable: ${familyReview.walkable ? "Yes" : "No"}`);
            if (familyReview.collision) bits.push(`Collision: ${familyReview.collision} (recommended)`);
            bits.push(`Placement: ${familyReview.placementMode ?? "manual"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            if (familyReview.natureFamilyType === "rock") roadDetails += `<p class="family-details npc-note">🪨 Six natural rock silhouettes — distinct shapes, kept semantic (not rock_a-f). Collision recommended footprint; ground clutter, placement manual.</p>`;
            if (familyReview.natureFamilyType === "cut-stone") roadDetails += `<p class="family-details npc-note">🧱 Cut sandstone pieces — wedge + block. Deliberately NOT called ruins: cut stone is visually established, ruin would infer history/function that isn't shown.</p>`;
            if (familyReview.natureFamilyType === "stone-formation") roadDetails += `<p class="family-details npc-note">⭕ Stone ring formation — NOT a well. No visible water, bucket, or architectural evidence proving that function.</p>`;
            if (familyReview.natureFamilyType === "mesa") roadDetails += `<p class="family-details npc-note">🏜 Landmark-scale geological formations (tiered/wide/irregular). occlusion: true recommended — substantial world geometry, not ground clutter. NOT tiles.</p>`;
            if (familyReview.natureFamilyType === "palm") roadDetails += `<p class="family-details npc-note">🌴 7 palm variants — twin_a and twin_b are genuine variants (different silhouettes), not collapsed. Collision: TRUNK footprint, not the transparent sprite rectangle/canopy.</p>`;
            if (familyReview.natureFamilyType === "desert-tree") roadDetails += `<p class="family-details npc-note">🌳 Non-palm desert trees — broad, baobab (extremely characteristic silhouette), umbrella (conservative, not asserted acacia), dead ×2. Dead handled via treeType: dead, not a 7th family. Collision: trunk.</p>`;
            roadDetails += `<p class="family-details npc-note">🚫 None are tiles — transparent standalone overlays, no tileMode repeat or edge/corner topology. Entire package stays REFERENCE until runtime usage proves otherwise.</p>`;
          } else if (isSourceFam) {
            const bits = [];
            if (familyReview.sourceRole) bits.push(`Source role: <strong>${familyReview.sourceRole}</strong>`);
            const formats = [...new Set(famAssets.map((a) => a.format).filter(Boolean))];
            if (formats.length) bits.push(`Formats: ${formats.join(", ")}`);
            bits.push(`Runtime-eligible: ${famAssets.some((a) => a.runtimeEligible) ? "yes" : "no"}`);
            bits.push(`Placeable: ${famAssets.some((a) => a.placeable) ? "yes" : "no"}`);
            bits.push(`Collision: ${familyReview.collision ?? "none"}`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            roadDetails += `<p class="family-details npc-note">📦 Master authoring sources — .ai / .eps are <strong>formats</strong>, not asset families. Kept for provenance; never runtime-eligible or placeable.</p>`;
          } else if (isNpcFam) {
            const bits = [];
            if (familyReview.npcFamilyType) bits.push(`Type: <strong>${familyReview.npcFamilyType}</strong>`);
            const ids = [...new Set(famAssets.map((a) => a.npcId).filter(Boolean))];
            if (ids.length) bits.push(`NPCs: ${ids.join(", ")}`);
            const anims = [...new Set(famAssets.map((a) => a.animation).filter(Boolean))];
            if (anims.length) bits.push(`Animations: ${anims.join(", ")}`);
            const dirs = [...new Set(famAssets.map((a) => a.direction).filter(Boolean))];
            if (dirs.length) bits.push(`Directions: ${dirs.join(", ")}`);
            const frames = famAssets.filter((a) => a.assetRole === "animation-frame").length;
            if (frames) bits.push(`${frames} frames`);
            roadDetails = `<p class="family-details">${bits.join(" · ")}</p>`;
            if (familyReview.npcFamilyType === "animation") roadDetails += `<p class="family-details npc-note">🎬 Frames derive deterministically from character → animation → direction → frame. Runtime-confirmed frames: idle front for all 3 NPCs (proves renderClass complete-character + idle runtime; does NOT mark source-only directions unused).</p>`;
            if (familyReview.npcFamilyType === "component") roadDetails += `<p class="family-details npc-note">🧩 Reusable assembly components — never individually placeable in the game editor.</p>`;
            if (familyReview.npcFamilyType === "ui") roadDetails += `<p class="family-details npc-note">💬 Shared UI — popup_2.png identical across all 3 NPCs; popup_1 likewise. Logical dedupe only; source files untouched.</p>`;
            if (familyReview.npcFamilyType === "source") roadDetails += `<p class="family-details npc-note">📦 Authoring material — inventoried for provenance, NOT runtime-eligible.</p>`;
            const statusBits = [];
            if (familyReview.catalogStatus) statusBits.push(`Catalog: <strong>${familyReview.catalogStatus}</strong>`);
            if (familyReview.topologyStatus) statusBits.push(`Topology: <strong>${familyReview.topologyStatus === "verified" ? "Verified" : familyReview.topologyStatus}</strong>`);
            if (familyReview.kitStatus) statusBits.push(`Asset Kit: <strong>${familyReview.kitStatus}</strong>`);
            if (familyReview.runtimeReady) statusBits.push(`Runtime Ready: <strong>${familyReview.runtimeReady}</strong>`);
            if (familyReview.recoveryStatus) statusBits.push(`Recovery: <strong>${familyReview.recoveryStatus}</strong>`);
            if (statusBits.length) roadDetails += `<p class="family-details status-badge">${statusBits.join(" · ")}</p>`;
            if (familyReview.artRequired) roadDetails += `<p class="family-details art-required">Art Required: YES — see art task (5 tiles) below</p>`;
            const rec = familyReview.recovery;
            if (rec) {
              const miss = rec.cvMissingRoles?.length ? rec.cvMissingRoles.map((r) => r.replace(/^outer-corner-/, "outer-").replace(/^inner-corner-/, "inner-").replace(/^edge-/, "edge-")).join(", ") : "";
              const found = rec.foundInVoidDesert ? Object.entries(rec.foundInVoidDesert).map(([r, files]) => `${r.replace(/^outer-corner-/, "outer-").replace(/^inner-corner-/, "inner-").replace(/^edge-/, "edge-")}: ${files.map((f) => f.split("/").pop()).join(", ")}`).join("; ") : "";
              roadDetails += `<p class="family-details recovery-note">Recovery pass (${rec.pass}): ${rec.verdict}${found ? ` Missing roles found in VoidDesert: ${found}.` : ""}${rec.notFoundAnywhere?.length ? ` Missing everywhere: ${rec.notFoundAnywhere.join(", ")}.` : ""} Duplicates: ${rec.cvDuplicatesConfirmed?.map((d) => `${d.pair[0]}/${d.pair[1]} = ${d.verdict}`).join("; ") || ""}</p>`;
            }
          }
          let artTaskBlock = "";
          const at = familyReview?.artTask;
          if (at?.deliverable?.length) {
            artTaskBlock = `<div class="art-task"><h4>🎨 Completion Art Task — ${at.deliverable.length} tiles required${at.status ? ` (${at.status})` : ""}</h4><ul>${at.deliverable.map((d) => `<li><span class="tt">${d.asset}</span> — ${d.role.replace(/-/g, " ")} · visual: ${d.visualReference} · structure: ${d.structuralReference.join(", ")}</li>`).join("")}</ul></div>`;
          }
          html += `<section class="family" data-family="${family}"><button type="button" class="family-toggle" aria-expanded="true"><span class="family-caret">▾</span><span class="family-title">${familyLabel}</span></button><div class="family-header"><h2>${familyLabel}</h2><p>${breakdown}${worldRole}${structureType}${suitability}</p>${roadDetails}${artTaskBlock}${uses ? `<p class="family-uses">${uses}</p>` : ""}</div><div class="family-assets">
`;
        for (const asset of famAssets) {
          if (asset.isImage) {
            const canon = asset.canonicalName ? `<div class="canonical">${asset.canonicalName}</div>` : "";
          const roadAttrs = asset.roadRole ? ` data-roadtype="${asset.roadType ?? ""}" data-surface="${asset.surfaceType ?? ""}" data-topology="${asset.topology ?? "verified"}"` : "";
          const groundAttrs = asset.terrainRole ? ` data-terrainrole="${asset.terrainRole}" data-tilemode="${asset.tileMode ?? ""}" data-variant="${asset.variant ?? ""}"` : "";
          const decorAttrs = asset.decorRole ? ` data-decorrole="${asset.decorRole}" data-collision="${asset.collision ?? ""}" data-depthmode="${asset.depthMode ?? ""}" data-density="${asset.density ?? ""}"` : "";
          const npcAttrs = asset.npcId ? ` data-npc="${asset.npcId}" data-animation="${asset.animation ?? ""}" data-direction="${asset.direction ?? ""}"` : "";
          const classAttrs = asset.classId ? ` data-animation="${asset.animation ?? ""}" data-direction="${asset.direction ?? ""}" data-effect="${asset.effect ?? ""}" data-effectvariant="${asset.effectVariant ?? ""}"` : "";
          const envAttrs = asset.envFamilyType ? ` data-envtype="${asset.envFamilyType}"` : "";
          const monsterAttrs = asset.monsterId ? ` data-monster="${asset.monsterId}" data-animation="${asset.animation ?? ""}" data-direction="${asset.direction ?? ""}" data-shadowmode="${asset.shadowMode ?? ""}"` : "";
          const natureAttrs = asset.natureFamilyType ? ` data-nature="${asset.canonicalFamily ?? ""}" data-naturerole="${asset.natureRole ?? ""}" data-treetype="${asset.treeType ?? ""}" data-collision="${asset.collision ?? ""}"` : "";
          const sourceOfNote = asset.sourceOf ? `<span class="topology" title="Authoring source of ${asset.sourceOf}">src → ${asset.sourceOf}</span>` : "";
          const npcRoleBadge = asset.assetRole ? `<span class="npc-role">${asset.assetRole.replace(/-/g, " ")}</span>` : "";
          const effectBadge = asset.effect ? `<span class="candidate-role" title="Effect: ${asset.effect}">${asset.effect.toUpperCase()}</span>` : "";
          const elementBadge = asset.element ? `<span class="subtype-badge" title="Element: ${asset.element}">${asset.element}</span>` : "";
          const effectTypeBadge = asset.effectType ? `<span class="depth-badge" title="Effect type: ${asset.effectType}">${asset.effectType}</span>` : "";
          const effectVariantBadge = asset.effectVariant ? `<span class="variant-badge" title="Slash effect variant">SLASH ${asset.effectVariant}</span>` : "";
          const animBadge = asset.animation ? `<span class="anim-badge">${asset.animation.replace(/_/g, " ")}</span>` : "";
          const dirBadge = asset.direction ? `<span class="dir-badge">${asset.direction}</span>` : "";
          const frameBadge = asset.frame !== null && asset.frame !== undefined ? `<span class="frame-badge">${String(asset.frame).padStart(3, "0")}/${asset.frameCount ?? 30}</span>` : "";
          const roadRoleBadge = asset.roadRole ? `<span class="road-role">${asset.roadRole.toUpperCase()}</span>` : "";
          const terrainBadge = asset.terrainRole ? `<span class="terrain-role">${asset.terrainRole.replace(/-/g, " ").toUpperCase()}</span>` : "";
          const decorBadge = asset.decorRole ? `<span class="decor-role">${asset.decorRole.replace(/-/g, " ").toUpperCase()}</span>` : "";
          const subtypeBadge = asset.subtype ? `<span class="subtype-badge" title="Subtype: ${asset.subtype}">${asset.subtype}</span>` : "";
          const variantNameBadge = asset.variant && asset.canonicalFamily === "clover_stone" ? `<span class="variant-badge" title="Shape variant">VARIANT ${asset.variant.toUpperCase()}</span>` : "";
          const palmVariantBadge = asset.variant && asset.canonicalFamily === "clover_palm" ? `<span class="variant-badge" title="Palm silhouette">${asset.variant}</span>` : "";
          const depthBadge = asset.depthMode ? `<span class="depth-badge" title="Depth mode: ${asset.depthMode}">${asset.depthMode}</span>` : "";
          const densityBadge = asset.density ? `<span class="density-badge" title="Density: ${asset.density}">${asset.density}</span>` : "";
          const variantBadge = asset.variant && asset.terrainRole ? `<span class="variant-badge">VARIANT ${asset.variant.toUpperCase()}</span>` : "";
          const candBadge = asset.candidateRole ? `<span class="candidate-role" title="Visual candidate: ${asset.candidateRole}">${asset.candidateRole.toUpperCase()}</span>` : "";
          const topoBadge = asset.topology === "needs-verification" ? `<span class="topology">Topology Unverified</span>` : "";
          const envRoleBadge = asset.envRole ? `<span class="decor-role">${asset.envRole.replace(/-/g, " ").toUpperCase()}</span>` : "";
          const treeRoleBadge = asset.treeRole ? `<span class="candidate-role">${asset.treeRole}</span>` : "";
          const objRoleBadge = asset.objectRole ? `<span class="candidate-role">${asset.objectRole}</span>` : "";
          const orientBadge = asset.orientation ? `<span class="dir-badge">${asset.orientation}</span>` : "";
          const sizeBadge = asset.size ? `<span class="subtype-badge">${asset.size}</span>` : "";
          const terrainRoleBadge = asset.terrainRole ? `<span class="terrain-role">${asset.terrainRole.replace(/-/g, " ").toUpperCase()}</span>` : "";
          const monsterBadge = asset.monsterId ? `<span class="decor-role" title="Monster: ${asset.monsterId}">${asset.monsterId.replace(/_/g, " ")}</span>` : "";
          const shadowBadge = asset.shadowMode ? `<span class="depth-badge" title="Shadow mode: ${asset.shadowMode}">${asset.shadowMode}</span>` : "";
          const dupOfNote = asset.duplicateOf ? `<span class="topology" title="Duplicate of ${asset.duplicateOf}">dup → ${asset.duplicateOf}</span>` : "";
          const hvNpcBadge = asset.npcPackage === "happyvalley" && asset.npcId ? `<span class="decor-role" title="NPC: ${asset.npcId}">${asset.npcId}</span>` : "";
          const compBadge = asset.component ? `<span class="candidate-role">${asset.component}</span>` : "";
          const propBadge = asset.propRole ? `<span class="candidate-role">${asset.propRole}</span>` : "";
          const sharedVisualBadge = asset.sharedVisual ? `<span class="subtype-badge" title="Shared visual — same artwork across NPCs">shared</span>` : "";
          const natureBadge = asset.natureFamilyType ? `<span class="decor-role" title="Nature family: ${asset.canonicalFamily}">${asset.natureFamilyType.replace(/-/g, " ")}</span>` : "";
          const natureRoleBadge = asset.natureRole ? `<span class="terrain-role">${asset.natureRole.replace(/-/g, " ")}</span>` : "";
          const treeTypeBadge = asset.treeType ? `<span class="candidate-role" title="Tree type">${asset.treeType}</span>` : "";
          const formationBadge = asset.formationType ? `<span class="variant-badge" title="Formation type">${asset.formationType}</span>` : "";
          const materialBadge = asset.material ? `<span class="subtype-badge" title="Material">${asset.material}</span>` : "";
          const scaleBadge = asset.scaleClass ? `<span class="depth-badge" title="Scale class">${asset.scaleClass}</span>` : "";
          const occlusionBadge = asset.occlusion ? `<span class="topology" title="Occlusion recommended">occlusion</span>` : "";
          html += `<div class="card" data-role="${asset.assetRole ?? "none"}" data-world="${asset.worldRole ?? "UNASSIGNED"}" data-runtime="${asset.runtimeStatus}"${roadAttrs}${groundAttrs}${decorAttrs}${npcAttrs}${classAttrs}${envAttrs}${monsterAttrs}${natureAttrs}><img loading="lazy" src="${asset.imageUrl}" alt="${asset.filename}"><div class="filename">${asset.filename}${canon}</div><div class="path">${asset.path}</div><div class="meta"><span>${asset.id}</span>${asset.width && asset.height ? `<span>${asset.width}×${asset.height}</span>` : ""}${asset.assetRole ? `<span>${asset.assetRole}</span>` : ""}${roadRoleBadge}${terrainBadge}${terrainRoleBadge}${decorBadge}${envRoleBadge}${monsterBadge}${hvNpcBadge}${natureBadge}${natureRoleBadge}${treeTypeBadge}${formationBadge}${materialBadge}${scaleBadge}${occlusionBadge}${treeRoleBadge}${objRoleBadge}${compBadge}${propBadge}${orientBadge}${sizeBadge}${shadowBadge}${dupOfNote}${sharedVisualBadge}${subtypeBadge}${variantNameBadge}${palmVariantBadge}${npcRoleBadge}${animBadge}${dirBadge}${frameBadge}${effectBadge}${elementBadge}${effectTypeBadge}${effectVariantBadge}${sourceOfNote}${depthBadge}${densityBadge}${variantBadge}${candBadge}${topoBadge}${badgeRuntime(asset.runtimeStatus)}${badgeReview(asset.review.status)}</div></div>
`;
        } else {
          const canon = asset.canonicalName ? `<div class="canonical">${asset.canonicalName}</div>` : "";
          const sourceBadge = asset.sourceRole ? `<span class="npc-role">${asset.sourceRole.replace(/-/g, " ")}</span>` : "";
          const formatBadge = asset.format ? `<span class="dir-badge">${asset.format}</span>` : "";
          const eligBadge = asset.runtimeEligible === false ? `<span class="topology">not runtime-eligible</span>` : "";
          const sourceOfNote = asset.sourceOf ? `<span class="topology" title="Authoring source of ${asset.sourceOf}">src → ${asset.sourceOf}</span>` : "";
          const envRoleBadge = asset.envRole ? `<span class="decor-role">${asset.envRole.replace(/-/g, " ").toUpperCase()}</span>` : "";
          const envAttrs = asset.envFamilyType ? ` data-envtype="${asset.envFamilyType}"` : "";
          const monsterAttrs = asset.monsterId ? ` data-monster="${asset.monsterId}" data-animation="${asset.animation ?? ""}" data-direction="${asset.direction ?? ""}" data-shadowmode="${asset.shadowMode ?? ""}"` : "";
          const monsterBadge = asset.monsterId ? `<span class="decor-role" title="Monster: ${asset.monsterId}">${asset.monsterId.replace(/_/g, " ")}</span>` : "";
          const shadowBadge = asset.shadowMode ? `<span class="depth-badge" title="Shadow mode: ${asset.shadowMode}">${asset.shadowMode}</span>` : "";
          const dupOfNote = asset.duplicateOf ? `<span class="topology" title="Duplicate of ${asset.duplicateOf}">dup → ${asset.duplicateOf}</span>` : "";
          const animBadge = asset.animation ? `<span class="anim-badge">${asset.animation.replace(/_/g, " ")}</span>` : "";
          const dirBadge = asset.direction ? `<span class="dir-badge">${asset.direction}</span>` : "";
          const hvNpcAttrs = asset.npcPackage === "happyvalley" ? ` data-npc="${asset.npcId ?? ""}"` : "";
          const hvNpcBadge = asset.npcPackage === "happyvalley" && asset.npcId ? `<span class="decor-role" title="NPC: ${asset.npcId}">${asset.npcId}</span>` : "";
          const compBadge = asset.component ? `<span class="candidate-role">${asset.component}</span>` : "";
          const propBadge = asset.propRole ? `<span class="candidate-role">${asset.propRole}</span>` : "";
          const sharedVisualBadge = asset.sharedVisual ? `<span class="subtype-badge" title="Shared visual — same artwork across NPCs">shared</span>` : "";
          html += `<div class="card" data-role="${asset.assetRole ?? "none"}" data-world="${asset.worldRole ?? "UNASSIGNED"}" data-runtime="${asset.runtimeStatus}"${envAttrs}${monsterAttrs}${hvNpcAttrs}><div style="height:250px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#666">${asset.extension}</div><div class="filename">${asset.filename}${canon}</div><div class="path">${asset.path}</div><div class="meta"><span>${asset.id}</span><span>${asset.category}</span>${asset.assetRole ? `<span>${asset.assetRole}</span>` : ""}${sourceBadge}${formatBadge}${envRoleBadge}${monsterBadge}${hvNpcBadge}${compBadge}${propBadge}${sharedVisualBadge}${animBadge}${dirBadge}${shadowBadge}${dupOfNote}${sourceOfNote}${eligBadge}${badgeRuntime(asset.runtimeStatus)}${badgeReview(asset.review.status)}</div></div>
`;
        }
        }
        html += `</div></section>`;
      }
      html += `</div>
<script>
(function () {
  var families = document.querySelectorAll("section.family");
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
      if (show && active("roadtype") && !active("roadtype", card.dataset.roadtype)) show = false;
      if (show && active("surface") && !active("surface", card.dataset.surface)) show = false;
      if (show && active("terrainrole") && !active("terrainrole", card.dataset.terrainrole)) show = false;
      if (show && active("tilemode") && !active("tilemode", card.dataset.tilemode)) show = false;
      if (show && active("variant") && !active("variant", card.dataset.variant)) show = false;
      if (show && active("decorrole") && !active("decorrole", card.dataset.decorrole)) show = false;
      if (show && active("collision") && !active("collision", card.dataset.collision)) show = false;
      if (show && active("depthmode") && !active("depthmode", card.dataset.depthmode)) show = false;
      if (show && active("density") && !active("density", card.dataset.density)) show = false;
      if (show && active("npc") && !active("npc", card.dataset.npc)) show = false;
      if (show && active("envtype") && !active("envtype", card.dataset.envtype)) show = false;
      if (show && active("monster") && !active("monster", card.dataset.monster)) show = false;
      if (show && active("shadowmode") && !active("shadowmode", card.dataset.shadowmode)) show = false;
      if (show && active("nature") && !active("nature", card.dataset.nature)) show = false;
      if (show && active("naturerole") && !active("naturerole", card.dataset.naturerole)) show = false;
      if (show && active("treetype") && !active("treetype", card.dataset.treetype)) show = false;
      if (show && active("animation") && !active("animation", card.dataset.animation)) show = false;
      if (show && active("direction") && !active("direction", card.dataset.direction)) show = false;
      if (show && active("effect") && !active("effect", card.dataset.effect)) show = false;
      if (show && active("effectvariant") && !active("effectvariant", card.dataset.effectvariant)) show = false;
      if (show && active("topology") && !active("topology", card.dataset.topology)) show = false;
      card.style.display = show ? "" : "none";
      if (show) visibleCount += 1;
    });
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
    }
  }
  console.log(`  review/: ${Object.keys(byPack).length} packs`);

  console.log("\nDone! Deploy deploy/asset-catalog/ to your host.");
}

build().catch((error) => { console.error(error); process.exit(1); });
