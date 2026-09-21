import { createIcon } from "./hud/icons.ts";
import { createPanel, createKeyHint } from "./hud/primitives.ts";
import { hudLayer } from "./hud/layer.ts";

export interface ChatMessage {
  sender: string;
  text: string;
  self?: boolean;
}

const MAX_MESSAGES = 40;

/**
 * HUD v4 zone chat (bottom-left, dark translucent forest surface): users
 * icon + "same zone" pill header, low-contrast empty state, 48px composer
 * with a gold circular send button. Server remains authoritative for delivery.
 */
export class ChatBox {
  private readonly root: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly log: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly onSend: (text: string) => void;
  private messages: ChatMessage[] = [];

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
    header.append(titleGroup, hint);

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
    input.addEventListener("keydown", (event) => event.stopPropagation());
    input.addEventListener("keyup", (event) => event.stopPropagation());
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

    this.panelBody.append(header, this.log, composer);
    hudLayer()?.appendChild(this.root);
    this.input = input;
    this.sendButton = send;
  }

  addMessage(message: ChatMessage): void {
    this.messages.push({ ...message, text: message.text.slice(0, 240) });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    this.render();
  }

  setEnabled(enabled: boolean): void {
    this.input.disabled = !enabled;
    this.sendButton.disabled = !enabled;
    this.input.placeholder = enabled ? "Send a message…" : "Connecting to village chat…";
  }

  destroy(): void {
    this.root.remove();
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
