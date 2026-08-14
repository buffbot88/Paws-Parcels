import { apiPath } from "../config.ts";

export interface CharacterProfileData {
  character: {
    id: number;
    name: string;
    classId: number;
    level: number;
    experience: number;
    stamps: number;
    courierRank: string;
    hp: number;
    maxHp: number;
    resource: number;
    zoneId: string;
    pos: { x: number; y: number };
  };
  class: {
    name: string;
    role: string;
    primaryResource: string;
    description: string;
  };
  stats: Record<string, number>;
  inventory: {
    slotCount: number;
    items: {
      instanceId: number;
      slot: number | null;
      quantity: number;
      key: string;
      name: string;
      description: string;
      category: string;
      rarity: string;
      icon: string | null;
    }[];
  };
  skills: {
    skillPoints: number;
    entries: {
      key: string;
      name: string;
      description: string;
      cost: number;
      requiredLevel: number;
      prerequisiteKey: string | null;
      unlocked: boolean;
    }[];
  };
}

type ProfileTab = "info" | "inventory" | "skills";

/** Server-backed character sheet with Info, Inventory, and Skill Tree tabs. */
export class CharacterProfilePanel {
  static instance: CharacterProfilePanel | null = null;
  private root: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private characterId: number | null = null;
  private token: string | null = null;
  private profile: CharacterProfileData | null = null;
  private tab: ProfileTab = "info";
  private busy = false;

  mount(): void {
    CharacterProfilePanel.instance = this;
    if (this.root !== null) return;
    const root = document.createElement("section");
    root.className = "profile-panel";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Courier character profile");
    root.hidden = true;

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "profile-panel__backdrop";
    backdrop.setAttribute("aria-label", "Close character profile");
    backdrop.addEventListener("click", () => this.close());

    const card = document.createElement("article");
    card.className = "profile-panel__card";
    const header = document.createElement("header");
    header.className = "profile-panel__header";
    const title = document.createElement("div");
    title.className = "profile-panel__heading";
    const eyebrow = document.createElement("span");
    eyebrow.className = "profile-panel__eyebrow";
    eyebrow.textContent = "COURIER SATCHEL";
    const name = document.createElement("h2");
    name.className = "profile-panel__title";
    name.textContent = "Character";
    title.append(eyebrow, name);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "profile-panel__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close character profile");
    close.addEventListener("click", () => this.close());
    header.append(title, close);

    const tabs = document.createElement("nav");
    tabs.className = "profile-panel__tabs";
    for (const [id, label] of [["info", "Character Info"], ["inventory", "Inventory"], ["skills", "Skill Tree"]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-panel__tab";
      button.dataset.tab = id;
      button.textContent = label;
      button.addEventListener("click", () => {
        this.tab = id;
        this.render();
      });
      tabs.appendChild(button);
    }

    const status = document.createElement("p");
    status.className = "profile-panel__status";
    status.setAttribute("aria-live", "polite");
    const content = document.createElement("div");
    content.className = "profile-panel__content";
    card.append(header, tabs, status, content);
    root.append(backdrop, card);
    document.getElementById("game-container")?.appendChild(root);
    this.root = root;
    this.content = content;
    this.status = status;

    document.addEventListener("keydown", this.handleKeyDown);
  }

  open(characterId: number, token: string): void {
    this.mount();
    this.characterId = characterId;
    this.token = token;
    this.tab = "info";
    this.profile = null;
    this.root!.hidden = false;
    this.setStatus("Opening the courier ledger…");
    void this.load();
  }

  close(): void {
    if (this.root !== null) this.root.hidden = true;
  }

  /** Refresh the active tab from SQLite after a server-confirmed loot grant. */
  refresh(): void {
    if (this.root !== null && !this.root.hidden) void this.load();
  }

  destroy(): void {
    if (CharacterProfilePanel.instance === this) CharacterProfilePanel.instance = null;
    document.removeEventListener("keydown", this.handleKeyDown);
    this.root?.remove();
    this.root = null;
    this.content = null;
    this.status = null;
  }

