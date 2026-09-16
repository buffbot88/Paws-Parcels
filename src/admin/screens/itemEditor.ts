/**
 * Item Editor screen (spec §26): the authoring form for one item.
 *
 * Saves are live for players — inventory presentation, equipped stats, loot
 * grants and quest rewards all read `item_definitions` — so every mutation
 * carries a required audit reason, and archiving is a Level 3 operation that
 * demands a typed confirmation plus a fresh step-up token (spec §72).
 */

import {
  api,
  stepUpHeaders,
  type ItemDetailResponse,
  type ItemInput,
  type ItemMeta,
  type ItemReferences,
  type ItemRow,
} from "../api.ts";
import {
  el,
  clear,
  skeletonCard,
  toast,
  formatWhen,
  confirmModal,
  typedConfirmModal,
  reAuthModal,
} from "../ui.ts";

const DEFAULT_META: ItemMeta = {
  categories: ["resource", "gift", "delivery", "quest", "cosmetic", "material", "equipment"],
  equipmentSlots: ["head", "body", "weapon", "accessory", "boots", "courier-bag"],
  rarities: ["common", "uncommon", "rare", "epic", "legendary"],
  statKeys: ["attack", "defense", "speed", "critChance", "critMultiplier"],
  courierEffectKeys: ["parcelCapacity", "movementBonus", "fragileProtection", "weatherProtection", "navigationBonus"],
  classes: [],
};

type NumericKey = "maxStack" | "value" | "requiredLevel";
type TextKey = "key" | "name" | "icon";

interface EditorState {
  key: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  rarity: string;
  maxStack: number;
  value: number;
  equipmentSlot: string;
  requiredClass: string;
  requiredLevel: number;
  stats: { key: string; value: number }[];
  courierEffects: { key: string; value: number }[];
}

