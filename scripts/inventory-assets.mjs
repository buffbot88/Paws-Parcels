#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const referenceRoot = join(root, "reference", "assets");
const outputPath = join(root, "design", "assets", "asset-inventory.json");

const usedRules = [
  { label: "class idle rotations", test: /^Classes\/(Archer|Mage|Warrior)\/Idle\/rotations\/[^/]+\.png$/i },
  { label: "class combat animations", test: /^Classes\/(Archer|Mage|Warrior)\/Idle\/animations\/(Walk|Lead_Jab|Falling_Back_Death)\/.*\.png$/i },
  { label: "archer fire-arrow effect", test: /^Classes\/Archer\/AttackEffects\/Fire Arrow\/PNG\/.*\.png$/i },
  { label: "mage fire-ball effect", test: /^Classes\/Mage\/AttackEffects\/Fire Ball\/PNG\/.*\.png$/i },
  { label: "warrior attack effect", test: /^Classes\/Warrior\/AttackEffects\/PNG\/1\/.*\.png$/i },
  { label: "Clover Village surface/decor", test: /^maps\/CloverVillage\/Map\/PNG\/(land\/land_1|road\/road_5|decor\/(greenery_[123]|stones_[123]|tree_[12]))\.png$/i },
  { label: "Clover Village buildings", test: /^maps\/CloverVillage\/Map\/PNG\/buildings\/building_(1|4|5|10|12|14)\/building_1\.png$/i },
  { label: "Clover Village NPC idle frames", test: /^maps\/CloverVillage\/NPC\/(Artist|Astrologer|Citizen)\/PNG\/Front\/PNG Sequences\/Idle\/.*\.png$/i },
];

async function walk(directory, entries = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, entries);
    else entries.push(absolute);
  }
  return entries;
}

function dimensions(buffer, extension) {
  if (extension === ".png" && buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (extension === ".gif" && buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  return undefined;
}

function packFor(relativePath) {
  return relativePath.split("/")[0] ?? "unknown";
}

let absoluteFiles = [];
try {
  absoluteFiles = await walk(referenceRoot);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.warn(`Asset reference archive not found at ${relative(root, referenceRoot)}; writing an empty inventory.`);
}
const files = [];
for (const absolute of absoluteFiles.sort()) {
  const relativePath = posix.join(...relative(referenceRoot, absolute).split("\\"));
  const extension = relativePath.includes(".") ? `.${relativePath.split(".").pop().toLowerCase()}` : "";
  const buffer = await readFile(absolute);
  const rule = usedRules.find((candidate) => candidate.test.test(relativePath));
  files.push({
    path: `reference/assets/${relativePath}`,
    pack: packFor(relativePath),
    extension,
    bytes: buffer.length,
    ...(dimensions(buffer, extension) ?? {}),
    status: rule === undefined ? "reference-only" : "runtime-used",
    ...(rule === undefined ? {} : { usedBy: rule.label }),
  });
}

const packs = [...new Set(files.map((file) => file.pack))].sort().map((pack) => {
  const entries = files.filter((file) => file.pack === pack);
  return {
    pack,
    files: entries.length,
    bytes: entries.reduce((sum, file) => sum + file.bytes, 0),
    runtimeUsed: entries.filter((file) => file.status === "runtime-used").length,
    referenceOnly: entries.filter((file) => file.status === "reference-only").length,
  };
});

const runtimeUsed = files.filter((file) => file.status === "runtime-used");
const referenceOnly = files.filter((file) => file.status === "reference-only");
const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRoot: "reference/assets",
  policy: {
    runtimeUsed: "Files matched by the explicit runtime asset rules in scripts/inventory-assets.mjs.",
    referenceOnly: "Files retained for future art selection and not currently queued by the client.",
    ignored: "The source asset archive is committed to the repository as reference material.",
  },
  summary: {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    runtimeUsed: runtimeUsed.length,
    runtimeUsedBytes: runtimeUsed.reduce((sum, file) => sum + file.bytes, 0),
    referenceOnly: referenceOnly.length,
    referenceOnlyBytes: referenceOnly.reduce((sum, file) => sum + file.bytes, 0),
  },
  packs,
  files,
};

await mkdir(join(root, "design", "assets"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
console.log(`Wrote ${relative(root, outputPath)} — ${files.length} files, ${runtimeUsed.length} runtime-used, ${referenceOnly.length} reference-only.`);
