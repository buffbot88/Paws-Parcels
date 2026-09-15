/** Admin Users screen (spec §70): admin directory + role assignment. */

import { api, type AdminUserRow, type RolesResponse } from "../api.ts";
import { el, clear, skeletonTable, formatWhen, toast, confirmModal } from "../ui.ts";

export function renderAdminUsers(content: HTMLElement): void {
  content.append(
    el("h1", { class: "admin-page-title" }, "Admin Users"),
    el("p", { class: "admin-page-sub" }, "Accounts with panel access. Hub roles set the baseline tier; assigned roles add permissions."),
  );

  const wrap = el("div", { class: "admin-table-wrap" }, skeletonTable(5));
  content.append(wrap);

  let rolesData: RolesResponse | null = null;

  void Promise.all([
    api.get<{ admins: AdminUserRow[]; callerAccountId: number }>("/api/admin/admin-users"),
    api.get<RolesResponse>("/api/admin/roles"),
  ]).then(([users, roles]) => {
    rolesData = roles;
    clear(wrap);
    if (users.admins.length === 0) {
      wrap.append(el("div", { class: "admin-empty" }, "No admin accounts found."));
      return;
    }
    const canManage = roles.caller.canManageRoles;
    const table = el("table", { class: "admin-table" });
    table.append(
      el(
        "thead",
        {},
        el("tr", {}, th("Admin"), th("Hub Role"), th("Tier"), th("Status"), th("Assigned Roles"), th("Last Login"), th("Actions")),
      ),
    );
    const tbody = el("tbody");
    for (const admin of users.admins) {
      const isSelf = admin.accountId === users.callerAccountId;
      tbody.append(buildUserRow(admin, isSelf, canManage, roles, () => void reload(content)));
    }
    table.append(tbody);
    wrap.append(table);
  }).catch((err: unknown) => {
    clear(wrap);
    wrap.append(el("div", { class: "admin-empty" }, err instanceof Error ? err.message : "Failed to load admin users."));
  });
}

function reload(content: HTMLElement): void {
  clear(content);
  renderAdminUsers(content);
}

function buildUserRow(
  admin: AdminUserRow,
  isSelf: boolean,
  canManage: boolean,
  roles: RolesResponse,
  onChanged: () => void,
): HTMLElement {
  const row = el("tr", {});
  row.append(
    el("td", {}, el("strong", {}, admin.displayName), el("div", { style: "font-size:12px; color:var(--adm-text-3)" }, `@${admin.username} · #${admin.accountId}`)),
    el("td", {}, admin.hubRole),
    el("td", {}, el("span", { class: "admin-topbar__tier" }, admin.tier)),
    el("td", {}, admin.status),
    el("td", { style: "font-size:12.5px" }, admin.assignedRoles.length === 0 ? "—" : admin.assignedRoles.join(", ")),
    el("td", {}, formatWhen(admin.lastLoginAt)),
  );
  const actions = el("td", {});
  if (isSelf) {
    actions.append(el("span", { style: "color:var(--adm-text-3); font-size:12px" }, "you"));
  } else if (canManage) {
    actions.append(el("button", { type: "button", class: "admin-btn admin-btn--sm", onclick: () => openAssignModal(admin, roles, onChanged) }, "Assign Role"));
  }
  row.append(actions);
  return row;
}

function openAssignModal(admin: AdminUserRow, roles: RolesResponse, onChanged: () => void): void {
  document.querySelector(".admin-modal-backdrop")?.remove();
  const backdrop = el("div", { class: "admin-modal-backdrop" });
  const modal = el("div", { class: "admin-modal" });
  modal.append(
    el("h2", { class: "admin-modal__title" }, `Assign role — ${admin.displayName}`),
    el("p", { class: "admin-modal__body" }, `Current: ${admin.assignedRoles.length === 0 ? "none" : admin.assignedRoles.join(", ")}. Hub tier "${admin.tier}" always applies; assigned roles only add permissions.`),
  );
  const roleSelect = el("select", { class: "admin-select", style: "width:100%" }) as HTMLSelectElement;
  for (const role of roles.roles) {
    roleSelect.append(el("option", { value: role.roleKey }, `${role.displayName} (${role.roleKey})`));
  }
  const assignBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary" }, "Assign");
  const revokeBtn = el("button", { type: "button", class: "admin-btn admin-btn--danger" }, "Revoke");

  const reasonFor = (action: string): string => `${action} ${roleSelect.value} for ${admin.username} via Admin Users screen`;

  assignBtn.addEventListener("click", () => {
    const roleKey = roleSelect.value;
    confirmModal({
      title: `Assign "${roleKey}"?`,
      body: `${admin.displayName} gains every permission held by that role.`,
      onConfirm: () => {
        void api.put(`/api/admin/roles/assignments/${admin.accountId}`, { add: roleKey, reason: reasonFor("Assign") })
          .then(() => { toast("Role assigned.", "success"); onChanged(); })
          .catch((err: unknown) => toast(err instanceof Error ? err.message : "Assignment failed.", "error"));
      },
    });
  });
  revokeBtn.addEventListener("click", () => {
    const roleKey = roleSelect.value;
    if (!admin.assignedRoles.includes(roleKey)) {
      toast(`${admin.displayName} does not hold that role.`, "warning");
      return;
    }
    confirmModal({
      title: `Revoke "${roleKey}"?`,
      body: `${admin.displayName} loses that role's permissions immediately.`,
      danger: true,
      onConfirm: () => {
        void api.put(`/api/admin/roles/assignments/${admin.accountId}`, { remove: roleKey, reason: reasonFor("Revoke") })
          .then(() => { toast("Role revoked.", "success"); onChanged(); })
          .catch((err: unknown) => toast(err instanceof Error ? err.message : "Revocation failed.", "error"));
      },
    });
  });

  modal.append(
    el("label", { style: "display:flex; flex-direction:column; gap:4px; font-size:12px; font-weight:600; color:var(--adm-text-2); margin-bottom:14px" }, "Role", roleSelect),
    el(
      "div",
      { class: "admin-modal__actions" },
      el("button", { type: "button", class: "admin-btn", onclick: () => backdrop.remove() }, "Close"),
      revokeBtn,
      assignBtn,
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
}

function th(text: string): HTMLElement {
  return el("th", { class: "no-sort" }, text);
}
