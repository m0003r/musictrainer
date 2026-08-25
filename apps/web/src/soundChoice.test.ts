import { describe, expect, it } from "vitest";
import { createNaturalRange } from "@music-trainer/core";
import { soundChoiceKeyboardAction } from "./soundChoice.js";

const options = createNaturalRange(60, 69).slice(0, 6);

describe("sound answer keyboard interaction", () => {
  it("auditions numbered candidates instead of submitting them immediately", () => {
    expect(soundChoiceKeyboardAction("2", options, null)).toEqual({ kind: "audition", midi: options[1]!.midi });
  });

  it("requires an auditioned candidate before Enter can confirm", () => {
    expect(soundChoiceKeyboardAction("Enter", options, null)).toBeNull();
    expect(soundChoiceKeyboardAction("Enter", options, options[2]!.midi)).toEqual({
      kind: "confirm",
      midi: options[2]!.midi
    });
  });

  it("ignores unrelated keys", () => {
    expect(soundChoiceKeyboardAction("6", options, null)).toEqual({ kind: "audition", midi: options[5]!.midi });
    expect(soundChoiceKeyboardAction("7", options, null)).toBeNull();
    expect(soundChoiceKeyboardAction("Space", options, null)).toBeNull();
  });
});