/** `itemId` is undefined for the create screen (`#/items/new`). */
export function renderItemEditor(content: HTMLElement, itemId?: string): void {
  const creating = itemId === undefined;
  clear(content);
  content.append(el("div", { class: "admin-item-editor" }, skeletonCard()));
  void loadDetail();

  async function loadDetail(): Promise<void> {
    try {
      if (creating) {
        const res = await api.get<{ meta: ItemMeta; canEdit: boolean }>("/api/admin/items/meta");
        render(res.meta, null, null, res.canEdit);
      } else {
        const res = await api.get<ItemDetailResponse>(`/api/admin/items/${itemId}`);
        render(res.meta, res.item, res.references, res.canEdit);
      }
    } catch (err) {
      clear(content);
      content.append(
        el("div", { class: "admin-card" }, el("p", {}, err instanceof Error ? err.message : "Failed to load the item.")),
        el(
          "button",
          { type: "button", class: "admin-btn", style: "margin-top:12px", onclick: () => { window.location.hash = "#/items"; } },
          "← Back to Item Database",
        ),
      );
    }
  }

  function render(meta: ItemMeta, item: ItemRow | null, references: ItemReferences | null, canEdit: boolean): void {
    const state: EditorState = {
      key: item?.key ?? "",
      name: item?.name ?? "",
      icon: item?.icon ?? "",
      description: item?.description ?? "",
      category: item?.category ?? "material",
      rarity: item?.rarity ?? "common",
      maxStack: item?.maxStack ?? 1,
      value: item?.value ?? 0,
      equipmentSlot: item?.equipmentSlot ?? "head",
      requiredClass: item?.requiredClass ?? "",
      requiredLevel: item?.requiredLevel ?? 1,
      stats: Object.entries(item?.stats ?? {}).map(([key, value]) => ({ key, value })),
      courierEffects: Object.entries(item?.courierEffects ?? {}).map(([key, value]) => ({ key, value })),
    };

    const editorHash = creating ? "#/items/new" : `#/items/${itemId}`;
    let dirty = false;
    let guarding = false;
    const markDirty = (): void => {
      dirty = true;
      window.onbeforeunload = () => true;
    };
    const markClean = (): void => {
      dirty = false;
      window.onbeforeunload = null;
    };

    // Hold the user in the editor when they navigate away with unsaved edits.
    const hashGuard = (): void => {
      if (guarding || !dirty) return;
      const target = window.location.hash;
      if (target === editorHash) return;
      guarding = true;
      window.location.hash = editorHash; // bounce back first…
      guarding = false;
      confirmModal({
        title: "Discard unsaved changes?",
        body: "This item has unsaved edits. Leaving now loses them.",
        confirmLabel: "Discard and leave",
        danger: true,
        onConfirm: () => {
          markClean();
          guarding = true;
          window.location.hash = target; // …then honor the original destination
          guarding = false;
        },
      });
    };
    window.addEventListener("hashchange", hashGuard);

    const backBtn = el("button", { type: "button", class: "admin-btn admin-btn--sm", onclick: () => guardedNavigate("#/items") }, "← Item Database");
    const sourceBadge = item === null
      ? el("span", { class: "admin-badge admin-badge--admin" }, creating ? "new" : "unsaved")
      : el("span", { class: `admin-badge admin-badge--${item.source}` }, item.source === "admin" ? "admin override" : "content (items.json)");

    clear(content);
    const wrap = el("div", { class: "admin-item-editor" });
    content.append(wrap);
    wrap.append(
      el(
        "div",
        { class: "admin-page-head" },
        el(
          "div",
          {},
          el("h1", { class: "admin-page-title" }, creating ? "New Item" : state.name),
          el(
            "p",
            { class: "admin-page-sub" },
            creating
              ? "Author a new item. A unique key, a category, and an icon asset key are required."
              : `${item?.key ?? ""} · updated ${formatWhen(item?.updatedAt ?? null)} by ${item?.updatedBy ?? "—"}`,
          ),
        ),
        el(
          "div",
          { class: "admin-item-editor__head" },
          sourceBadge,
          item?.isDeleted === true ? el("span", { class: "admin-badge admin-badge--archived" }, "archived") : null,
          backBtn,
        ),
      ),
    );

    // ---- Identity ----
    const keyField = textField("Key", state.key, (value) => {
      state.key = value;
      markDirty();
    }, {
      disabled: !creating,
      hint: creating
        ? 'Lowercase kebab-case starting with "item-" (e.g. item-moon-charm). Immutable once created.'
        : "Item keys are immutable — duplicate the item to make a variant.",
    });
    const nameField = textField("Name", state.name, (value) => {
      state.name = value;
      markDirty();
    });
    const descriptionInput = el("textarea", { class: "admin-input", rows: "3", "aria-label": "Description" }) as HTMLTextAreaElement;
    descriptionInput.value = state.description;
    descriptionInput.addEventListener("input", () => {
      state.description = descriptionInput.value;
      markDirty();
    });

    wrap.append(
      section(
        "Identity",
        el(
          "div",
          { class: "admin-form-grid" },
          keyField,
          nameField,
          el("label", { class: "admin-form-grid__wide" }, "Description", descriptionInput),
        ),
      ),
    );

    // ---- Presentation ----
    const categorySelect = optionSelect(meta.categories, state.category);
    categorySelect.addEventListener("change", () => {
      state.category = categorySelect.value;
      markDirty();
      // Equipment metadata is stripped on save for non-equipment categories,
      // so simply show/hide the section instead of re-mounting the form.
      equipmentSection.hidden = state.category !== "equipment";
    });
    const raritySelect = optionSelect(meta.rarities, state.rarity);
    raritySelect.addEventListener("change", () => {
      state.rarity = raritySelect.value;
      markDirty();
    });

    wrap.append(
      section(
        "Presentation",
        el(
          "div",
          { class: "admin-form-grid" },
          labeled("Category", categorySelect),
          labeled("Rarity", raritySelect),
          textField("Icon key", state.icon, (value) => {
            state.icon = value;
            markDirty();
          }, { hint: "Asset key the inventory grid renders, e.g. berry-strawberry." }),
          numberField("Max stack", "maxStack", state, markDirty, { min: 1, max: 999 }),
          numberField("Value (stamps)", "value", state, markDirty, { min: 0 }),
        ),
        el("p", { class: "admin-form-hint" }, "Category drives inventory sorting and reward rules — only gift, cosmetic, and quest items can be quest rewards."),
      ),
    );

    // ---- Equipment (shown only for the equipment category) ----
    const slotSelect = optionSelect(meta.equipmentSlots, state.equipmentSlot);
    slotSelect.addEventListener("change", () => {
      state.equipmentSlot = slotSelect.value;
      markDirty();
    });
    const classSelect = el("select", { class: "admin-select", "aria-label": "Required class" }, el("option", { value: "" }, "Any class"));
    for (const cls of meta.classes) classSelect.append(el("option", { value: cls }, cls));
    classSelect.value = state.requiredClass;
    classSelect.addEventListener("change", () => {
      state.requiredClass = classSelect.value;
      markDirty();
    });

    const equipmentSection = section(
      "Equipment",
      el(
        "div",
        { class: "admin-form-grid" },
        labeled("Slot", slotSelect),
        labeled("Required class", classSelect),
        numberField("Required level", "requiredLevel", state, markDirty, { min: 1, max: 999 }),
      ),
      el("h3", { class: "admin-section-title" }, "Combat stats"),
      keyValueEditor(meta.statKeys, state.stats, markDirty, "stat"),
      el("h3", { class: "admin-section-title" }, "Courier effects"),
      keyValueEditor(meta.courierEffectKeys, state.courierEffects, markDirty, "courier effect"),
      el("p", { class: "admin-form-hint" }, "Stats feed the derived combat numbers; courier effects feed parcel capacity, movement, and weather protection."),
    );
    equipmentSection.hidden = state.category !== "equipment";
    wrap.append(equipmentSection);

    // ---- Usage ----
    if (references !== null) wrap.append(referencesCard(references, item?.isDeleted === true));

    // ---- Save bar ----
    const reasonInput = el("input", {
      class: "admin-input",
      type: "text",
      placeholder: "Reason for this change (required, min 3 characters)",
      style: "flex:1; min-width:240px",
      "aria-label": "Reason",
    }) as HTMLInputElement;
    const saveBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary" }, creating ? "Create Item" : "Save Changes") as HTMLButtonElement;
    const cancelBtn = el("button", { type: "button", class: "admin-btn", onclick: () => guardedNavigate("#/items") }, "Cancel");

    const updateSaveState = (): void => {
      saveBtn.disabled = !canEdit || reasonInput.value.trim().length < 3;
    };
    reasonInput.addEventListener("input", updateSaveState);
    updateSaveState();

    saveBtn.addEventListener("click", () => {
      const reason = reasonInput.value.trim();
      saveBtn.disabled = true;
      const original = saveBtn.textContent;
      saveBtn.textContent = "Saving…";
      const payload = toPayload(state);
      const request = creating
        ? api.post<{ item: ItemRow }>("/api/admin/items", { item: payload, reason })
        : api.put<{ item: ItemRow }>(`/api/admin/items/${itemId}`, { item: payload, reason });
      void request
        .then((res) => {
          markClean();
          toast(creating ? `Created "${res.item.name}".` : `Saved "${res.item.name}".`, "success");
          if (creating) {
            // Route through the hash so the router re-renders the saved item.
            window.location.hash = `#/items/${res.item.id}`;
            return;
          }
          // Re-render so the header, source badge, and audit metadata refresh.
          saveBtn.textContent = original;
          window.removeEventListener("hashchange", hashGuard);
          renderItemEditor(content, String(res.item.id));
        })
        .catch((err: unknown) => {
          toast(err instanceof Error ? err.message : "Save failed.", "error");
          saveBtn.textContent = original;
          saveBtn.disabled = false;
        });
    });

    wrap.append(el("div", { class: "admin-item-editor__savebar" }, reasonInput, cancelBtn, saveBtn));

    if (!canEdit) {
      wrap.append(
        el("p", { class: "admin-form-hint admin-form-hint--warning" }, "You have read-only access — the edit_items permission (Content Designer, Administrator, or Developer role) is required to change items."),
      );
    }

    // ---- Danger zone ----
    if (item !== null && canEdit) wrap.append(dangerZone(item, references));

    function guardedNavigate(hash: string): void {
      if (!dirty) {
        window.location.hash = hash;
        return;
      }
      confirmModal({
        title: "Discard unsaved changes?",
        body: "This item has unsaved edits. Leaving now loses them.",
        confirmLabel: "Discard",
        danger: true,
        onConfirm: () => {
          markClean();
          window.location.hash = hash;
        },
      });
    }

    /**
     * Archive = Level 3: typed confirmation of the item key, then a reason
     * prompt that mints a single-use step-up token, then the DELETE.
     */
    function dangerZone(target: ItemRow, refs: ItemReferences | null): HTMLElement {
      const card = el("section", { class: "admin-card admin-card--danger" }, el("h2", { class: "admin-card__title" }, "Danger Zone"));
      if (target.isDeleted) {
        card.append(
          el("p", { class: "admin-form-hint" }, "Restoring puts this item back into the catalog so it can drop, be granted, and satisfy quest hand-ins again."),
          el(
            "div",
            { style: "margin-top:12px" },
            el("button", { type: "button", class: "admin-btn admin-btn--primary", onclick: () => openRestore(target) }, "Restore Item"),
          ),
        );
        return card;
      }
      card.append(
        el("p", { class: "admin-form-hint" }, "Archiving is a Level 3 operation: it needs a typed confirmation, a fresh re-authentication, and it is recorded in the audit log."),
        el(
          "div",
          { style: "margin-top:12px" },
          el("button", { type: "button", class: "admin-btn admin-btn--danger", onclick: () => openArchive(target, refs) }, "Archive Item"),
        ),
      );
      return card;
    }

    function openRestore(target: ItemRow): void {
      reasonModal(`Restore "${target.name}"?`, "Restore", (reason) => {
        return api
          .post<{ item: ItemRow }>(`/api/admin/items/${target.id}/restore`, { reason })
          .then((res) => {
            markClean();
            toast(`Restored "${res.item.name}".`, "success");
            window.removeEventListener("hashchange", hashGuard);
            renderItemEditor(content, String(res.item.id));
          });
      });
    }

    function openArchive(target: ItemRow, refs: ItemReferences | null): void {
      const blast = refs === null
        ? ""
        : ` ${refs.charactersOwning} courier(s) already own it, ${refs.monsters.length} loot table(s) and ${refs.quests.length} quest(s) reference it.`;
      typedConfirmModal({
        title: `Archive "${target.name}"?`,
        body: `Archived items leave the catalog immediately: they cannot be granted or handed in for quests, though couriers keep copies they already own.${blast}`,
        requiredPhrase: target.key,
        confirmLabel: "Archive",
        onConfirm: () => {
          reAuthModal({
            action: `Archive item "${target.key}"`,
            onConfirm: async (reason) => {
              const stepUp = await api.stepUp(reason);
              const res = await api.del<{ item: ItemRow }>(`/api/admin/items/${target.id}`, { reason }, stepUpHeaders(stepUp.token));
              markClean();
              window.removeEventListener("hashchange", hashGuard);
              toast(`Archived "${res.item.name}".`, "warning");
              window.location.hash = "#/items";
            },
          });
        },
      });
    }
  }
}

