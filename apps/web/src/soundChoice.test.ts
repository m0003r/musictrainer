import { describe, expect, it } from "vitest";
import { soundChoiceKeyboardAction } from "./soundChoice.js";

const options = [[60, 64], [62, 65], [64, 67], [65, 69], [67, 71], [69, 72]];

describe("sound answer keyboard interaction", () => {
  it("auditions numbered candidates instead of submitting them immediately", () => {
    expect(soundChoiceKeyboardAction("2", options, null)).toEqual({ kind: "audition", optionIndex: 1 });
  });

  it("requires an auditioned candidate before Enter can confirm", () => {
    expect(soundChoiceKeyboardAction("Enter", options, null)).toBeNull();
    expect(soundChoiceKeyboardAction("Enter", options, 2)).toEqual({
      kind: "confirm",
      optionIndex: 2
    });
  });

  it("rejects a stale active choice that is no longer in the options", () => {
    expect(soundChoiceKeyboardAction("Enter", options, options.length)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(soundChoiceKeyboardAction("6", options, null)).toEqual({ kind: "audition", optionIndex: 5 });
    expect(soundChoiceKeyboardAction("7", options, null)).toBeNull();
    expect(soundChoiceKeyboardAction("Space", options, null)).toBeNull();
  });
});
