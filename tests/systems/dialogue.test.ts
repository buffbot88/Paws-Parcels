import { describe, expect, it } from "vitest";
import { selectDialogueSet } from "../../src/systems/DialogueService.ts";
import type { DialogueSet } from "../../src/types/DialogueTypes.ts";

const sets: DialogueSet[] = [
  {
    id: "greet",
    npcId: "npc-pip",
    minFriendship: 0,
    maxFriendship: 1,
    lines: ["greeting"],
  },
  {
    id: "friend",
    npcId: "npc-pip",
    minFriendship: 2,
    maxFriendship: 4,
    lines: ["friend greeting"],
  },
  {
    id: "maple-greet",
    npcId: "npc-maple",
    minFriendship: 0,
    lines: ["maple hello"],
  },
];

describe("selectDialogueSet", () => {
  it("returns the set whose range contains the friendship level", () => {
    expect(selectDialogueSet(sets, "npc-pip", 0)?.id).toBe("greet");
    expect(selectDialogueSet(sets, "npc-pip", 2)?.id).toBe("friend");
    expect(selectDialogueSet(sets, "npc-pip", 4)?.id).toBe("friend");
  });

  it("defaults maxFriendship to 4 when omitted", () => {
    expect(selectDialogueSet(sets, "npc-maple", 4)?.id).toBe("maple-greet");
  });

  it("falls back to the lowest-gated set when nothing matches the level", () => {
    // Only a level-3 set exists for this NPC; asking at level 0 falls back to it.
    const onlyHigh: DialogueSet[] = [
      { id: "high", npcId: "npc-x", minFriendship: 3, lines: ["later"] },
    ];
    expect(selectDialogueSet(onlyHigh, "npc-x", 0)?.id).toBe("high");
  });

  it("returns null when the NPC has no dialogue sets", () => {
    expect(selectDialogueSet(sets, "npc-nobody", 0)).toBeNull();
  });
});
