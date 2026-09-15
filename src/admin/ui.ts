/** Shared DOM helpers for the admin panel (tables, modals, toasts, states). */

// ---- low-level element helper ----

type ElAttrs = Record<string, string | boolean | number | undefined | ((...args: never[]) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElAttrs,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs !== undefined) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      if (typeof value === "function") {
        node.addEventListener(key.replace(/^on/, "").toLowerCase(), value as EventListener);
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

// ---- toasts (spec §73) ----

export type ToastKind = "success" | "warning" | "error" | "info";

export function toast(message: string, kind: ToastKind = "info", action?: { label: string; onClick: () => void }): void {
  let stack = document.querySelector<HTMLElement>(".admin-toast-stack");
  if (stack === null) {
    stack = el("div", { class: "admin-toast-stack" });
    document.body.append(stack);
  }
  const node = el("div", { class: `admin-toast admin-toast--${kind}`, role: "status" }, message);
  if (action !== undefined) {
    node.append(
      el("button", { type: "button", onclick: () => { action.onClick(); node.remove(); } }, action.label),
    );
  }
  stack.append(node);
  window.setTimeout(() => node.remove(), 6000);
}

// ---- modals: confirm (Level 2) + typed confirm (Level 3, spec §72) ----

export function confirmModal(opts: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}): void {
  openModal(opts.title, opts.body, opts.confirmLabel ?? "Confirm", opts.danger === true, opts.onConfirm, undefined);
}

export function typedConfirmModal(opts: {
  title: string;
  body: string;
  requiredPhrase: string;
  confirmLabel?: string;
  onConfirm: () => void;
}): void {
  openModal(
    opts.title,
    opts.body,
    opts.confirmLabel ?? "Confirm",
    true,
    opts.onConfirm,
    opts.requiredPhrase,
  );
}

