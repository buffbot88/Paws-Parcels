import { describe, expect, it } from "vitest";

// The Roles & Permissions matrix renders one column per permission the server
// advertises (ALL_PERMISSIONS) and labels it with the panel's curated map.
// These two lists live in different layers, so nothing but this test stops a
// newly added permission from shipping as a raw snake_case column header.
import { ALL_PERMISSIONS } from "../../server/src/models/Admin.ts";
import { permissionLabel } from "../../src/admin/screens/roles.ts";

describe("permission matrix labels", () => {
  it("labels every server permission for the matrix", () => {
    for (const permission of ALL_PERMISSIONS) {
      const label = permissionLabel(permission);
      expect(label).not.toBe(permission);
      expect(label).not.toContain("_");
      expect(label.trim().length).toBeGreaterThan(0);
      // Title-cased: first character of the label is uppercase.
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("keeps the curated labels for the spec §71 permissions", () => {
    expect(permissionLabel("view_players")).toBe("View Players");
    expect(permissionLabel("ban_player")).toBe("Ban Player");
    expect(permissionLabel("edit_inventory")).toBe("Edit Inventory");
    expect(permissionLabel("edit_items")).toBe("Edit Items");
    expect(permissionLabel("manage_roles")).toBe("Manage Roles");
    expect(permissionLabel("server_settings_limited")).toBe("Server Settings (limited)");
  });

  it("title-cases an uncurated permission instead of leaking the raw key", () => {
    expect(permissionLabel("edit_zones")).toBe("Edit Zones");
    expect(permissionLabel("publish_dungeons")).toBe("Publish Dungeons");
  });
});
