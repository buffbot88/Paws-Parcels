import { describe, expect, it } from "vitest";
import * as adminRoutes from "../../server/src/routes/admin/index.ts";

const expectedHandlers = [
  "adminOverviewHandler",
  "adminHealthHandler",
  "adminZoneStatusHandler",
  "setAdminRuntime",
  "adminPlayersHandler",
  "adminPlayerDetailHandler",
  "adminPlayerStatusHandler",
  "adminGrantItemHandler",
  "adminAdjustHandler",
  "adminTeleportHandler",
  "adminKickHandler",
  "adminInventoryHandler",
  "adminAuditHandler",
  "adminSettingsHandler",
  "adminTierHandler",
  "adminStepUpHandler",
  "adminRolesHandler",
  "adminRolePermissionsHandler",
  "adminRoleAssignmentsHandler",
  "adminUsersHandler",
  "adminItemsHandler",
  "adminItemsMetaHandler",
  "adminItemCreateHandler",
  "adminItemUpdateHandler",
  "adminItemDuplicateHandler",
  "adminItemArchiveHandler",
  "adminItemRestoreHandler",
] as const;

describe("admin route module boundary", () => {
  it("exports every handler registered by the API router", () => {
    for (const name of expectedHandlers) {
      expect(adminRoutes[name]).toEqual(expect.any(Function));
    }
  });
});
