export interface SkillBarAction {
  id: string;
  label: string;
  shortcut: string;
  icon: string;
  available: boolean;
}

const SKILLS: readonly SkillBarAction[] = [
  { id: "basic-attack", label: "Basic attack", shortcut: "J", icon: "⚔", available: true },
  { id: "skill-2", label: "Skill 2", shortcut: "2", icon: "✦", available: false },
  { id: "skill-3", label: "Skill 3", shortcut: "3", icon: "✹", available: false },
  { id: "skill-4", label: "Skill 4", shortcut: "4", icon: "✧", available: false },
];

/** Bottom-center combat bar; only server-backed skills are enabled. */
export class SkillBar {
  private readonly root: HTMLElement;
  private readonly activeSlot: HTMLButtonElement;
  private readonly cooldown: HTMLElement;
  private readonly onBasicAttack: () => void;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onBasicAttack: () => void) {
    this.onBasicAttack = onBasicAttack;
    const root = document.createElement("div");
    root.className = "skill-bar";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "Courier skills");

    const slots = document.createElement("div");
    slots.className = "skill-bar__slots";
    let active: HTMLButtonElement | null = null;
    for (const skill of SKILLS) {
      const slot = this.createSlot(skill);
      slots.appendChild(slot);
      if (skill.available) active = slot;
    }
    this.activeSlot = active!;

    const hint = document.createElement("span");
    hint.className = "skill-bar__hint";
    hint.textContent = "J · attack";
    root.append(slots, hint);
    document.getElementById("game-container")?.appendChild(root);

    this.root = root;
    this.cooldown = this.activeSlot.querySelector(".skill-slot__cooldown")!;
  }

  triggerBasicAttack(): void {
    if (this.activeSlot.disabled) return;
    this.activeSlot.classList.remove("skill-slot--pressed");
    void this.activeSlot.offsetWidth;
    this.activeSlot.classList.add("skill-slot--pressed");
    this.onBasicAttack();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  showFeedback(durationMs = 260): void {
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    this.activeSlot.classList.add("skill-slot--cooldown");
    this.cooldown.style.animationDuration = `${durationMs}ms`;
    this.cooldownTimer = setTimeout(() => {
      this.activeSlot.classList.remove("skill-slot--cooldown");
      this.cooldownTimer = null;
    }, durationMs);
  }

  destroy(): void {
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    this.root.remove();
  }

  private createSlot(skill: SkillBarAction): HTMLButtonElement {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "skill-slot";
    slot.disabled = !skill.available;
    slot.title = skill.available ? `${skill.label} (${skill.shortcut})` : `${skill.label} — unlocks later`;
    slot.setAttribute("aria-label", slot.title);

    const icon = document.createElement("span");
    icon.className = "skill-slot__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = skill.icon;
    const key = document.createElement("span");
    key.className = "skill-slot__key";
    key.textContent = skill.shortcut;
    const cooldown = document.createElement("span");
    cooldown.className = "skill-slot__cooldown";
    cooldown.setAttribute("aria-hidden", "true");

    slot.append(icon, key, cooldown);
    if (skill.available) slot.addEventListener("click", () => this.triggerBasicAttack());
    return slot;
  }
}
