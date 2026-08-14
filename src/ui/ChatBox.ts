export interface ChatMessage {
  sender: string;
  text: string;
  self?: boolean;
}

const MAX_MESSAGES = 40;

/** Glass DOM-over-Canvas zone chat; the server remains authoritative for delivery. */
export class ChatBox {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly onSend: (text: string) => void;
  private messages: ChatMessage[] = [];

  constructor(onSend: (text: string) => void) {
    this.onSend = onSend;
    const root = document.createElement("section");
    root.className = "chat-box";
    root.setAttribute("aria-label", "Village chat");

    const header = document.createElement("div");
    header.className = "chat-box__header";
    const title = document.createElement("span");
    title.textContent = "Village chat";
    const hint = document.createElement("span");
    hint.textContent = "same zone";
    header.append(title, hint);

    const log = document.createElement("div");
    log.className = "chat-box__log";
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");

    const composer = document.createElement("form");
    composer.className = "chat-box__composer";
    const input = document.createElement("input");
    input.className = "chat-box__input";
    input.type = "text";
    input.maxLength = 240;
    input.placeholder = "Send a message…";
    input.setAttribute("aria-label", "Chat message");
    input.addEventListener("keydown", (event) => event.stopPropagation());
    input.addEventListener("keyup", (event) => event.stopPropagation());
    const send = document.createElement("button");
    send.className = "chat-box__send";
    send.type = "submit";
    send.textContent = "Send";
    composer.append(input, send);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text === "") return;
      this.onSend(text);
      input.value = "";
      input.blur();
    });

    root.append(header, log, composer);
    document.getElementById("game-container")?.appendChild(root);
    this.root = root;
    this.log = log;
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
    this.log.replaceChildren();
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