// ---- builders ----

/** Editor state → API payload (equipment metadata only for equipment items). */
function toPayload(state: EditorState): ItemInput {
  const isEquipment = state.category === "equipment";
  const stats: Record<string, number> = {};
  for (const row of state.stats) if (row.key !== "") stats[row.key] = Number(row.value);
  const courierEffects: Record<string, number> = {};
  for (const row of state.courierEffects) if (row.key !== "") courierEffects[row.key] = Number(row.value);
  return {
    key: state.key.trim(),
    name: state.name.trim(),
    description: state.description.trim(),
    category: state.category,
    maxStack: Number(state.maxStack),
    icon: state.icon.trim(),
    rarity: state.rarity,
    value: Number(state.value),
    equipmentSlot: isEquipment ? state.equipmentSlot : null,
    stats: isEquipment ? stats : {},
    courierEffects: isEquipment ? courierEffects : {},
    requiredClass: isEquipment && state.requiredClass !== "" ? state.requiredClass : null,
    requiredLevel: isEquipment ? Number(state.requiredLevel) : 1,
  };
}

function section(title: string, ...children: (Node | string | null)[]): HTMLElement {
  return el("section", { class: "admin-card" }, el("h2", { class: "admin-card__title" }, title), ...children);
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  return el("label", {}, label, control);
}

