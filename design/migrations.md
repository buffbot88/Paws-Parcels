# Database Migration Policy

Historical migrations are immutable. Do not rename, rewrite, reorder, or delete an applied migration; migration filenames are part of the database history.

The repository intentionally contains two distinct historical migrations with a `005_` prefix:

- `005_clover_village_200x200.sql`
- `005_persistent_courier_state.sql`

Their complete filenames are distinct migration identifiers, so both must remain unchanged. The next migration after `016_item_editor.sql` must use the unique increasing prefix `017`.

## Checksums

New migration records in `schema_version.checksum` use a SHA-256 digest of the migration file contents. Existing databases may contain the historical decimal file-length checksum format; those rows remain compatible and are not rewritten by the migration runner.

Static catalogs remain authored in `src/data/*.json`. Migrations define schema and player-state compatibility; `syncStaticContent()` materializes the catalogs after migrations complete.

## Testing

Fresh-database migration coverage must use a temporary or in-memory SQLite database. Never run migration tests against a developer or production database.
