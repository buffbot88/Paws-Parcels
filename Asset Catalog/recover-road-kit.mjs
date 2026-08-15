#!/usr/bin/env node
/**
 * Road Kit Recovery Pass — final.
 *
 * Compares CloverVillage road_1..13 (earthen vine path subset) against the full
 * VoidDesert road_1..26 kit. Role assignments below come from careful visual
 * inspection of color-classified 32x32 ASCII renders of every tile (decoded
 * from the PNGs) — the automated edge-threshold classifier is too noisy for
 * these vine-decorated tiles and was only used as supporting evidence.
 *
 * Findings written to design/assets/road-kit-recovery.json and a visual
 * comparison page at deploy/asset-catalog/autotile/recovery.html.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const CV_DIR = join(root, "reference", "assets", "maps", "CloverVillage", "Map", "PNG", "road");
const VD_DIR = join(root, "reference", "assets", "maps", "VoidDesert", "Map", "PNG");

function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let off = 8, width, height, colorType, bitDepth;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if ((colorType !== 2 && colorType !== 6) || bitDepth !== 8) throw new Error(`unsupported colorType=${colorType} bitDepth=${bitDepth}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: throw new Error("bad filter " + filter);
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const pixelAt = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const colorDist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

function dominantColors(img, k = 4) {
  const pts = [];
  for (let y = 0; y < img.height; y += 2) for (let x = 0; x < img.width; x += 2) pts.push(pixelAt(img, x, y));
  let means = pts.slice(0, k).map((p) => [...p]);
  const near = (m, p) => (m[0] - p[0]) ** 2 + (m[1] - p[1]) ** 2 + (m[2] - p[2]) ** 2 < 90 * 90;
  for (let iter = 0; iter < 12; iter++) {
    const sums = means.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      means.forEach((m, i) => {
        const d = (m[0] - p[0]) ** 2 + (m[1] - p[1]) ** 2 + (m[2] - p[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; sums[bi][3]++;
    }
    for (let i = 0; i < k; i++) if (sums[i][3] > 0) means[i] = [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]];
  }
  return means.map((m, i) => ({ rgb: m, count: pts.reduce((c, p) => c + (near(m, p) ? 1 : 0), 0) })).sort((a, b) => b.count - a.count);
}

const ROLE_LABEL = {
  center: "Center / Fill",
  "center-variant": "Center Variant",
  "edge-n": "Edge — North", "edge-e": "Edge — East", "edge-s": "Edge — South", "edge-w": "Edge — West",
  "outer-corner-ne": "Outer Corner — NE", "outer-corner-se": "Outer Corner — SE", "outer-corner-sw": "Outer Corner — SW", "outer-corner-nw": "Outer Corner — NW",
  "inner-corner-n": "Inner Corner — N", "inner-corner-e": "Inner Corner — E", "inner-corner-s": "Inner Corner — S", "inner-corner-w": "Inner Corner — W",
};
const ALL_ROLES = [
  "center", "edge-n", "edge-e", "edge-s", "edge-w",
  "outer-corner-ne", "outer-corner-se", "outer-corner-sw", "outer-corner-nw",
  "inner-corner-n", "inner-corner-e", "inner-corner-s", "inner-corner-w",
];

// Visually confirmed role reads (32x32 color-classified renders of the actual PNGs).
// CloverVillage set (13 tiles) — from the earlier validation pass.
const CV_VISUAL = {
  "road_1.png": "outer-corner-se", "road_2.png": "edge-s", "road_3.png": "outer-corner-sw",
  "road_4.png": "inner-corner-w", "road_5.png": "center", "road_6.png": "edge-w",
  "road_7.png": "edge-n", "road_8.png": "edge-n",
  "road_9.png": "outer-corner-nw", "road_10.png": "outer-corner-nw",
  "road_11.png": "center-variant", "road_12.png": "outer-corner-sw", "road_13.png": "outer-corner-se",
};
// VoidDesert set (26 tiles) — visually read in this recovery pass.
const VD_VISUAL = {
  "road_1.png": "outer-corner-se", "road_2.png": "inner-corner-n", "road_3.png": "outer-corner-sw",
  "road_4.png": "inner-corner-w", "road_5.png": "center", "road_6.png": "inner-corner-e",
  "road_7.png": "outer-corner-ne", "road_8.png": "inner-corner-s", "road_9.png": "outer-corner-nw",
  "road_10.png": "center-variant", "road_11.png": "center-variant", "road_12.png": "center-variant",
  "road_13.png": "center-variant", "road_14.png": "outer-corner-se", "road_15.png": "inner-corner-n",
  "road_16.png": "outer-corner-sw", "road_17.png": "inner-corner-w", "road_18.png": "center-variant",
  "road_19.png": "inner-corner-e", "road_20.png": "edge-n", "road_21.png": "inner-corner-s",
  "road_22.png": "outer-corner-nw", "road_23.png": "center-variant", "road_24.png": "center-variant",
  "road_25.png": "center-variant", "road_26.png": "center-variant",
};

function census(roleMap) {
  const m = {};
  for (const [file, role] of Object.entries(roleMap)) (m[role] = m[role] || []).push(file);
  return m;
}

async function main() {
  const load = async (dir, names) => {
    const out = [];
    for (const file of names) {
      const img = decodePng(await readFile(join(dir, file)));
      out.push({ file, img, bytes: (await readFile(join(dir, file))).length });
    }
    return out;
  };
  const cvTiles = await load(CV_DIR, Object.keys(CV_VISUAL));
  const vdTiles = await load(VD_DIR, Object.keys(VD_VISUAL));

  const cvPathColor = dominantColors(cvTiles.find((t) => t.file === "road_5.png").img)[0].rgb.map(Math.round);
  const vdPathColor = dominantColors(vdTiles.find((t) => t.file === "road_5.png").img)[0].rgb.map(Math.round);
  const familyDist = colorDist(cvPathColor, vdPathColor);
  const sameFamily = familyDist < 120;

  const cvCensus = census(CV_VISUAL);
  const vdCensus = census(VD_VISUAL);

  // missing roles in CloverVillage
  const cvMissing = ALL_ROLES.filter((r) => !cvCensus[r] || cvCensus[r].length === 0);

  // recovery candidates: for each missing CV role, VoidDesert tiles of that role
  const recovery = {};
  for (const r of cvMissing) {
    recovery[r] = (vdCensus[r] || []).map((f) => ({
      file: f,
      source: "VoidDesert",
      sourcePath: `reference/assets/maps/VoidDesert/Map/PNG/${f}`,
      url: `https://pawsandparcels.agpstudios.org/reference/assets/maps/VoidDesert/Map/PNG/${f}`,
    }));
  }
  const recoverable = Object.values(recovery).filter((a) => a.length > 0).length;
  const unrecoverable = cvMissing.filter((r) => !recovery[r] || recovery[r].length === 0);

  // duplicate check within CloverVillage (pixel comparison)
  const dupPairs = [["road_7.png", "road_8.png"], ["road_1.png", "road_13.png"], ["road_3.png", "road_12.png"], ["road_9.png", "road_10.png"]];
  const variants = [];
  for (const [a, b] of dupPairs) {
    const ia = cvTiles.find((t) => t.file === a).img;
    const ib = cvTiles.find((t) => t.file === b).img;
    let diff = 0, total = 0;
    for (let i = 0; i < ia.data.length; i += ia.channels) {
      total++;
      if (Math.abs(ia.data[i] - ib.data[i]) + Math.abs(ia.data[i + 1] - ib.data[i + 1]) + Math.abs(ia.data[i + 2] - ib.data[i + 2]) > 24) diff++;
    }
    variants.push({ a, b, identical: diff === 0, diffPercent: (100 * diff / total).toFixed(1) });
  }

  // cross-pack identical check
  const crossMatches = [];
  for (const cv of cvTiles) for (const vd of vdTiles) {
    if (cv.img.width !== vd.img.width || cv.img.height !== vd.img.height) continue;
    let diff = 0, total = 0;
    for (let i = 0; i < cv.img.data.length; i += cv.img.channels) {
      total++;
      if (Math.abs(cv.img.data[i] - vd.img.data[i]) + Math.abs(cv.img.data[i + 1] - vd.img.data[i + 1]) + Math.abs(cv.img.data[i + 2] - vd.img.data[i + 2]) > 24) diff++;
    }
    if (diff === 0) crossMatches.push({ cvFile: cv.file, vdFile: vd.file });
  }

  const verdict = sameFamily && unrecoverable.length === 0
    ? "FULL RECOVERY — VoidDesert supplies every missing role in the same visual family."
    : sameFamily
      ? `PARTIAL RECOVERY — same visual family; ${recoverable}/${cvMissing.length} missing roles recoverable. Still absent: ${unrecoverable.map((r) => ROLE_LABEL[r]).join(", ")}`
      : "NO RECOVERY — VoidDesert is a different visual family; do not mix tiles.";

  const result = {
    pack: "CloverVillage",
    family: "earthen_vine_path",
    status: "INCOMPLETE AUTOTILE KIT",
    comparison: {
      cloverVillagePathColor: cvPathColor,
      voidDesertPathColor: vdPathColor,
      colorDistance: familyDist,
      sameVisualFamily: sameFamily,
      note: sameFamily
        ? "VoidDesert road kit shares the same earthen path color family — tiles are visually compatible for cross-pack recovery."
        : "VoidDesert path color differs significantly — NOT the same visual family.",
    },
    cloverVillage: {
      tileCount: cvTiles.length,
      roles: CV_VISUAL,
      census: cvCensus,
      missingRoles: cvMissing,
      duplicateCandidates: variants,
    },
    voidDesert: {
      tileCount: vdTiles.length,
      roles: VD_VISUAL,
      census: vdCensus,
    },
    recoveryCandidates: recovery,
    recoverableRoleCount: recoverable,
    stillMissingRoles: unrecoverable,
    crossPackPixelIdentical: crossMatches,
    verdict,
    note: "Source paths remain untouched — this is catalog-level comparison only. Copying VoidDesert tiles into the CloverVillage runtime is a game-content decision and must not happen until reviewed. Candidate canonical names should use the candidate_ prefix (e.g. road_earthen_vine_candidate_edge_n_a) until the recovered kit is confirmed side-by-side.",
  };

  const outDir = join(root, "design", "assets");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "road-kit-recovery.json"), JSON.stringify(result, null, 2), "utf8");
  console.log("Wrote design/assets/road-kit-recovery.json");
  console.log(`Path colors: CV rgb(${cvPathColor.join(",")}) vs VD rgb(${vdPathColor.join(",")}) — distance ${familyDist}, sameFamily=${sameFamily}`);
  console.log(`\nCV missing roles (${cvMissing.length}):`);
  for (const r of cvMissing) {
    const cands = (recovery[r] || []).map((c) => c.file).join(", ") || "NOT FOUND in VoidDesert";
    console.log(`  ${ROLE_LABEL[r]}: ${cands}`);
  }
  console.log(`\nCV duplicate candidates:`);
  for (const v of variants) console.log(`  ${v.a} vs ${v.b}: ${v.identical ? "IDENTICAL" : `true variant (${v.diffPercent}% pixels differ)`}`);
  console.log(`\nCross-pack pixel-identical: ${crossMatches.length ? crossMatches.map((m) => `${m.cvFile}=${m.vdFile}`).join(", ") : "none"}`);
  console.log(`\nVerdict: ${verdict}`);

  // ---- recovery preview HTML ----
  const vdBase = "https://pawsandparcels.agpstudios.org/reference/assets/maps/VoidDesert/Map/PNG";
  const cvBase = "https://pawsandparcels.agpstudios.org/reference/assets/maps/CloverVillage/Map/PNG/road";

  const roleStrip = (role, files, base) => `
    <div class="role-group ${files.length ? "" : "missing"}">
      <div class="role-name">${ROLE_LABEL[role] ?? role}</div>
      <div class="role-tiles">${files.length
        ? files.map((f) => `<div class="tile"><img src="${base}/${f}" alt="${f}" title="${f}"><div class="tname">${f}</div></div>`).join("")
        : "<span class='none'>— not in pack —</span>"}</div>
    </div>`;

  const cvCards = ALL_ROLES.map((r) => roleStrip(r, cvCensus[r] || [], "CloverVillage"));
  const vdCards = ALL_ROLES.map((r) => roleStrip(r, vdCensus[r] || [], "VoidDesert"));

  const recTable = ALL_ROLES.filter((r) => cvMissing.includes(r)).map((r) => {
    const cands = recovery[r] || [];
    return `<tr><td>${ROLE_LABEL[r]}</td><td>${cands.length
      ? cands.map((c) => `<div class="tile-inline"><img src="${c.url}" alt="${c.file}" title="${c.file}"><span>${c.file}</span></div>`).join("")
      : "<span class='none'>not in VoidDesert either</span>"}</td></tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Road Kit Recovery — CloverVillage × VoidDesert</title>
<style>
  body { font-family: system-ui; max-width: 1200px; margin: 1.5rem auto; padding: 0 1rem; color: #263228; background: #f3f7f1; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 1.75rem; }
  .banner { padding: 0.8rem 1rem; border-radius: 8px; font-weight: 600; margin-bottom: 1rem; }
  .banner.ok { background: #e8f5e9; border: 1px solid #a5d6a7; color: #1b5e20; }
  .banner.warn { background: #fff3e0; border: 1px solid #ffcc80; color: #e65100; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .role-group { background: #fff; border: 1px solid #d9e3d7; border-radius: 8px; padding: 0.6rem; margin-bottom: 0.6rem; }
  .role-group.missing { border-color: #ef9a9a; background: #fff5f5; }
  .role-name { font-weight: 700; font-size: 0.8rem; margin-bottom: 0.4rem; }
  .role-tiles { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .tile { text-align: center; }
  .tile img, .tile-inline img { width: 64px; height: 64px; image-rendering: pixelated; background: repeating-conic-gradient(#e8ede6 0% 25%, #fff 0% 50%) 50%/16px 16px; border-radius: 4px; }
  .tname { font-size: 0.6rem; color: #68766b; }
  .none { font-size: 0.75rem; color: #b71c1c; font-style: italic; }
  .note { font-size: 0.85rem; color: #68766b; }
  table.data { border-collapse: collapse; font-size: 0.8rem; width: 100%; }
  table.data td, table.data th { border: 1px solid #d9e3d7; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  .tile-inline { display: inline-flex; align-items: center; gap: 0.4rem; margin: 0.2rem 0.4rem 0.2rem 0; }
  .tile-inline span { font-size: 0.7rem; }
  .pill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
  .pill.yes { background: #e8f5e9; color: #1b5e20; } .pill.no { background: #ffebee; color: #b71c1c; }
</style>
</head>
<body>
<h1>Road Kit Recovery Pass — CloverVillage × VoidDesert</h1>
<div class="banner ${sameFamily && unrecoverable.length === 0 ? "ok" : "warn"}">${verdict}</div>
<div class="note">Status: <b>INCOMPLETE AUTOTILE KIT</b>. Path color distance <b>${familyDist}</b> (CV rgb(${cvPathColor.join(",")}) vs VD rgb(${vdPathColor.join(",")})) — same visual family: <span class="pill ${sameFamily ? "yes" : "no"}">${sameFamily ? "YES" : "NO"}</span>. No source files were copied or renamed; this is a catalog-level comparison.</div>

<h2>Recovery candidates — missing CloverVillage roles</h2>
<table class="data">
<tr><th>Missing role</th><th>VoidDesert candidate tile(s)</th></tr>
${recTable}
</table>

<h2>Role coverage — CloverVillage (13 tiles)</h2>
<div class="cols"><div>${cvCards.join("")}</div></div>

<h2>Role coverage — VoidDesert (26 tiles)</h2>
<div class="cols"><div>${vdCards.join("")}</div></div>

<p class="note">Source paths are untouched — this is catalog-level comparison only. Generated by <code>Asset Catalog/recover-road-kit.mjs</code>.</p>
</body>
</html>
`;

  const previewDir = join(root, "deploy", "asset-catalog", "autotile");
  await mkdir(previewDir, { recursive: true });
  await writeFile(join(previewDir, "recovery.html"), html, "utf8");
  console.log("Wrote deploy/asset-catalog/autotile/recovery.html");
}

main().catch((e) => { console.error(e); process.exit(1); });