function textField(
  label: string,
  value: string,
  onInput: (value: string) => void,
  opts: { disabled?: boolean; hint?: string } = {},
): HTMLElement {
  const input = el("input", {
    class: "admin-input",
    type: "text",
    value,
    disabled: opts.disabled === true,
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": label,
  }) as HTMLInputElement;
  input.addEventListener("input", () => onInput(input.value));
  return el("label", {}, label, input, opts.hint === undefined ? null : el("span", { class: "admin-form-hint" }, opts.hint));
}

function numberField(
  label: string,
  key: NumericKey,
  state: EditorState,
  markDirty: () => void,
  opts: { min?: number; max?: number } = {},
): HTMLElement {
  const input = el("input", {
    class: "admin-input",
    type: "number",
    value: String(state[key]),
    min: opts.min === undefined ? undefined : String(opts.min),
    max: opts.max === undefined ? undefined : String(opts.max),
    "aria-label": label,
  }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const parsed = Number(input.value);
    state[key] = Number.isFinite(parsed) ? parsed : 0;
    markDirty();
  });
  return labeled(label, input);
}

export function optionSelect(options: string[], current: string): HTMLSelectElement {
  const node = el("select", { class: "admin-select" }) as HTMLSelectElement;
  for (const option of options) node.append(el("option", { value: option }, option));
  if (options.includes(current)) node.value = current;
  return node;
}

/**
 * Key/value rows bound to the backing array, so removals and additions are
 * reflected in what the form submits.
 */
