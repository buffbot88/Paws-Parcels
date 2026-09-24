/**
 * DialoguePanel menu regression tests (the villager Quest/Shop/Exit hub).
 *
 * The panel is a pure DOM component: these tests drive it through a stub
 * document, the same approach the HUD lifecycle suite takes, and pin the
 * conversation contract:
 *   - the menu appears only on the last line;
 *   - the last line rests (no auto-close) while a menu is attached;
 *   - option clicks hand the option id to onSelect, not "advance";
 *   - the AI intro line replaces the first line in place while it is on
 *     screen (the model is never on the critical path, but its line is the
 *     one the player should read);
 *   - Escape still closes.
 * Keyboard focus into the menu row is browser behavior — the stub's elements
 * are not HTMLElements — and stays with the live-browser review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: { key?: string; stopPropagation(): void }) => void;

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  className = "";
  hidden = false;
  textContent = "";
  tabIndex = 0;
  private readonly listeners = new Map<string, Listener[]>();
  private readonly classNames = new Set<string>();

  constructor(tagName = "div") {
    this.tagName = tagName;
  }
  readonly tagName: string;

  get classList() {
    const set = this.classNames;
    return {
      add: (...names: string[]) => { for (const n of names) set.add(n); },
      remove: (...names: string[]) => { for (const n of names) set.delete(n); },
      contains: (name: string) => set.has(name),
    };
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [...nodes];
    for (const node of nodes) node.parent = this;
  }
  remove(): void {
    this.parent?.appendChild; // no-op reference to keep the shape honest
    if (this.parent !== null) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  /** Drive one registered listener the way a real DOM event would. */
  dispatch(type: string, event: { key?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ ...event, stopPropagation: () => undefined });
    }
  }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  focused = false;
  focus(): void { this.focused = true; fakeDoc.activeElement = this; }
  private readonly attrs = new Map<string, string>();
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  contains(node: FakeElement | null): boolean {
    return node !== null && this.children.some((child) => child === node || child.contains(node));
  }
}

class FakeDocument {
  readonly overlay = new FakeElement("ui-overlay");
  activeElement: FakeElement | null = null;
  getElementById(id: string): FakeElement | null {
    return id === "ui-overlay" ? this.overlay : null;
  }
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
  querySelector(): null { return null; }
}

let fakeDoc: FakeDocument;

beforeEach(() => {
  fakeDoc = new FakeDocument();
  vi.stubGlobal("document", fakeDoc);
});

async function makePanel() {
  const { DialoguePanel } = await import("../../src/ui/DialoguePanel.ts");
  return new DialoguePanel();
}

const MENU = [
  { id: "quest", label: "Quest" },
  { id: "shop", label: "Shop" },
  { id: "exit", label: "Exit" },
];

describe("DialoguePanel menu", () => {
  it("hides the menu until the last line, then rests instead of closing", async () => {
    const panel = await makePanel();
    panel.open(
      { speaker: "Pip", lines: ["First line.", "Last line."], menu: MENU, onSelect: () => undefined },
      () => undefined,
    );
    const root = fakeDoc.overlay.children[0]!;
    const text = root.children[1]!;
    const menu = root.children[3]!;

    // First line: no menu yet.
    expect(text.textContent).toBe("First line.");
    expect(menu.hidden).toBe(true);

    // Advance onto the last line: the menu appears and the panel stays open.
    panel.advance();
    expect(text.textContent).toBe("Last line.");
    expect(menu.hidden).toBe(false);
    expect(root.classList.contains("hidden")).toBe(false);

    // Advancing again (click-through) must NOT close a menu conversation.
    panel.advance();
    expect(root.classList.contains("hidden")).toBe(false);
  });

  it("hands option clicks to onSelect instead of advancing", async () => {
    const panel = await makePanel();
    const onSelect = vi.fn();
    panel.open({ speaker: "Pip", lines: ["Hello!"], menu: MENU, onSelect }, () => undefined);
    const root = fakeDoc.overlay.children[0]!;
    const menu = root.children[3]!;

    const [questBtn, shopBtn, exitBtn] = menu.children;
    expect(questBtn!.textContent).toBe("Quest");
    expect(shopBtn!.textContent).toBe("Shop");
    expect(exitBtn!.textContent).toBe("Exit");

    shopBtn!.dispatch("click");
    expect(onSelect).toHaveBeenCalledWith("shop");
    // Choosing an option is not "advance": the conversation stays.
    expect(root.classList.contains("hidden")).toBe(false);

    exitBtn!.dispatch("click");
    expect(onSelect).toHaveBeenCalledWith("exit");
  });

  it("swaps the AI intro line in place while the reader is still on it", async () => {
    const panel = await makePanel();
    panel.open(
      { speaker: "Pip", lines: ["Canned intro."], menu: MENU, onSelect: () => undefined },
      () => undefined,
    );
    const root = fakeDoc.overlay.children[0]!;
    const text = root.children[1]!;

    panel.setIntroLine("Welcome to the Clover Post Office — steady as ever!");
    expect(text.textContent).toBe("Welcome to the Clover Post Office — steady as ever!");

    // A one-line conversation with a menu *rests* on that line — the reader is
    // still on the intro, so a late-arriving line still swaps in.
    panel.setIntroLine("Also, mind the rabbits on the north road.");
    expect(text.textContent).toBe("Also, mind the rabbits on the north road.");

    // Once the panel is closed, no more swaps.
    panel.close();
    panel.setIntroLine("Ignored after close.");
    expect(text.textContent).toBe("Also, mind the rabbits on the north road.");
  });

  it("swaps the AI intro line without mutating the caller's (shared JSON) lines", async () => {
    const panel = await makePanel();
    const shared = ["Canned intro.", "Second line."];
    panel.open({ speaker: "Pip", lines: shared }, () => undefined);
    panel.setIntroLine("AI greeting.");
    expect(shared).toEqual(["Canned intro.", "Second line."]);

    panel.close();
    const presentedLines = ["Beat."];
    panel.open({ speaker: "Pip", lines: ["Hi."] }, () => undefined);
    panel.present({ speaker: "Pip", lines: presentedLines });
    panel.setIntroLine("Another AI line.");
    expect(presentedLines).toEqual(["Beat."]);
  });

  it("presents follow-up beats in the open conversation", async () => {
    const panel = await makePanel();
    const onSelect = vi.fn();
    panel.open({ speaker: "Pip", lines: ["Hello!"], menu: MENU, onSelect }, () => undefined);
    const root = fakeDoc.overlay.children[0]!;
    const text = root.children[1]!;

    const presented = panel.present({
      speaker: "Pip",
      lines: ["The village letter circuit is waiting for you."],
      menu: MENU,
      onSelect,
    });
    expect(presented).toBe(true);
    expect(text.textContent).toBe("The village letter circuit is waiting for you.");
    // The menu reappears on the new (single) line's last state.
    const menu = root.children[3]!;
    expect(menu.hidden).toBe(false);

    // present() on a closed panel is a no-op.
    panel.close();
    expect(panel.present({ speaker: "Pip", lines: ["x"] })).toBe(false);
  });

  it("still closes on Escape", async () => {
    const panel = await makePanel();
    panel.open({ speaker: "Pip", lines: ["Hi"], menu: MENU, onSelect: () => undefined }, () => undefined);
    const root = fakeDoc.overlay.children[0]!;
    root.dispatch("keydown", { key: "Escape" });
    expect(root.classList.contains("hidden")).toBe(true);
  });
});