  private async load(): Promise<void> {
    if (this.characterId === null || this.token === null) return;
    try {
      const response = await fetch(apiPath(`/api/characters/${this.characterId}/profile`), {
        headers: { Authorization: `Bearer ${this.token}` },
        credentials: "omit",
      });
      const body = (await response.json().catch(() => null)) as { profile?: CharacterProfileData; message?: string } | null;
      if (!response.ok || body?.profile === undefined) throw new Error(body?.message ?? "Profile unavailable");
      this.profile = body.profile;
      this.setStatus("");
      this.render();
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "The courier ledger could not be opened.");
    }
  }

  private render(): void {
    const profile = this.profile;
    const content = this.content;
    if (profile === null || content === null) return;
    const title = this.root?.querySelector<HTMLHeadingElement>(".profile-panel__title");
    if (title) title.textContent = profile.character.name;
    this.root?.querySelectorAll<HTMLButtonElement>(".profile-panel__tab").forEach((button) => {
      button.classList.toggle("profile-panel__tab--active", button.dataset.tab === this.tab);
      button.setAttribute("aria-selected", String(button.dataset.tab === this.tab));
    });
    content.textContent = "";
    if (this.tab === "info") this.renderInfo(content, profile);
    else if (this.tab === "inventory") this.renderInventory(content, profile);
    else this.renderSkills(content, profile);
  }

  private renderInfo(content: HTMLElement, profile: CharacterProfileData): void {
    const hero = document.createElement("div");
    hero.className = "profile-hero";
    const avatar = document.createElement("div");
    avatar.className = "profile-hero__avatar";
    avatar.textContent = "🐾";
    const copy = document.createElement("div");
    const className = document.createElement("strong");
    className.textContent = profile.class.name;
    const role = document.createElement("span");
    role.textContent = `${profile.class.role} · Level ${profile.character.level} · ${profile.character.courierRank}`;
    copy.append(className, role);
    hero.append(avatar, copy);
    content.appendChild(hero);

    const progress = document.createElement("div");
    progress.className = "profile-progress";
    progress.append(this.text("span", "Experience"), this.text("strong", `${profile.character.experience} XP`));
    content.appendChild(progress);

    const stats = document.createElement("div");
    stats.className = "profile-stat-grid";
    const values: [string, string][] = [
      ["Vitality", `${profile.character.hp} / ${profile.character.maxHp}`],
      ["Stamps", String(profile.character.stamps)],
      ["Attack", String(profile.stats.attack ?? 0)],
      ["Defense", String(profile.stats.defense ?? 0)],
      ["Speed", String(profile.stats.speed ?? 0)],
      ["Critical", `${profile.stats.crit_chance ?? 0}%`],
    ];
    for (const [label, value] of values) {
      const item = document.createElement("div");
      item.className = "profile-stat";
      item.append(this.text("span", label), this.text("strong", value));
      stats.appendChild(item);
    }
    content.appendChild(stats);

    const location = document.createElement("p");
    location.className = "profile-panel__muted";
    location.textContent = `${profile.character.zoneId} · tile ${profile.character.pos.x}, ${profile.character.pos.y}`;
    content.appendChild(location);
  }

  private renderInventory(content: HTMLElement, profile: CharacterProfileData): void {
    const heading = document.createElement("div");
    heading.className = "profile-section-heading";
    heading.append(this.text("strong", "Inventory"), this.text("span", `${profile.inventory.items.length} / ${profile.inventory.slotCount} slots`));
    content.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "inventory-grid";
    for (let slot = 0; slot < profile.inventory.slotCount; slot += 1) {
      const item = profile.inventory.items.find((entry) => entry.slot === slot);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "inventory-slot";
      if (item === undefined) {
        cell.disabled = true;
        cell.setAttribute("aria-label", `Empty slot ${slot + 1}`);
      } else {
        cell.title = `${item.name}: ${item.description}`;
        cell.setAttribute("aria-label", `${item.name}, quantity ${item.quantity}`);
        const icon = document.createElement("span");
        icon.className = "inventory-slot__icon";
        icon.textContent = item.icon?.startsWith("material") ? "◆" : item.category === "delivery" ? "✉" : "✦";
        const quantity = document.createElement("span");
        quantity.className = "inventory-slot__quantity";
        quantity.textContent = String(item.quantity);
        cell.append(icon, quantity);
      }
      grid.appendChild(cell);
    }
    content.appendChild(grid);
  }

  private renderSkills(content: HTMLElement, profile: CharacterProfileData): void {
    const heading = document.createElement("div");
    heading.className = "profile-section-heading";
    heading.append(this.text("strong", `${profile.class.name} Skill Tree`), this.text("span", `${profile.skills.skillPoints} point${profile.skills.skillPoints === 1 ? "" : "s"} available`));
    content.appendChild(heading);
    const tree = document.createElement("div");
    tree.className = "skill-tree";
    for (const skill of profile.skills.entries) {
      const card = document.createElement("article");
      card.className = `skill-tree__node${skill.unlocked ? " skill-tree__node--unlocked" : ""}`;
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = skill.name;
      const description = document.createElement("p");
      description.textContent = skill.description;
      const requirement = document.createElement("span");
      requirement.textContent = skill.unlocked ? "Unlocked" : `Level ${skill.requiredLevel} · ${skill.cost} point${skill.cost === 1 ? "" : "s"}`;
      copy.append(name, description, requirement);
      card.appendChild(copy);
      if (!skill.unlocked) {
        const unlock = document.createElement("button");
        unlock.type = "button";
        unlock.className = "profile-panel__action";
        unlock.textContent = "Unlock";
        unlock.disabled = this.busy;
        unlock.addEventListener("click", () => void this.unlock(skill.key));
        card.appendChild(unlock);
      }
      tree.appendChild(card);
    }
    content.appendChild(tree);
  }

  private async unlock(skillKey: string): Promise<void> {
    if (this.characterId === null || this.token === null || this.busy) return;
    this.busy = true;
    this.setStatus("Checking skill requirements…");
    try {
      const response = await fetch(apiPath(`/api/characters/${this.characterId}/skills/${encodeURIComponent(skillKey)}/unlock`), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
        credentials: "omit",
      });
      const body = (await response.json().catch(() => null)) as { profile?: CharacterProfileData; message?: string } | null;
      if (!response.ok || body?.profile === undefined) throw new Error(body?.message ?? "Skill cannot be unlocked yet");
      this.profile = body.profile;
      this.setStatus("");
      this.render();
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : "Skill cannot be unlocked yet");
    } finally {
      this.busy = false;
    }
  }

  private text(tag: "span" | "strong", value: string): HTMLElement {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
  }

  private setStatus(message: string): void {
    if (this.status === null) return;
    this.status.textContent = message;
    this.status.hidden = message === "";
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.root !== null && !this.root.hidden) this.close();
  };
}
