/**
 * Admin Control Panel backend surface. Tier mapping + audit live in
 * models/Admin.ts; HTTP handlers live in routes/admin.ts. This barrel keeps
 * import sites short.
 */
export {
  adminTierForRole,
  tierSatisfies,
  actorHasPermission,
  tierHasPermission,
  writeAuditLog,
  getAuditEntry,
  listAdminRoles,
  getRolePermissions,
  getAssignedRoles,
  setRoleAssignment,
  updateRolePermissions,
  getServerSettings,
  setServerSetting,
  validateSettingValue,
  ALL_PERMISSIONS,
  type AdminActor,
  type AdminPermission,
  type AdminRoleRow,
  type AdminTier,
} from "../models/Admin.ts";
export {
  adminOverviewHandler,
  adminHealthHandler,
  adminZoneStatusHandler,
  adminPlayersHandler,
  adminPlayerDetailHandler,
  adminPlayerStatusHandler,
  adminGrantItemHandler,
  adminAdjustHandler,
  adminTeleportHandler,
  adminKickHandler,
  adminInventoryHandler,
  adminAuditHandler,
  adminSettingsHandler,
  adminTierHandler,
  adminRolesHandler,
  adminRolePermissionsHandler,
  adminRoleAssignmentsHandler,
  adminUsersHandler,
  setAdminRuntime,
  type AdminRuntime,
} from "../routes/admin.ts";
