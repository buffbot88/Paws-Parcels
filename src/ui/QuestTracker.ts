import type { NetQuestSnapshot } from "../net/GameSocket.ts";
import { createIcon } from "./hud/icons.ts";
import { createPanel, createPill, createKeyHint, createDivider } from "./hud/primitives.ts";
import { hudLayer } from "./hud/layer.ts";

/** HUD v4 quest tracker: tab pill on the card edge, dominant title, objective row. */
export class QuestTracker {
  private readonly root: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly title: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private quests: NetQuestSnapshot[] = [];
  private offeredQuestId: string | null = null;
  private readonly onAccept: (questId: string) => void;
  private readonly countdownTimer: number;
  private collapsed = false;

  constructor(onAccept: (questId: string) => void) {
    this.onAccept = onAccept;
    const panel = createPanel({ className: "quest-tracker" });
    this.root = panel.root;
    this.panelBody = panel.body;

    // Category tab attached to the top edge.
    const tab = createPill("Main Quest", { icon: "book-open" });
    tab.classList.add("quest-tracker__tab");

    // Header row: title + collapse chevron.
    const header = document.createElement("div");
    header.className = "quest-tracker__header";
    this.title = document.createElement("strong");
    this.title.className = "quest-tracker__title";
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "hud-icon-btn quest-tracker__toggle";
    this.toggle.setAttribute("aria-label", "Collapse quest tracker");
    this.toggle.setAttribute("aria-expanded", "true");
    this.toggle.appendChild(createIcon("chevron-up", { size: 14 }));
    this.toggle.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    header.append(this.title, this.toggle);

    this.objective = document.createElement("span");
    this.objective.className = "quest-tracker__objective";
    this.status = document.createElement("span");
    this.status.className = "quest-tracker__status";
    this.action = document.createElement("button");
    this.action.type = "button";
    this.action.className = "hud-button quest-tracker__action";
    this.action.addEventListener("click", () => {
      if (this.offeredQuestId !== null) this.onAccept(this.offeredQuestId);
    });

    const objectiveRow = document.createElement("div");
    objectiveRow.className = "quest-tracker__row";
    objectiveRow.append(this.status, createKeyHint("E"));

    this.panelBody.append(header, this.objective, createDivider(), objectiveRow, this.action);
    this.root.prepend(tab);
    hudLayer()?.appendChild(this.root);
    this.countdownTimer = window.setInterval(() => {
      if (this.quests.some((quest) => quest.state === "active" && quest.deadlineAt !== null)) this.render();
    }, 1000);
    this.render();
  }

  setQuests(quests: NetQuestSnapshot[]): void {
    this.quests = quests;
    if (this.offeredQuestId !== null && !quests.some((quest) => quest.questId === this.offeredQuestId && quest.state === "available")) {
      this.offeredQuestId = null;
    }
    this.render();
  }

  /** Only an NPC interaction can create an acceptance offer. */
  setOffer(questId: string | null): void {
    this.offeredQuestId = questId;
    this.render();
  }

  getActiveQuest(): NetQuestSnapshot | undefined {
    return this.quests.find((quest) => quest.state === "active");
  }

  showMessage(message: string): void {
    this.status.textContent = message;
    this.status.classList.add("quest-tracker__status--notice");
    window.setTimeout(() => this.render(), 2600);
  }

  destroy(): void {
    window.clearInterval(this.countdownTimer);
    this.root.remove();
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.root.classList.toggle("quest-tracker--collapsed", collapsed);
    this.toggle.setAttribute("aria-expanded", String(!collapsed));
    this.toggle.setAttribute("aria-label", collapsed ? "Expand quest tracker" : "Collapse quest tracker");
    this.toggle.replaceChildren(createIcon(collapsed ? "chevron-down" : "chevron-up", { size: 14 }));
  }

  private render(): void {
    const active = this.quests.find((quest) => quest.state === "active");
    const available = this.quests.find((quest) => quest.state === "available");
    const next = active ?? available;
    const tutorial = this.quests.filter((quest) => !quest.sideQuest);
    // The circuit size comes from the server's quest snapshots, so the
    // "N/5 routes" readout stays correct if the tutorial chain grows.
    const circuitSize = tutorial.length;
    const tutorialCompleted = tutorial.filter((quest) => quest.state === "completed").length;
    const circuitDone = circuitSize > 0 && tutorialCompleted >= circuitSize;
    const sideCompleted = this.quests.filter((quest) => quest.sideQuest && quest.state === "completed").length;
    this.root.hidden = next === undefined && this.quests.length === 0;
    this.title.textContent = next?.title ?? (circuitDone ? "Clover Village routes" : "Explore Clover Village");
    this.objective.textContent = next === undefined
      ? "Meet village friends to unlock errands, stories, and keepsakes."
      : `${next.description}${next.state === "active" && next.type === "delivery" ? ` · Parcel: ${parcelConditionLabel(next.parcelCondition)}` : ""}`;
    this.status.classList.remove("quest-tracker__status--notice");
    if (active !== undefined) {
      const deadline = active.deadlineAt === null ? "" : ` · ${formatDeadline(active.deadlineAt)}`;
      const objective = active.searchObjectId !== null && active.progress === 0 ? ` · Search: ${active.findAt ?? "the marked location"}` : "";
      this.status.textContent = `${active.type === "delivery" ? "Delivery" : "Objective"} ${active.progress}/${active.requiredQuantity} · Circuit ${tutorialCompleted}/${circuitSize} · Side quests ${sideCompleted}${deadline}${objective}`;
      this.action.hidden = true;
    } else if (available !== undefined) {
      this.status.textContent = this.offeredQuestId === available.questId
        ? `New ${available.sideQuest ? "side quest" : "route"} ready · Circuit ${tutorialCompleted}/${circuitSize}`
        : `Speak with ${available.giverId.replace("npc-", "")} to accept · Circuit ${tutorialCompleted}/${circuitSize}`;
      this.action.textContent = available.sideQuest ? "Accept side quest" : "Accept route";
      this.action.hidden = this.offeredQuestId !== available.questId;
    } else if (circuitDone) {
      this.status.textContent = `Circuit complete · ${sideCompleted} side quest${sideCompleted === 1 ? "" : "s"} completed`;
      this.action.hidden = true;
    } else {
      this.status.textContent = `${tutorialCompleted}/${circuitSize} routes completed · speak with a village friend`;
      this.action.hidden = true;
    }
  }
}

function formatDeadline(deadlineAt: number): string {
  const remaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  return `Urgent: ${remaining}s remaining`;
}

function parcelConditionLabel(condition: NetQuestSnapshot["parcelCondition"]): string {
  return condition === "fragile"
    ? "Fragile — handle with care"
    : condition === "urgent"
      ? "Urgent — keep moving"
      : "Normal";
}
