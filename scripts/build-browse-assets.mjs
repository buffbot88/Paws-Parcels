import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "deploy", "BrowseAssets");
const base = "https://pawsandparcels.agpstudios.org";
const sourcePrefix = "reference/assets/";
const entries = [
  ["post-office-sign.png", "Post Office Sign", "Pip's storefront identifier."],
  ["cafe-sign.png", "Café Sign", "Cup/mug and pastry storefront motif."],
  ["florist-sign.png", "Florist Sign", "Flower/bouquet storefront motif."],
  ["research-shop-sign.png", "Research / Shop Sign", "Research-shop identifier for Lumi."],
  ["courier-banner.png", "Courier Banner", "Reusable around the Post Office and route."],
  ["parcels.png", "Outdoor Parcel Stack", "Crates, wrapped boxes, and mail sacks."],
  ["flower-front.png", "Flower Display", "Exterior display for Maple."],
  ["cafe-front.png", "Outdoor Café Display", "Exterior table/display for Biscuit."],
  ["research-table.png", "Research Table", "Research prop cluster for Lumi."],
  ["garden-prop.png", "Garden Prop Cluster", "Watering can, tools, and produce basket for Moss."],
  ["hollow-oak.png", "Hollow Oak Landmark", "Larger quest-critical landmark; deferred from the smaller building identifiers."],
];
const inventory = JSON.parse(await readFile(join(root, "design", "assets", "asset-inventory.json"), "utf8"));
const byPath = new Map(inventory.files.map((file) => [file.path, file]));
const assets = entries.map(([filename, name, description]) => {
  const path = `${sourcePrefix}new/CloverValley/Buildings/${filename}`;
  const file = byPath.get(path);
  if (!file) throw new Error(`Missing inventory entry: ${path}`);
  return { id: path.replaceAll("/", "_").replaceAll(".", "_"), name, filename, description, path, imageUrl: `${base}/${path}`, category: filename === "hollow-oak.png" ? "landmark" : "building-identifier", width: file.width, height: file.height, bytes: file.bytes, status: file.status };
});
const index = { schemaVersion: 1, title: "Paws & Parcels Asset Catalog", total: assets.length, pageSize: 11, pages: ["/BrowseAssets/api/clover-valley.json"], assets: assets.map(({ id, name, filename, description, category }) => ({ id, name, filename, description, category, detail: `/BrowseAssets/api/asset/${id}.json` })) };
await mkdir(join(out, "api", "asset"), { recursive: true });
await writeFile(join(out, "api", "index.json"), `${JSON.stringify(index, null, 2)}\n`);
await writeFile(join(out, "api", "clover-valley.json"), `${JSON.stringify({ ...index, assets }, null, 2)}\n`);
await writeFile(join(out, "api", "packs.json"), `${JSON.stringify({ packs: [{ name: "CloverValley", total: assets.length, catalog: "/BrowseAssets/api/clover-valley.json" }] }, null, 2)}\n`);
for (const asset of assets) await writeFile(join(out, "api", "asset", `${asset.id}.json`), `${JSON.stringify(asset, null, 2)}\n`);
const html = await readFile(join(root, "BrowseAssets.html"), "utf8");
await writeFile(join(out, "index.html"), html);
console.log(`Generated BrowseAssets: ${assets.length} assets`);
