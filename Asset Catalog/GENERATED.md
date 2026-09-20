# Generated deployment output

This directory contains the local source templates and generators for the deployed asset catalog.

- `build-standalone.mjs` builds `deploy/asset-catalog/`.
- `generate-api.mjs` builds the catalog API, review pages, contact sheets, and previews.
- `index.html`, `styles.css`, and `catalog.js` are source templates used by the standalone build.

Do not edit `deploy/asset-catalog/` manually. Change the source templates or metadata under `design/assets/`, then run:

```bash
npm run assets:catalog
```

Visual output still requires browser/visual verification.
