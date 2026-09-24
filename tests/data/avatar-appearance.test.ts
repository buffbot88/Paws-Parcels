import { describe, expect, it } from "vitest";
import {
  BODY_PARTS,
  SPECIES,
  lookArtId,
  normalizeAppearance,
  resolveLook,
} from "../../src/game/appearance.ts";
import { classifyColor, recolorPixels } from "../../src/game/avatarPalette.ts";

describe("appearance", () => {
  it("defaults a courier with no saved look to their class's animal", () => {
    expect(normalizeAppearance({}, "fox-archer")).toEqual({ species: "fox", colors: {} });
    expect(normalizeAppearance(null, "bear-warrior")).toEqual({ species: "bear", colors: {} });
    expect(normalizeAppearance({ species: "dragon" }, "cat-mage").species).toBe("cat");
  });

  it("lets any class wear any species", () => {
    expect(normalizeAppearance({ species: "wolf" }, "bear-warrior").species).toBe("wolf");
  });

  it("keeps only well-formed colours for parts the body can paint", () => {
    const appearance = normalizeAppearance(
      { species: "mouse", colors: { fur: "#AABBCC", outfit: "#112233", eyes: "red", accent: 7 } },
      "cat-mage",
    );
    // The cat body has no outfit or trim of its own.
    expect(appearance.colors).toEqual({ fur: "#aabbcc" });
  });

  it("layers the courier's picks over the species defaults", () => {
    const look = resolveLook({ species: "wolf", colors: { eyes: "#00ff00" } }, "fox-archer");
    expect(look.body).toBe("fox");
    expect(look.colors.fur).toBe("#8f96a3");
    expect(look.colors.eyes).toBe("#00ff00");
  });

  it("names an unpainted body by its class art and a painted one by its colours", () => {
    expect(lookArtId({ body: "fox", colors: {} })).toBe("fox-archer");
    expect(lookArtId({ body: "fox", colors: { fur: "#8f96a3" } })).toBe("look-fox-fur8f96a3");
  });

  it("only gives species colours for parts their body has", () => {
    for (const species of SPECIES) {
      for (const part of Object.keys(species.colors)) {
        expect(BODY_PARTS[species.body], `${species.id}.${part}`).toContain(part);
      }
    }
  });
});

describe("avatar palette", () => {
  it("recognises the fox's fur, face and outline", () => {
    expect(classifyColor("fox", 0xfc, 0xb6, 0x5e)).toBe("fur");
    expect(classifyColor("fox", 0xf6, 0xe7, 0xdb)).toBe("fur2");
    expect(classifyColor("fox", 0x10, 0x08, 0x08)).toBeNull();
  });

  it("recolours a part and keeps its shading", () => {
    // A 3x1 strip, padded with transparency: light fur, mid fur, dark fur.
    const w = 5;
    const data = new Uint8ClampedArray(w * 4);
    const put = (x: number, rgb: [number, number, number]): void => data.set([...rgb, 255], x * 4);
    put(1, [0xfc, 0xd1, 0x89]);
    put(2, [0xfc, 0xb6, 0x5e]);
    put(3, [0xd8, 0x87, 0x4a]);
    const out = recolorPixels(data, w, 1, "fox", { fur: "#4060c0" });
    const lum = (x: number): number => (out[x * 4] ?? 0) + (out[x * 4 + 1] ?? 0) + (out[x * 4 + 2] ?? 0);
    // Now blue...
    for (const x of [1, 2, 3]) expect(out[x * 4 + 2] ?? 0).toBeGreaterThan(out[x * 4] ?? 0);
    // ...and still light-to-dark.
    expect(lum(1)).toBeGreaterThan(lum(2));
    expect(lum(2)).toBeGreaterThan(lum(3));
  });

  it("never paints dark outline pixels on the silhouette edge", () => {
    const data = new Uint8ClampedArray([0x2f, 0x22, 0x2b, 255]);
    expect([...recolorPixels(data, 1, 1, "fox", { outfit: "#ff0000" })]).toEqual([0x2f, 0x22, 0x2b, 255]);
  });

  it("leaves parts without a colour untouched", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 0xfc, 0xb6, 0x5e, 255, 0, 0, 0, 0]);
    expect([...recolorPixels(data, 3, 1, "fox", { eyes: "#00ff00" })]).toEqual([...data]);
  });
});