function keyValueEditor(
  allowedKeys: string[],
  rows: { key: string; value: number }[],
  markDirty: () => void,
  label: string,
): HTMLElement {
  const box = el("div", { class: "admin-kv-editor" });

  const addButton = el(
    "button",
    {
      type: "button",
      class: "admin-btn admin-btn--sm",
      onclick: () => {
        rows.push({ key: allowedKeys[0] ?? "", value: 0 });
        markDirty();
        draw();
      },
    },
    `+ Add ${label}`,
  );

  function draw(): void {
    clear(box);
    rows.forEach((row, index) => {
      const keySelect = optionSelect(allowedKeys, row.key);
      keySelect.setAttribute("aria-label", `${label} key`);
      keySelect.addEventListener("change", () => {
        row.key = keySelect.value;
        markDirty();
      });
      const valueInput = el("input", {
        class: "admin-input",
        type: "number",
        step: "0.05",
        min: "0",
        value: String(row.value),
        "aria-label": `${label} value`,
      }) as HTMLInputElement;
      valueInput.addEventListener("input", () => {
        row.value = Number(valueInput.value);
        markDirty();
      });
      const removeBtn = el("button", { type: "button", class: "admin-btn admin-btn--sm admin-btn--ghost", "aria-label": `Remove ${label}` }, "✕");
      removeBtn.addEventListener("click", () => {
        rows.splice(index, 1);
        markDirty();
        draw();
      });
      box.append(el("div", { class: "admin-kv-editor__row" }, keySelect, valueInput, removeBtn));
    });
    box.append(addButton);
  }

  draw();
  return box;
}

function referencesCard(references: ItemReferences, archived: boolean): HTMLElement {
  const card = el("section", { class: "admin-card" }, el("h2", { class: "admin-card__title" }, "Usage"));
  const list = el("dl", { class: "admin-detail-list" });
  const add = (label: string, value: string | number): void => {
    list.append(el("dt", {}, label), el("dd", {}, String(value)));
  };
  add("Couriers owning it", references.charactersOwning);
  add("Stacks in inventories", references.inventoryCount);
  add("Currently equipped", references.equippedCount);
  add("Monster loot tables", references.monsters.length === 0 ? "—" : references.monsters.map((m) => m.name).join(", "));
  add(
    "Quests",
    references.quests.length === 0
      ? "—"
      : references.quests.map((q) => `${q.title} (${q.role === "required" ? "hand-in" : "reward"})`).join(", "),
  );
  card.append(list);

  if (archived) {
    card.append(
      el("p", { class: "admin-form-hint admin-form-hint--warning" }, "Archived: this item is hidden from the catalog, cannot be granted, and no longer satisfies quest hand-ins. Couriers who already own a copy keep it."),
    );
  } else if (references.quests.length > 0 || references.monsters.length > 0 || references.charactersOwning > 0) {
    card.append(el("p", { class: "admin-form-hint" }, "Archiving stops new copies entering the game, but never strips items couriers already own."));
  }
  return card;
}

/** Small reason prompt reused by non-Level-3 mutations (restore). */
function reasonModal(title: string, confirmLabel: string, onSubmit: (reason: string) => Promise<unknown>): void {
  const backdrop = el("div", { class: "admin-modal-backdrop" });
  const modal = el("div", { class: "admin-modal" });
  modal.append(el("h2", { class: "admin-modal__title" }, title));
  const reasonInput = el("input", { class: "admin-input", type: "text", placeholder: "Reason (required, min 3 characters)", style: "width:100%" }) as HTMLInputElement;
  modal.append(labeled("Reason", reasonInput));
  const confirmBtn = el("button", { type: "button", class: "admin-btn admin-btn--primary" }, confirmLabel) as HTMLButtonElement;
  const errorLine = el("p", { class: "admin-form-hint admin-form-hint--warning", style: "display:none" });
  confirmBtn.disabled = true;
  reasonInput.addEventListener("input", () => {
    confirmBtn.disabled = reasonInput.value.trim().length < 3;
  });
  confirmBtn.addEventListener("click", () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Working…";
    void onSubmit(reasonInput.value.trim()).then(() => backdrop.remove()).catch((err: unknown) => {
      errorLine.textContent = err instanceof Error ? err.message : "The operation failed.";
      errorLine.style.display = "block";
      confirmBtn.textContent = confirmLabel;
      confirmBtn.disabled = false;
    });
  });
  modal.append(
    errorLine,
    el("div", { class: "admin-modal__actions" }, el("button", { type: "button", class: "admin-btn", onclick: () => backdrop.remove() }, "Cancel"), confirmBtn),
  );
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
  window.setTimeout(() => reasonInput.focus(), 30);
}
