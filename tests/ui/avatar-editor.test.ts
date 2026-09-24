/** The look editor's state changes and the salon's save/cancel wiring (no DOM). */
import { describe, expect, it, vi } from "vitest";
import { BODY_PARTS, speciesById } from "../../src/game/appearance.ts";
import {
  choosesSpecies,
  editableParts,
  partColor,
  withPartColor,
  withSpecies,
} from "../../src/ui/avatarDraft.ts";
import { salonActions } from "../../src/ui/SalonPanel.ts";

// The real module pulls in Phaser, which needs a browser.
vi.mock("../../src/game/classAssets.ts", () => ({ courierFrameUrls: () => [] }));

describe("avatar draft", () => {
  it("switching species resets the colours to that species' defaults", () => {
    const wolf = withPartColor(withSpecies("wolf", "fox-archer"), "fur", "#123456", "fox-archer");
    expect(wolf.colors.fur).toBe("#123456");
    const cat = withSpecies("cat", "fox-archer");
    expect(cat).toEqual({ species: "cat", colors: {} });
    expect(partColor(withSpecies("panda", "cat-mage"), "fur")).toBe(speciesById("panda")?.colors.fur);
  });

  it("offers only the parts the species' body can recolour", () => {
    expect(editableParts(withSpecies("mouse", "bear-warrior"))).toEqual(BODY_PARTS.cat);
    expect(editableParts(withSpecies("panda", "fox-archer"))).toEqual(BODY_PARTS.bear);
    expect(editableParts(withSpecies("panda", "fox-archer"))).not.toContain("fur2");
  });

  it("normalizes painted colours and drops parts the body lacks", () => {
    const cat = withSpecies("cat", "cat-mage");
    expect(withPartColor(cat, "eyes", "#ABCDEF", "cat-mage").colors).toEqual({ eyes: "#abcdef" });
    expect(withPartColor(cat, "outfit", "#abcdef", "cat-mage").colors).toEqual({});
    expect(withPartColor(cat, "fur", "red", "cat-mage").colors).toEqual({});
  });

  it("clearing a part falls back to the species default, then the art's own tone", () => {
    const painted = withPartColor(withSpecies("bear", "bear-warrior"), "eyes", "#00ff00", "bear-warrior");
    const cleared = withPartColor(painted, "eyes", null, "bear-warrior");
    expect(cleared.colors).toEqual({});
    expect(partColor(cleared, "eyes")).toBe("#0e4aa0");
  });

  it("knows whether a saved look chose a species", () => {
    expect(choosesSpecies({})).toBe(false);
    expect(choosesSpecies(null)).toBe(false);
    expect(choosesSpecies({ species: "dragon" })).toBe(false);
    expect(choosesSpecies({ species: "raccoon" })).toBe(true);
  });
});

describe("salon actions", () => {
  it("save hands the edited look to onSave, then closes", () => {
    const edited = withPartColor(withSpecies("red-panda", "fox-archer"), "accent", "#4f86cd", "fox-archer");
    const onSave = vi.fn();
    const close = vi.fn();
    salonActions(() => edited, onSave, close).save();
    expect(onSave).toHaveBeenCalledWith({ species: "red-panda", colors: { accent: "#4f86cd" } });
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancel closes without saving", () => {
    const onSave = vi.fn();
    const close = vi.fn();
    salonActions(() => withSpecies("fox", "fox-archer"), onSave, close).cancel();
    expect(onSave).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
