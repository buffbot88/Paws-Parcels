import { hudLayer } from "./hud/layer.ts";
import { getSettings } from "./settings.ts";

export type ToastTone = "info" | "success" | "warning";

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

/** Where toasts are drawn; injectable so the stack logic is testable without a DOM. */
export interface ToastRenderer {
  add(toast: Toast): void;
  remove(id: number): void;
}

/** Most toasts on screen at once; the oldest is dropped when a fifth arrives. */
export const MAX_TOASTS = 4;
/** How long a toast stays up before it dismisses itself. */
export const TOAST_MS = 3000;

/** Stacked, self-dismissing HUD notices (loot, XP, quests, gameplay rejections). */
export class ToastStack {
  private readonly visible: { toast: Toast; timer: ReturnType<typeof setTimeout> }[] = [];
  private nextId = 1;

  constructor(private readonly renderer: ToastRenderer = new DomToastRenderer()) {}

  show(message: string, tone: ToastTone = "info"): void {
    if (message === "") return;
    const toast: Toast = { id: this.nextId++, message, tone };
    const timer = setTimeout(() => this.dismiss(toast.id), TOAST_MS);
    this.visible.push({ toast, timer });
    this.renderer.add(toast);
    while (this.visible.length > MAX_TOASTS) this.dismiss(this.visible[0]!.toast.id);
  }

  dismiss(id: number): void {
    const index = this.visible.findIndex((entry) => entry.toast.id === id);
    if (index === -1) return;
    const [entry] = this.visible.splice(index, 1);
    clearTimeout(entry!.timer);
    this.renderer.remove(id);
  }

  /** Drop every toast (courier switch / sign-out). */
  clear(): void {
    for (const entry of [...this.visible]) this.dismiss(entry.toast.id);
  }

  current(): readonly Toast[] {
    return this.visible.map((entry) => entry.toast);
  }
}

/** Renders toasts into a polite live region in the HUD layer, created on first use. */
class DomToastRenderer implements ToastRenderer {
  private host: HTMLElement | null = null;
  private readonly nodes = new Map<number, HTMLElement>();

  add(toast: Toast): void {
    const host = this.ensureHost();
    if (host === null) return;
    const node = document.createElement("div");
    node.className = `toast toast--${toast.tone}`;
    node.classList.toggle("toast--still", getSettings().reducedMotion);
    node.textContent = toast.message;
    host.appendChild(node);
    this.nodes.set(toast.id, node);
  }

  remove(id: number): void {
    this.nodes.get(id)?.remove();
    this.nodes.delete(id);
  }

  private ensureHost(): HTMLElement | null {
    if (this.host?.isConnected === true) return this.host;
    const layer = hudLayer();
    if (layer === null) return null;
    const host = document.createElement("div");
    host.className = "toast-stack";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    layer.appendChild(host);
    this.host = host;
    return host;
  }
}

/** The app-wide stack; DOM is only touched when the first toast is shown. */
export const toasts = new ToastStack();
