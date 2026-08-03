import { describe, expect, it } from "vitest";
import {
  CHARACTER_NAME_RE,
  deskStepFor,
  validateCharacterName,
} from "../../src/ui/characterFlow.ts";

describe("deskStepFor", () => {
  it("routes a fresh account to creation", () => {
    expect(deskStepFor(0)).toEqual({ step: "create" });
  });

  it("routes a single character straight into the game", () => {
    expect(deskStepFor(1)).toEqual({ step: "play" });
  });

  it("routes multiple characters to the select desk", () => {
    expect(deskStepFor(2)).toEqual({ step: "select" });
    expect(deskStepFor(5)).toEqual({ step: "select" });
  });
});

describe("validateCharacterName", () => {
  it("accepts cozy, valid names", () => {
    expect(validateCharacterName("Maple Meadowpaw")).toBeNull();
    expect(validateCharacterName("Maple")).toBeNull();
    expect(validateCharacterName("O'Malley")).toBeNull();
    expect(validateCharacterName("  Pip  ")).toBeNull(); // trims
  });

  it("rejects names that are too short or empty", () => {
    expect(validateCharacterName("")).toMatch(/at least 2/);
    expect(validateCharacterName("A")).toMatch(/at least 2/);
    expect(validateCharacterName("   ")).toMatch(/at least 2/);
  });

  it("rejects names longer than 50 characters", () => {
    expect(validateCharacterName("M".repeat(51))).toMatch(/50 characters/);
    expect(validateCharacterName("M".repeat(50))).toBeNull();
  });

  it("rejects disallowed characters", () => {
    expect(validateCharacterName("Maple!")).toMatch(/letters, numbers, spaces/);
    expect(validateCharacterName("M@ple")).toMatch(/letters, numbers, spaces/);
    expect(validateCharacterName("Maple🍂")).toMatch(/letters, numbers, spaces/);
  });

  it("matches the server's acceptance regex exactly", () => {
    expect("Maple_2.O'leary-".match(CHARACTER_NAME_RE)).not.toBeNull();
    expect("Maple!".match(CHARACTER_NAME_RE)).toBeNull();
  });
});
