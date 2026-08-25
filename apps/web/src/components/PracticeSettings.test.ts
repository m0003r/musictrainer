import { describe, expect, it } from "vitest";
import { trappedFocusIndex } from "./PracticeSettings.js";

describe("practice settings drawer focus trap", () => {
  it("wraps Tab from the last control to the first", () => {
    expect(trappedFocusIndex(4, 5, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    expect(trappedFocusIndex(0, 5, true)).toBe(4);
  });

  it("pulls focus into the drawer when focus starts outside", () => {
    expect(trappedFocusIndex(-1, 5, false)).toBe(0);
    expect(trappedFocusIndex(-1, 5, true)).toBe(4);
  });

  it("allows normal movement between internal controls", () => {
    expect(trappedFocusIndex(2, 5, false)).toBeNull();
    expect(trappedFocusIndex(2, 5, true)).toBeNull();
  });
});
