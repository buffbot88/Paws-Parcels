import type { NetQuestSnapshot } from "../net/GameSocket.ts";
import { HudModal } from "./HudModal.ts";
import { questProgressLabel } from "./QuestTracker.ts";
import type { HeldItem } from "./hud/questMarkers.ts";
import npcsJson from "../data/npcs.json" with { type: "json" };
import itemsJson from "../data/items.json" with { type: "json" };

const NPC_NAMES = new Map(npcsJson.npcs.map((npc) => [npc.id, npc.name]));
const ITEM_NAMES = new Map(itemsJson.items.map((item) => [item.id, item.name]));

function npcName(id: string): string {
  return NPC_NAMES.get(id) ?? id.replace(/^npc-/, "");
}

/** Read-only quest journal (J / top-bar menu) built from the server's quest snapshots. */
export class QuestLogPanel {
  static instance: QuestLogPanel | null = null;
  private readonly modal: HudModal;
  private quests: readonly NetQuestSnapshot[] = [];
  /** Held items, so loot hand-ins show "Held N/M" like the tracker. */
  private inventory: readonly HeldItem[] = [];

  constructor() {
    this.modal = new HudModal({
      className: "quest-log-panel",
      eyebrow: "COURIER JOURNAL",
      title: "Quest log",
      toggleKey: "questLog",
      onOpen: () => this.render(),
    });
    QuestLogPanel.instance = this;
  }

  setQuests(quests: readonly NetQuestSnapshot[]): void {
    this.quests = quests;
    if (this.modal.isOpen()) this.render();
  }

  setInventory(items: readonly HeldItem[]): void {
    this.inventory = items;
    if (this.modal.isOpen()) this.render();
  }

  open(): void {
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    if (QuestLogPanel.instance === this) QuestLogPanel.instance = null;
    this.modal.destroy();
  }

  private render(): void {
    const body = this.modal.body;
    body.replaceChildren();
    if (this.quests.length === 0) {
      body.appendChild(paragraph("quest-log__empty", "No routes yet — talk to a villager to find your first delivery."));
      return;
    }
    const groups: [string, NetQuestSnapshot["state"]][] = [
      ["Active", "active"],
      ["Available", "available"],
      ["Locked", "locked"],
    ];
    for (const [label, state] of groups) {
      const entries = this.quests.filter((quest) => quest.state === state);
      if (entries.length === 0) continue;
      const section = document.createElement("section");
      section.className = "quest-log__section";
      const heading = document.createElement("h3");
      heading.className = "quest-log__heading";
      heading.textContent = `${label} (${entries.length})`;
      section.append(heading, ...entries.map((quest) => questCard(quest, this.inventory)));
      body.appendChild(section);
    }
    const completed = this.quests.filter((quest) => quest.state === "completed");
    if (completed.length > 0) {
      const details = document.createElement("details");
      details.className = "quest-log__section quest-log__completed";
      const summary = document.createElement("summary");
      summary.className = "quest-log__heading";
      summary.textContent = `Completed (${completed.length})`;
      details.append(summary, ...completed.map((quest) => questCard(quest, this.inventory)));
      body.appendChild(details);
    }
  }
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function questCard(quest: NetQuestSnapshot, inventory: readonly HeldItem[]): HTMLElement {
  const card = document.createElement("article");
  card.className = `quest-log__quest quest-log__quest--${quest.state}`;
  const title = document.createElement("h4");
  title.className = "quest-log__title";
  title.textContent = quest.sideQuest ? `${quest.title} · side quest` : quest.title;
  card.append(title, paragraph("quest-log__description", quest.description));

  const route = quest.targetId !== null && quest.targetId !== ""
    ? `From ${npcName(quest.giverId)} → ${npcName(quest.targetId)}`
    : `From ${npcName(quest.giverId)}`;
  card.appendChild(paragraph("quest-log__meta", route));

  if (quest.state === "locked") {
    card.appendChild(paragraph("quest-log__meta", quest.friendshipGate !== null
      ? `Requires friendship level ${quest.friendshipGate.level} with ${npcName(quest.friendshipGate.npcId)}`
      : "Unlocks after earlier routes"));
  }
  if (quest.state === "active") {
    card.appendChild(paragraph("quest-log__progress", questProgressLabel(quest, inventory)));
    if (quest.type === "delivery" && quest.parcelCondition !== "normal") {
      card.appendChild(paragraph("quest-log__meta", `Parcel: ${quest.parcelCondition === "fragile" ? "Fragile — handle with care" : "Urgent — keep moving"}`));
    }
    if (quest.deadlineAt !== null) {
      card.appendChild(paragraph("quest-log__meta", `Due by ${new Date(quest.deadlineAt).toLocaleTimeString()}`));
    }
  }

  const rewards = [`${quest.stampReward} stamps`, `${quest.xpReward} XP`];
  if (quest.rewardItemId !== null && quest.rewardItemId !== "") rewards.push(ITEM_NAMES.get(quest.rewardItemId) ?? quest.rewardItemId);
  if (quest.reputationNpcId !== null && quest.reputationNpcId !== "" && quest.reputationPoints > 0) {
    rewards.push(`+${quest.reputationPoints} friendship with ${npcName(quest.reputationNpcId)}`);
  }
  card.appendChild(paragraph("quest-log__rewards", `Rewards: ${rewards.join(" · ")}`));
  return card;
}
