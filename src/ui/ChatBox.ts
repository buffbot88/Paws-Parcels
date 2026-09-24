import { createIcon } from "./hud/icons.ts";
import { createIconButton, createPanel } from "./hud/primitives.ts";
import { hudColumn } from "./hud/layer.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { BLOCKING_SURFACES, matchesKey } from "../systems/keybindings.ts";

export interface ChatMessage {
  sender: string;
  text: string;
  self?: boolean;
}

const MAX_MESSAGES = 40;

/**
 * HUD v4 zone chat (bottom-left, translucent forest surface): users icon +
 * "same zone" pill header, low-contrast empty state, 48px composer with a gold
 * circular send button. Server remains authoritative for delivery.
 *
 * Starts collapsed to its header (a small pill with the unread badge); the
 * whole header toggles it, and Enter opens it straight into the composer.
 * The header carries a collapse toggle and stays on screen when collapsed —
 * only the log and composer are hidden. Same defect class the quest tracker
 * had: hiding the whole panel body would hide the one control that could
 * bring it back.
 *
 * Mounts into the bottom-left HUD column, so the quest tracker sits above it
 * by layout rather than by a measured offset.
 */
export class ChatBox {
  private readonly root: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly body: HTMLElement;
  private readonly log: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly toggle: HTMLButtonElement;
  private readonly unreadBadge: HTMLElement;
  private readonly onSend: (text: string) => void;
  private messages: ChatMessage[] = [];
  private collapsed = false;
  private unread = 0;

  constructor(onSend: (text: string) => void) {
    this.onSend = onSend;
    const panel = createPanel({ dark: true, className: "chat-box" });
    this.root = panel.root;
    this.panelBody = panel.body;

    const header = document.createElement("div");
    header.className = "chat-box__header";
    const titleGroup = document.createElement("span");
    titleGroup.className = "chat-box__title";
    titleGroup.appendChild(createIcon("users", { size: 14 }));
    const titleText = document.createElement("span");
    titleText.textContent = "Village chat";
    titleGroup.appendChild(titleText);
    const hint = document.createElement("span");
    hint.className = "hud-pill hud-pill--quiet chat-box__scope";
    hint.textContent = "same zone";
    this.toggle = createIconButton("chevron-up", "Collapse village chat", {
      size: 14,
      dark: true,
    });
    this.toggle.classList.add("chat-box__toggle");
    this.toggle.setAttribute("aria-controls", "chat-box-body");
    this.unreadBadge = document.createElement("span");
    this.unreadBadge.className = "chat-box__unread";
    this.unreadBadge.hidden = true;
    header.append(titleGroup, hint, this.unreadBadge, this.toggle);
    header.addEventListener("click", () => {
      this.setCollapsed(!this.collapsed);
      updateSettings({ chatCollapsed: this.collapsed });
    });

    this.log = document.createElement("div");
    this.log.className = "chat-box__log";
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.empty = document.createElement("div");
    this.empty.className = "chat-box__empty";
    const emptyIcon = createIcon("message-circle", { size: 20 });
    const emptyTitle = document.createElement("span");
    emptyTitle.textContent = "No messages yet…";
    const emptyHint = document.createElement("span");
    emptyHint.textContent = "Say hello to your fellow villagers!";
    this.empty.append(emptyIcon, emptyTitle, emptyHint);
    this.log.appendChild(this.empty);

    const composer = document.createElement("form");
    composer.className = "chat-box__composer";
    const inputWrap = document.createElement("div");
    inputWrap.className = "chat-box__field";
    const inputIcon = createIcon("message-circle", { size: 14, className: "chat-box__field-icon" });
    const input = document.createElement("input");
    input.className = "chat-box__input";
    input.type = "text";
    input.maxLength = 240;
    input.placeholder = "Send a message…";
    input.setAttribute("aria-label", "Chat message");
    // keyup still propagates so Phaser sees a movement key released mid-chat.
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (matchesKey(event, "close")) this.returnToGame();
    });
    inputWrap.append(inputIcon, input);
    const send = document.createElement("button");
    send.className = "chat-box__send";
    send.type = "submit";
    send.setAttribute("aria-label", "Send message");
    send.appendChild(createIcon("send", { size: 16 }));
    composer.append(inputWrap, send);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text === "") return;
      this.onSend(text);
      input.value = "";
      input.blur();
    });

    // The collapsible half: log + composer. The header is deliberately outside
    // it so the toggle never hides itself.
    this.body = document.createElement("div");
    this.body.className = "chat-box__body";
    this.body.id = "chat-box-body";
    this.body.append(this.log, composer);

    this.panelBody.append(header, this.body);
    hudColumn("bottom-left")?.appendChild(this.root);
    this.input = input;
    this.sendButton = send;
    this.setCollapsed(getSettings().chatCollapsed);
    document.addEventListener("keydown", this.handleDocumentKeyDown);
  }

  addMessage(message: ChatMessage): void {
    this.messages.push({ ...message, text: message.text.slice(0, 240) });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    if (this.collapsed && message.self !== true) this.setUnread(this.unread + 1);
    this.render();
  }

  setEnabled(enabled: boolean): void {
    this.input.disabled = !enabled;
    this.sendButton.disabled = !enabled;
    this.input.placeholder = enabled ? "Send a message…" : "Connecting to village chat…";
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    if (collapsed) this.input.blur();
    else this.setUnread(0);
    this.root.classList.toggle("chat-box--collapsed", collapsed);
    this.body.hidden = collapsed;
    this.toggle.setAttribute("aria-expanded", String(!collapsed));
    const label = collapsed ? "Expand village chat" : "Collapse village chat";
    this.toggle.setAttribute("aria-label", label);
    this.toggle.title = label;
    this.toggle.replaceChildren(
      createIcon(collapsed ? "chevron-down" : "chevron-up", { size: 14 }),
    );
  }

  destroy(): void {
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    this.root.remove();
  }

  /** Enter jumps into chat when nothing else has the keyboard (no field, button or modal). */
  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!matchesKey(event, "chat") || event.repeat || this.input.disabled) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !(active instanceof HTMLCanvasElement)) return;
    if (document.querySelector(BLOCKING_SURFACES) !== null) return;
    event.preventDefault();
    if (this.collapsed) {
      this.setCollapsed(false);
      updateSettings({ chatCollapsed: false });
    }
    this.input.focus();
  };

  /** Leave the chat field and hand the keyboard back to the world. */
  private returnToGame(): void {
    this.input.blur();
    document.querySelector<HTMLElement>("#game-container > canvas")?.focus();
  }

  private setUnread(count: number): void {
    this.unread = count;
    this.unreadBadge.hidden = count === 0;
    this.unreadBadge.textContent = count > 9 ? "9+" : String(count);
    this.unreadBadge.setAttribute("aria-label", `${count} unread message${count === 1 ? "" : "s"}`);
  }

  private render(): void {
    this.empty.hidden = this.messages.length > 0;
    this.log.replaceChildren(this.empty);
    for (const message of this.messages) {
      const row = document.createElement("div");
      row.className = `chat-box__message${message.self ? " chat-box__message--self" : ""}`;
      const sender = document.createElement("strong");
      sender.textContent = `${message.sender}:`;
      const text = document.createElement("span");
      text.textContent = message.text;
      row.append(sender, text);
      this.log.appendChild(row);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }
}
