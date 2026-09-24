import type { NetQuestSnapshot } from "../net/GameSocket.ts";
import { createIcon } from "./hud/icons.ts";
import { createPanel, createPill, createKeyHint, createDivider } from "./hud/primitives.ts";
import { hudColumn } from "./hud/layer.ts";
import { heldForHandIn, type HeldItem } from "./hud/questMarkers.ts";

const NOTICE_MS = 2600;
/** Local-only UI preference: whether the tracker card starts collapsed. */
export const TRACKER_COLLAPSED_KEY = "paws.ui.trackerCollapsed";

/** The saved collapse preference; false when storage is blocked or empty. */
export function readTrackerCollapsed(): boolean {
  try { return globalThis.localStorage?.getItem(TRACKER_COLLAPSED_KEY) === "1"; } catch { return false; }
}

/** Best-effort save of the collapse preference. */
export function writeTrackerCollapsed(collapsed: boolean): void {
  try { globalThis.localStorage?.setItem(TRACKER_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* best-effort */ }
}

/**
 * HUD v4 quest tracker: tab pill on the card edge, dominant title, objective
 * row. Bottom-left, stacked above the village chat.
 *
 * The tab is a button that toggles the card. That matters: collapsing used to
 * hide the entire panel body — including the chevron — so the only control
 * that could expand it again was the one being hidden, and a collapsed
 * tracker could not be reopened at all.
 */
export class QuestTracker {
  private readonly root: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly title: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly tab: HTMLButtonElement;
  private quests: NetQuestSnapshot[] = [];
  private inventory: readonly HeldItem[] = [];
  private offeredQuestId: string | null = null;
  private readonly onAccept: (questId: string) => void;
  private readonly countdownTimer: number;
  /** render() leaves a notice on screen until this time (ms epoch). */
  private noticeUntil = 0;
  private noticeTimer: number | null = null;
  private collapsed = false;

  constructor(onAccept: (questId: string) => void) {
    this.onAccept = onAccept;
    const panel = createPanel({ className: "quest-tracker" });
    this.root = panel.root;
    this.panelBody = panel.body;

    // Category tab attached to the top edge, and the collapse/expand control
    // that survives collapsing (the card body is what gets hidden).
    const tabContent = createPill("Main Quest", { icon: "book-open" });
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `${tabContent.className} quest-tracker__tab`;
    tab.replaceChildren(...tabContent.childNodes);
    tab.setAttribute("aria-controls", "quest-tracker-body");
    tab.addEventListener("click", () => this.toggleCollapsed());
    this.tab = tab;

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
    this.toggle.addEventListener("click", () => this.toggleCollapsed());
    header.append(this.title, this.toggle);
    this.panelBody.id = "quest-tracker-body";

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
    hudColumn("bottom-left")?.appendChild(this.root);
    this.setCollapsed(readTrackerCollapsed());
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

  /** Server inventory snapshot, used only to display hand-in counts and markers. */
  setInventory(items: readonly HeldItem[]): void {
    this.inventory = items;
    this.render();
  }

  getInventory(): readonly HeldItem[] {
    return this.inventory;
  }

  /** Only an NPC interaction can create an acceptance offer. */
  setOffer(questId: string | null): void {
    this.offeredQuestId = questId;
    this.render();
  }

  getActiveQuest(): NetQuestSnapshot | undefined {
    return this.quests.find((quest) => quest.state === "active");
  }

  /** Every quest the server has sent, so the compass can find the next stop. */
  getQuests(): readonly NetQuestSnapshot[] {
    return this.quests;
  }

  showMessage(message: string): void {
    this.status.textContent = message;
    this.status.classList.add("quest-tracker__status--notice");
    this.noticeUntil = Date.now() + NOTICE_MS;
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.noticeUntil = 0;
      this.render();
    }, NOTICE_MS);
  }

  destroy(): void {
    window.clearInterval(this.countdownTimer);
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.root.remove();
  }

  private toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed);
    writeTrackerCollapsed(this.collapsed);
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.root.classList.toggle("quest-tracker--collapsed", collapsed);
    this.toggle.setAttribute("aria-expanded", String(!collapsed));
    this.toggle.setAttribute("aria-label", collapsed ? "Expand quest tracker" : "Collapse quest tracker");
    this.toggle.replaceChildren(createIcon(collapsed ? "chevron-down" : "chevron-up", { size: 14 }));
    this.tab.setAttribute("aria-expanded", String(!collapsed));
    this.tab.setAttribute("aria-label", collapsed ? "Expand quest tracker" : "Collapse quest tracker");
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
    let status: string;
    if (active !== undefined) {
      const deadline = active.deadlineAt === null ? "" : ` · ${formatDeadline(active.deadlineAt)}`;
      const objective = active.searchObjectId !== null && active.progress === 0 ? ` · Search: ${active.findAt ?? "the marked location"}` : "";
      status = `${questProgressLabel(active, this.inventory)} · Circuit ${tutorialCompleted}/${circuitSize} · Side quests ${sideCompleted}${deadline}${objective}`;
      this.action.hidden = true;
    } else if (available !== undefined) {
      status = this.offeredQuestId === available.questId
        ? `New ${available.sideQuest ? "side quest" : "route"} ready · Circuit ${tutorialCompleted}/${circuitSize}`
        : `Speak with ${available.giverId.replace("npc-", "")} to accept · Circuit ${tutorialCompleted}/${circuitSize}`;
      this.action.textContent = available.sideQuest ? "Accept side quest" : "Accept route";
      this.action.hidden = this.offeredQuestId !== available.questId;
    } else if (circuitDone) {
      status = `Circuit complete · ${sideCompleted} side quest${sideCompleted === 1 ? "" : "s"} completed`;
      this.action.hidden = true;
    } else {
      status = `${tutorialCompleted}/${circuitSize} routes completed · speak with a village friend`;
      this.action.hidden = true;
    }
    // A live notice outlasts the 1s deadline re-render and quest-state updates.
    if (Date.now() < this.noticeUntil) return;
    this.status.classList.remove("quest-tracker__status--notice");
    this.status.textContent = status;
  }
}

/**
 * The active quest's tally: "Wild Boar 2/4", "Delivery 0/1 · Stops 1/2", "Objective 1/3", or
 * "Held 2/5" for a loot hand-in, whose server progress never counts loot.
 */
export function questProgressLabel(
  quest: Pick<NetQuestSnapshot, "type" | "progress" | "requiredQuantity" | "defeat" | "additionalStops" | "visitedStops">
    & Partial<Pick<NetQuestSnapshot, "requiredItemId" | "searchObjectId">>,
  inventory: readonly HeldItem[] = [],
): string {
  if (quest.defeat !== null) return `${quest.defeat.monsterName} ${Math.min(quest.progress, quest.defeat.count)}/${quest.defeat.count}`;
  const itemKey = quest.requiredItemId;
  if (quest.type !== "delivery" && itemKey != null && quest.searchObjectId == null) {
    return `Held ${Math.min(heldForHandIn(itemKey, inventory), quest.requiredQuantity)}/${quest.requiredQuantity}`;
  }
  const base = `${quest.type === "delivery" ? "Delivery" : "Objective"} ${quest.progress}/${quest.requiredQuantity}`;
  if (quest.additionalStops.length === 0) return base;
  const visited = quest.additionalStops.filter((stop) => quest.visitedStops.includes(stop)).length;
  return `${base} · Stops ${visited}/${quest.additionalStops.length}`;
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