function openModal(
  title: string,
  bodyText: string,
  confirmLabel: string,
  danger: boolean,
  onConfirm: () => void,
  requiredPhrase: string | undefined,
): void {
  closeModal();
  const backdrop = el("div", { class: "admin-modal-backdrop" });
  const modal = el("div", { class: `admin-modal${danger ? " admin-modal--danger" : ""}`, role: "dialog", "aria-modal": "true" });
  modal.append(el("h2", { class: "admin-modal__title" }, title));
  modal.append(el("p", { class: "admin-modal__body" }, bodyText));

  let phraseInput: HTMLInputElement | null = null;
  const confirmBtn = el("button", { type: "button", class: `admin-btn ${danger ? "admin-btn--danger" : "admin-btn--primary"}` }, confirmLabel);
  if (requiredPhrase !== undefined) {
    modal.append(
      el("p", { class: "admin-form-hint" }, `Type ${requiredPhrase} to confirm:`),
    );
    phraseInput = el("input", { class: "admin-input", type: "text", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    phraseInput.addEventListener("input", () => {
      confirmBtn.disabled = phraseInput?.value.trim() !== requiredPhrase;
    });
    confirmBtn.disabled = true;
    modal.append(phraseInput);
    window.setTimeout(() => phraseInput?.focus(), 30);
  }
  confirmBtn.addEventListener("click", () => {
    closeModal();
    onConfirm();
  });

  modal.append(
    el(
      "div",
      { class: "admin-modal__actions" },
      el("button", { type: "button", class: "admin-btn", onclick: closeModal }, "Cancel"),
      confirmBtn,
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.append(backdrop);
}

export function closeModal(): void {
  document.querySelector(".admin-modal-backdrop")?.remove();
}

/**
 * Re-authentication prompt for Level 3 operations (spec §72 + session
 * hardening): asks the admin to state the operation, then hands the reason to
 * the caller which mints a short-TTL step-up token. The modal stays open with
 * an inline error if step-up fails (wrong tier, network, etc.).
 */
export function reAuthModal(opts: { action: string; onConfirm: (reason: string) => Promise<void> }): void {
  closeModal();
  const backdrop = el("div", { class: "admin-modal-backdrop" });
  const modal = el("div", { class: "admin-modal admin-modal--danger", role: "dialog", "aria-modal": "true" });
  modal.append(
    el("h2", { class: "admin-modal__title" }, "Re-authentication required"),
    el("p", { class: "admin-modal__body" }, `You are about to: ${opts.action}. Confirm this sensitive operation to continue (the confirmation is valid for a few minutes).`),
  );
  const errorLine = el("p", { class: "admin-modal__body admin-modal__error", style: "display:none;color:var(--adm-danger)" });
  const reasonInput = el("input", { class: "admin-input", type: "text", placeholder: "State the operation (e.g. Ban spam account)", autocomplete: "off" }) as HTMLInputElement;
  const confirmBtn = el("button", { type: "button", class: "admin-btn admin-btn--danger" }, "Confirm") as HTMLButtonElement;
  confirmBtn.disabled = true;
  reasonInput.addEventListener("input", () => {
    confirmBtn.disabled = reasonInput.value.trim().length < 3;
  });
  confirmBtn.addEventListener("click", () => {
    const reason = reasonInput.value.trim();
    if (reason.length < 3) return;
    confirmBtn.disabled = true;
    reasonInput.disabled = true;
    confirmBtn.textContent = "Verifying…";
    errorLine.style.display = "none";
    void opts
      .onConfirm(reason)
      .then(() => closeModal())
      .catch((err: unknown) => {
        errorLine.textContent = err instanceof Error ? err.message : "Re-authentication failed.";
        errorLine.style.display = "block";
        confirmBtn.textContent = "Confirm";
        reasonInput.disabled = false;
        confirmBtn.disabled = reasonInput.value.trim().length < 3;
      });
  });
  modal.append(
    el("p", { class: "admin-form-hint" }, "Why are you performing this action? (recorded in the audit log)"),
    reasonInput,
    errorLine,
    el(
      "div",
      { class: "admin-modal__actions" },
      el("button", { type: "button", class: "admin-btn", onclick: closeModal }, "Cancel"),
      confirmBtn,
    ),
  );
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.append(backdrop);
  window.setTimeout(() => reasonInput.focus(), 30);
}

// ---- skeletons (spec §75) ----

export function skeletonBlock(heightPx: number): HTMLElement {
  const block = el("div", { class: "admin-skeleton" });
  block.style.height = `${heightPx}px`;
  return block;
}

export function skeletonCard(): HTMLElement {
  const card = el("div", { class: "admin-card" });
  card.append(skeletonBlock(16), el("div", { style: "height:8px" }), skeletonBlock(42));
  return card;
}

export function skeletonTable(rows = 6): HTMLElement {
  const wrap = el("div", { class: "admin-card" });
  for (let i = 0; i < rows; i++) {
    wrap.append(skeletonBlock(18), el("div", { style: "height:10px" }));
  }
  return wrap;
}

// ---- empty states (spec §76) ----

export function emptyState(icon: string, message: string, action?: { label: string; onClick: () => void }): HTMLElement {
  const box = el("div", { class: "admin-empty" });
  box.append(el("div", { class: "admin-empty__icon", "aria-hidden": "true" }, icon), el("div", {}, message));
  if (action !== undefined) {
    box.append(el("div", { style: "margin-top:12px" }, el("button", { type: "button", class: "admin-btn admin-btn--primary", onclick: action.onClick }, action.label)));
  }
  return box;
}

// ---- formatting ----

export function formatWhen(iso: string | null): string {
  if (iso === null || iso === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function statusBadge(status: string): HTMLElement {
  return el("span", { class: `admin-badge admin-badge--${status}` }, status);
}

export function statusDot(status: string): HTMLElement {
  return el("span", { class: `admin-dot admin-dot--${status}` });
}

export function healthDot(status: string): HTMLElement {
  const cls = status.toLowerCase() === "healthy" ? "healthy" : status.toLowerCase() === "degraded" ? "degraded" : "offline";
  return el("span", { class: `admin-status-dot admin-status-dot--${cls}` });
}
