/** Roles & Permissions screen (spec §70–71): permission matrix per role. */

import { api, type RolesResponse, type AdminRole } from "../api.ts";
import { el, clear, skeletonTable, toast, confirmModal } from "../ui.ts";

/** Curated column labels for the matrix (keys come from ALL_PERMISSIONS). */
const PERMISSION_LABELS: Record<string, string> = {
  view_players: "View Players",
  ban_player: "Ban Player",
  edit_inventory: "Edit Inventory",
  edit_items: "Edit Items",
  edit_quests: "Edit Quests",
  publish_quests: "Publish Quests",
  publish_quests_limited: "Publish Quests (limited)",
  server_settings: "Server Settings",
  server_settings_limited: "Server Settings (limited)",
  edit_market: "Edit Market",
  manage_roles: "Manage Roles",
};

/**
 * Human label for a permission key. Falls back to title-casing the key so a
 * newly added server permission renders as "Edit Something" instead of the raw
 * snake_case key until someone curates a label for it.
 */
export function permissionLabel(permission: string): string {
  return (
    PERMISSION_LABELS[permission] ??
    permission
      .split("_")
      .map((word) => (word === "" ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ")
  );
}

export function renderRoles(content: HTMLElement): void {
  content.append(
    el("h1", { class: "admin-page-title" }, "Roles & Permissions"),
    el("p", { class: "admin-page-sub" }, "Default roles from the operations spec with a per-role permission matrix. Changes are audited."),
  );

  const wrap = el("div", { class: "admin-table-wrap" }, skeletonTable(6));
  content.append(wrap);

  void api.get<RolesResponse>("/api/admin/roles").then((data) => {
    clear(wrap);
    if (data.roles.length === 0) {
      wrap.append(el("div", { class: "admin-empty" }, "No roles configured."));
      return;
    }
    const canManage = data.caller.canManageRoles;
    const table = el("table", { class: "admin-table" });
    const thead = el("thead", {}, el("tr", {}, th("Role"), th("Description"), th("Tier floor"), th("Members"), ...data.allPermissions.map((p) => th(permissionLabel(p)))));
    table.append(thead);
    const tbody = el("tbody");
    for (const role of data.roles) {
      tbody.append(buildRoleRow(role, data, canManage, () => void reload(content)));
    }
    table.append(tbody);
    wrap.append(table);

    if (!canManage) {
      content.append(el("p", { class: "admin-form-hint", style: "margin-top:12px" }, "You have view-only access to the matrix — the manage_roles permission is required to edit it."));
    }
  }).catch((err: unknown) => {
    clear(wrap);
    wrap.append(el("div", { class: "admin-empty" }, err instanceof Error ? err.message : "Failed to load roles."));
  });
}

function reload(content: HTMLElement): void {
  clear(content);
  renderRoles(content);
}

function buildRoleRow(role: AdminRole, data: RolesResponse, canManage: boolean, onChanged: () => void): HTMLElement {
  const row = el("tr", { "data-role-key": role.roleKey });
  row.append(
    el("td", {}, el("strong", {}, role.displayName), role.isSystem ? el("span", { class: "admin-topbar__tier", style: "margin-left:6px" }, "system") : null),
    el("td", { style: "color:var(--adm-text-2); font-size:12.5px" }, role.description),
    el("td", {}, role.minTier),
    el("td", {}, String(role.assignedCount)),
  );
  for (const permission of data.allPermissions) {
    const held = role.permissions.includes(permission);
    const cell = el("td", { style: "text-align:center" });
    if (canManage) {
      const checkbox = el("input", { type: "checkbox", "aria-label": `${role.displayName}: ${permissionLabel(permission)}` }) as HTMLInputElement;
      checkbox.checked = held;
      checkbox.addEventListener("change", () => {
        const next = role.permissions.includes(permission)
          ? role.permissions.filter((p) => p !== permission)
          : [...role.permissions, permission];
        openMatrixConfirm(role, permission, checkbox.checked, next, onChanged);
        // Revert the checkbox until the change actually lands.
        checkbox.checked = held;
      });
      cell.append(checkbox);
    } else {
      cell.append(el("span", { style: held ? "color:var(--adm-green); font-weight:700" : "color:var(--adm-text-3)" }, held ? "✓" : "—"));
    }
    row.append(cell);
  }
  return row;
}

function openMatrixConfirm(role: AdminRole, permission: string, granting: boolean, nextPermissions: string[], onChanged: () => void): void {
  const verb = granting ? "Grant" : "Revoke";
  confirmModal({
    title: `${verb} "${permissionLabel(permission)}"?`,
    body: `${granting ? "Add to" : "Remove from"} role "${role.displayName}" (${role.assignedCount} member${role.assignedCount === 1 ? "" : "s"}). The change is audited and applies immediately.`,
    confirmLabel: verb,
    onConfirm: () => {
      void api.put(`/api/admin/roles/${role.roleKey}`, { permissions: nextPermissions, reason: `${verb} ${permission} for ${role.displayName} via permission matrix` })
        .then(() => {
          toast(`Role "${role.displayName}" updated.`, "success");
          onChanged();
        })
        .catch((err: unknown) => toast(err instanceof Error ? err.message : "Matrix update failed.", "error"));
    },
  });
}

function th(text: string): HTMLElement {
  return el("th", { class: "no-sort" }, text);
}
