/** HUD v4 shared DOM primitives (Panel / Pill / KeyHint / ProgressBar / Avatar). */

import { createIcon, type IconName } from "./icons.ts";

/** Floating card — the base material every HUD panel is built from. */
export function createPanel(
  options: { dark?: boolean; leaf?: boolean; className?: string } = {},
): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement("section");
  root.className = `hud-panel${options.dark === true ? " hud-panel--dark" : ""}${options.className !== undefined ? ` ${options.className}` : ""}`;
  const body = document.createElement("div");
  body.className = "hud-panel__body";
  if (options.leaf === true) {
    const leaf = createIcon("leaf", { size: 20, className: "hud-panel__leaf hud-panel__leaf--tr" });
    root.appendChild(leaf);
  }
  root.appendChild(body);
  return { root, body };
}

/** Rounded label capsule (tabs, status chips, location tags). */
export function createPill(
  text: string,
  options: { icon?: IconName; variant?: "default" | "gold" | "quiet" } = {},
): HTMLElement {
  const pill = document.createElement("span");
  pill.className = `hud-pill${options.variant === "gold" ? " hud-pill--gold" : options.variant === "quiet" ? " hud-pill--quiet" : ""}`;
  if (options.icon !== undefined) pill.appendChild(createIcon(options.icon, { size: 13 }));
  const label = document.createElement("span");
  label.textContent = text;
  pill.appendChild(label);
  return pill;
}

/** Inset keycap hint (I, J, Esc…). */
export function createKeyHint(key: string, options: { dark?: boolean } = {}): HTMLElement {
  const hint = document.createElement("kbd");
  hint.className = `hud-key${options.dark === true ? " hud-key--dark" : ""}`;
  hint.textContent = key;
  return hint;
}

/** Icon-only button; callers wire behavior and provide the aria-label. */
export function createIconButton(
  icon: IconName,
  ariaLabel: string,
  options: { size?: number; dark?: boolean } = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `hud-icon-btn${options.dark === true ? " hud-icon-btn--dark" : ""}`;
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  button.appendChild(createIcon(icon, { size: options.size ?? 15 }));
  return button;
}

/** Rounded meter with animated fill; ratio is clamped 0..1. */
export function createProgressBar(
  ratio: number,
  options: { variant?: "hp" | "success" } = {},
): { root: HTMLElement; fill: HTMLElement } {
  const root = document.createElement("div");
  root.className = "hud-progress";
  root.setAttribute("role", "progressbar");
  root.setAttribute("aria-valuemin", "0");
  root.setAttribute("aria-valuemax", "100");
  const fill = document.createElement("div");
  fill.className = `hud-progress__fill${options.variant === "success" ? " hud-progress__fill--success" : ""}`;
  root.appendChild(fill);
  const api = {
    root,
    fill,
    /** Update without re-creating nodes so the width transition animates. */
    setRatio(value: number, ariaLabel?: string): void {
      const clamped = Math.max(0, Math.min(1, value));
      fill.style.width = `${clamped * 100}%`;
      root.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
      if (ariaLabel !== undefined) root.setAttribute("aria-label", ariaLabel);
    },
  } as const;
  api.setRatio(ratio);
  return api;
}

/** Circular portrait with the warm-gold ring. */
export function createAvatar(glyph: string, options: { small?: boolean } = {}): HTMLElement {
  const avatar = document.createElement("div");
  avatar.className = `hud-avatar${options.small === true ? " hud-avatar--sm" : ""}`;
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = glyph;
  return avatar;
}

/** Thin separator for card content. */
export function createDivider(): HTMLElement {
  const divider = document.createElement("hr");
  divider.className = "hud-divider";
  return divider;
}
