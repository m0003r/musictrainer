import { describe, expect, it } from "vitest";
import { acousticFeedbackCues } from "./feedback.js";

describe("acoustic answer feedback", () => {
  it("plays the expected pitch after visual-to-visual answers", () => {
    expect(acousticFeedbackCues({ source: "notation", target: "name" }, true)).toEqual([
      { pitch: "expected", delayMs: 0 }
    ]);
  });

  it("plays the selected wrong pitch and then the correct pitch", () => {
    expect(acousticFeedbackCues({ source: "notation", target: "keyboard" }, false)).toEqual([
      { pitch: "answered", delayMs: 0 },
      { pitch: "expected", delayMs: 650 }
    ]);
  });

  it("does not duplicate sound-choice feedback", () => {
    expect(acousticFeedbackCues({ source: "notation", target: "sound" }, true)).toEqual([]);
    expect(acousticFeedbackCues({ source: "sound", target: "name" }, true)).toEqual([]);
  });
});
