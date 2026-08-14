import { describe, expect, it } from "vitest";
import {
  isNewClientEntry,
  isSafeToReloadUpdate,
} from "../../src/clientUpdate.ts";

describe("isNewClientEntry", () => {
  it("detects a different valid hashed entry", () => {
    expect(isNewClientEntry("index-old123.js", "index-new456.js")).toBe(true);
  });

  it("accepts the same entry as current", () => {
    expect(isNewClientEntry("index-same123.js", "index-same123.js")).toBe(false);
    expect(
      isNewClientEntry("static/index-same123.js", "static/index-same123.js"),
    ).toBe(false);
  });

  it("detects updates for the deployed static asset path", () => {
    expect(
      isNewClientEntry("static/index-old123.js", "static/index-new456.js"),
    ).toBe(true);
  });

  it("ignores malformed manifest values", () => {
    expect(isNewClientEntry("index-old123.js", "index.html")).toBe(false);
    expect(isNewClientEntry("main.js", "index-new456.js")).toBe(false);
    expect(isNewClientEntry("static/main.js", "static/index-new456.js")).toBe(false);
    expect(isNewClientEntry("index-old123.js", "../index-new456.js")).toBe(false);
    expect(isNewClientEntry("index-old123.js", "")).toBe(false);
  });
});

describe("isSafeToReloadUpdate", () => {
  it("allows a visible game with no active blocking UI", () => {
    expect(
      isSafeToReloadUpdate({
        visibilityState: "visible",
        activeElementTagName: "CANVAS",
        activeElementContentEditable: false,
        hasBlockingOverlay: false,
      }),
    ).toBe(true);
  });

  it("defers while the tab is hidden or a dialogue is open", () => {
    expect(
      isSafeToReloadUpdate({
        visibilityState: "hidden",
        activeElementTagName: "CANVAS",
        activeElementContentEditable: false,
        hasBlockingOverlay: false,
      }),
    ).toBe(false);
    expect(
      isSafeToReloadUpdate({
        visibilityState: "visible",
        activeElementTagName: "CANVAS",
        activeElementContentEditable: false,
        hasBlockingOverlay: true,
      }),
    ).toBe(false);
  });

  it("defers while the player is editing a form or contenteditable", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(
        isSafeToReloadUpdate({
          visibilityState: "visible",
          activeElementTagName: tagName,
          activeElementContentEditable: false,
          hasBlockingOverlay: false,
        }),
      ).toBe(false);
    }
    expect(
      isSafeToReloadUpdate({
        visibilityState: "visible",
        activeElementTagName: "DIV",
        activeElementContentEditable: true,
        hasBlockingOverlay: false,
      }),
    ).toBe(false);
  });
});
