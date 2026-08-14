# Asset Reference Archive

The original art packs live locally under `reference/assets/` and are intentionally ignored by Git. They are reference material rather than authored game content; selected files are still required locally when building the client with the authored art pass.

A fresh checkout can run the game with its fallback visuals, but it will not include the selected art until the local reference archive is restored.

The client queues only a curated subset through the explicit `import.meta.glob` rules in:

- `src/game/classAssets.ts`
- `src/game/cloverVillageAssets.ts`
- `src/game/cloverVillageNpcAssets.ts`

The generated [`asset-inventory.json`](./asset-inventory.json) records every file in the local archive and classifies it as:

- `runtime-used` — currently matched by a runtime asset rule
- `reference-only` — available for future selection but not currently queued by the client

Regenerate the inventory after adding, removing, or selecting art:

```bash
npm run assets:inventory
```

The inventory is tracked so asset decisions remain reviewable even though the source art itself stays local and ignored. Do not add files from `reference/assets/` to Git unless the asset-storage policy changes deliberately.
