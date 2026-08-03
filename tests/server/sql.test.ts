import { describe, expect, it } from "vitest";
import { splitStatements } from "../../server/src/db/sql.ts";

describe("splitStatements", () => {
  it("splits multiple statements on semicolons", () => {
    const sql = "CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);";
    expect(splitStatements(sql)).toHaveLength(2);
  });

  it("strips full-line comments without swallowing the following statement", () => {
    const sql = [
      "-- header comment",
      "CREATE TABLE accounts (",
      "  id INT",
      ");",
      "-- trailing comment",
    ].join("\n");
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TABLE accounts");
    expect(statements[0]).not.toContain("--");
  });

  it("keeps a comment separated from the statement it precedes intact", () => {
    // The historical bug: a chunk starting with a comment line was dropped.
    const sql = "-- 1. accounts\nCREATE TABLE accounts (id INT);";
    expect(splitStatements(sql)).toEqual(["CREATE TABLE accounts (id INT)"]);
  });

  it("ignores blank lines and whitespace-only statements", () => {
    const sql = "\n\n  \nSELECT 1;\n\n;\nSELECT 2;";
    expect(splitStatements(sql)).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("handles a migration file with a box-drawing banner comment", () => {
    const sql =
      "-- ═══════════════════\n" +
      "-- Phase 2 banner text\n" +
      "-- ═══════════════════\n" +
      "ALTER TABLE accounts ADD COLUMN x INT;";
    expect(splitStatements(sql)).toEqual([
      "ALTER TABLE accounts ADD COLUMN x INT",
    ]);
  });
});
