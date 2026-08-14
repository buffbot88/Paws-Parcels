import type { NetQuestSnapshot } from "../net/GameSocket.ts";

/** Small DOM quest tracker for the safe-hub tutorial; the server owns all state. */
export class QuestTracker {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly status: HTMLElement;
  private quests: NetQuestSnapshot[] = [];
  private offeredQuestId: string | null = null;
  private readonly onAccept: (questId: string) => void;

  constructor(onAccept: (questId: string) => void) {
    this.onAccept = onAccept;
    const root = document.createElement("section");
    root.className = "quest-tracker";
    root.setAttribute("aria-label", "Village tutorial quest");
    const eyebrow = document.createElement("span");
    eyebrow.className = "quest-tracker__eyebrow";
    eyebrow.textContent = "CLOVER VILLAGE TUTORIAL";
    const title = document.createElement("strong");
    title.className = "quest-tracker__title";
    const objective = document.createElement("span");
    objective.className = "quest-tracker__objective";
    const status = document.createElement("span");
    status.className = "quest-tracker__status";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "quest-tracker__action";
    action.addEventListener("click", () => {
      if (this.offeredQuestId !== null) this.onAccept(this.offeredQuestId);
    });
    root.append(eyebrow, title, objective, status, action);
    document.getElementById("game-container")?.appendChild(root);
    this.root = root;
    this.title = title;
    this.objective = objective;
    this.action = action;
    this.status = status;
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

  showMessage(message: string): void {
    this.status.textContent = message;
    this.status.classList.add("quest-tracker__status--notice");
    window.setTimeout(() => this.render(), 2600);
  }

  destroy(): void {
    this.root.remove();
  }

  private render(): void {
    const active = this.quests.find((quest) => quest.state === "active");
    const available = this.quests.find((quest) => quest.state === "available");
    const next = active ?? available;
    const completed = this.quests.filter((quest) => quest.state === "completed").length;
    this.root.hidden = next === undefined && this.quests.length === 0;
    this.title.textContent = next?.title ?? (completed >= 5 ? "Village tutorial complete" : "Explore Clover Village");
    this.objective.textContent = next?.description ?? "Meet the village couriers and learn the local routes.";
    this.status.classList.remove("quest-tracker__status--notice");
    if (active !== undefined) {
      this.status.textContent = `Delivery ${active.progress}/${active.requiredQuantity} · ${completed}/5 completed`;
      this.action.hidden = true;
    } else if (available !== undefined) {
      this.status.textContent = this.offeredQuestId === available.questId
        ? `New route ready · ${completed}/5 completed`
        : `Speak with ${available.giverId.replace("npc-", "")} to accept · ${completed}/5 completed`;
      this.action.textContent = "Accept route";
      this.action.hidden = this.offeredQuestId !== available.questId;
    } else if (completed >= 5) {
      this.status.textContent = "You know the village route. The wider forest awaits.";
      this.action.hidden = true;
    } else {
      this.status.textContent = `${completed}/5 routes completed · speak with a village friend`;
      this.action.hidden = true;
    }
  }
}
