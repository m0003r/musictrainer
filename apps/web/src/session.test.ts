import { describe, expect, it } from "vitest";
import { directionKey } from "@music-trainer/core";
import { chooseMixedDirection, recordSessionAttempt } from "./session.js";

describe("session scheduling", () => {
  it("records attempts by directed relationship", () => {
    const direction = { source: "notation", target: "keyboard" } as const;
    const stats = recordSessionAttempt({}, direction, true);
    expect(stats[directionKey(direction)]).toEqual({ attempts: 1, correct: 1 });
  });

  it("returns a valid direction for mixed practice", () => {
    const direction = chooseMixedDirection({}, () => 0);
    expect(direction.source).not.toBe(direction.target);
  });

  it("schedules only among checked source-target relationships", () => {
    const allowed = [
      { source: "notation", target: "keyboard" },
      { source: "sound", target: "keyboard" }
    ] as const;
    expect(chooseMixedDirection({}, () => 0, allowed)).toEqual(allowed[0]);
    expect(chooseMixedDirection({}, () => 0.99, allowed)).toEqual(allowed[1]);
  });

  it("updates the learner's own response-time average", () => {
    const direction = { source: "sound", target: "name" } as const;
    const once = recordSessionAttempt({}, direction, true, 1200);
    const twice = recordSessionAttempt(once, direction, true, 800);
    expect(twice[directionKey(direction)]).toMatchObject({ attempts: 2, correct: 2, averageResponseTimeMs: 1000 });
  });
});
