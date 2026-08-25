import { describe, expect, it, vi } from "vitest";
import { AUTO_ADVANCE_DELAY_MS, acousticFeedbackCues, scheduleCorrectAutoAdvance } from "./feedback.js";

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

describe("correct-answer auto advance", () => {
  it("schedules exactly one second after a correct answer", () => {
    const callback = () => undefined;
    const schedule = vi.fn(() => 17);

    expect(scheduleCorrectAutoAdvance(true, true, callback, schedule)).toBe(17);
    expect(schedule).toHaveBeenCalledWith(callback, AUTO_ADVANCE_DELAY_MS);
    expect(AUTO_ADVANCE_DELAY_MS).toBe(1000);
  });

  it("does not schedule after a wrong answer or when disabled", () => {
    const schedule = vi.fn(() => 17);

    expect(scheduleCorrectAutoAdvance(true, false, () => undefined, schedule)).toBeNull();
    expect(scheduleCorrectAutoAdvance(false, true, () => undefined, schedule)).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });
});
