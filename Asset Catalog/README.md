# Legacy Asset Catalog

> The deployed output under `deploy/asset-catalog/` is generated. Edit these source templates or the metadata under `design/assets/`, then run `npm run assets:catalog`; do not hand-edit generated deployment files.

The public asset catalog is now `/BrowseAssets`. This older local review tool remains for internal visual auditing only; do not publish it as the crawler-facing catalog.

This folder contains the local visual review website for the ignored art archive.

## Open it

Start the Vite development server from the repository root:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173/BrowseAssets/
```

The site loads the tracked metadata from `design/assets/asset-inventory.json` and resolves image previews from the local ignored archive at `reference/assets/`. The source art is intentionally not copied into this folder or committed to Git.

## Review workflow

- Use category buttons to narrow the archive.
- Search paths and filenames instead of guessing from memory.
- Filter `Needs classification` to inspect the 18 unnamed Clover Village decor assets.
- Filter `Not yet cataloged` to inspect the Happy Valley NPC and Void Desert monster packs.
- Open any card for a larger preview and metadata.
- Save suggested classifications and notes locally in browser storage.
- Use **Export review notes** to download `asset-review-notes.json` for a later catalog update.

The review controls are advisory only. They do not modify source assets, runtime imports, map data, or tracked catalogs.
