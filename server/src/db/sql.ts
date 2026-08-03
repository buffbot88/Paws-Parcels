/**
 * Split a migration file's text into individual SQL statements.
 *
 * Migration files use `--` full-line comments. Each statement is terminated
 * by a semicolon. We strip comment lines *before* splitting so a comment
 * never glues itself onto the next statement (the old inline filter could
 * silently drop a CREATE TABLE whose chunk started with a comment line).
 */
export function splitStatements(content: string): string[] {
  const withoutComments = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .join("\n");

  return withoutComments
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}
