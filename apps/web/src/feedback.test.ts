import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_ADVANCE_DELAY_MS,
  CORRECT_FEEDBACK_MAX_MS,
  WRONG_ANSWER_GAP_MS,
  WRONG_EXPECTED_PAUSE_MS,
  acousticFeedbackCues,
  scheduleCorrectAutoAdvance,
  startAnswerFeedback
} from "./feedback.js";

const visualDirection = { source: "notation", target: "name" } as const;

afterEach(() => vi.useRealTimers());

describe("answer feedback orchestration", () => {
  it("starts visual correct feedback immediately and finishes lengths 1-5 by 900ms", () => {
    for (let length = 1; length <= 5; length += 1) {
      const expected = Array.from({ length }, (_, index) => 60 + index);
      const playSequence = vi.fn((_midis: readonly number[], _gapMs: number) => ({ cancel: vi.fn() }));

      const feedback = startAnswerFeedback({
        direction: visualDirection,
        correct: true,
        answeredMidis: expected,
        expectedMidis: expected,
        autoAdvance: false,
        playSequence,
        onAdvance: vi.fn()
      });

      expect(playSequence).toHaveBeenCalledOnce();
      const [played, gapMs] = playSequence.mock.calls[0]!;
      expect(played).toEqual(expected);
      expect(length * gapMs).toBeLessThanOrEqual(CORRECT_FEEDBACK_MAX_MS);
      feedback.cancel();
    }
  });

  it("plays every wrong sequence first and starts expected only after its end for lengths 1-5", () => {
    vi.useFakeTimers();
    for (let length = 1; length <= 5; length += 1) {
      const answered = Array.from({ length }, (_, index) => 50 + index);
      const expected = Array.from({ length }, (_, index) => 70 + index);
      const playSequence = vi.fn(() => ({ cancel: vi.fn() }));
      const expectedStartMs = length * WRONG_ANSWER_GAP_MS + WRONG_EXPECTED_PAUSE_MS;

      const feedback = startAnswerFeedback({
        direction: visualDirection,
        correct: false,
        answeredMidis: answered,
        expectedMidis: expected,
        autoAdvance: true,
        playSequence,
        onAdvance: vi.fn()
      });

      expect(playSequence).toHaveBeenCalledWith(answered, WRONG_ANSWER_GAP_MS);
      vi.advanceTimersByTime(expectedStartMs - 1);
      expect(playSequence).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(playSequence).toHaveBeenLastCalledWith(expected, WRONG_ANSWER_GAP_MS);
      expect(expectedStartMs).toBeGreaterThan(length * WRONG_ANSWER_GAP_MS);
      feedback.cancel();
      vi.clearAllTimers();
    }
  });

  it("does not duplicate correct feedback when sound was already part of the question", () => {
    expect(acousticFeedbackCues({ source: "notation", target: "sound" }, true, 3)).toEqual([]);
    expect(acousticFeedbackCues({ source: "sound", target: "name" }, true, 3)).toEqual([]);
  });

  it("auto-advances only a correct answer at exactly 1000ms", () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    const onWrongAdvance = vi.fn();
    const onDisabledAdvance = vi.fn();
    const playSequence = vi.fn(() => ({ cancel: vi.fn() }));
    startAnswerFeedback({
      direction: visualDirection,
      correct: true,
      answeredMidis: [60],
      expectedMidis: [60],
      autoAdvance: true,
      playSequence,
      onAdvance
    });
    startAnswerFeedback({
      direction: visualDirection,
      correct: false,
      answeredMidis: [59],
      expectedMidis: [60],
      autoAdvance: true,
      playSequence,
      onAdvance: onWrongAdvance
    });
    startAnswerFeedback({
      direction: visualDirection,
      correct: true,
      answeredMidis: [60],
      expectedMidis: [60],
      autoAdvance: false,
      playSequence,
      onAdvance: onDisabledAdvance
    });

    vi.advanceTimersByTime(AUTO_ADVANCE_DELAY_MS - 1);
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(onWrongAdvance).not.toHaveBeenCalled();
    expect(onDisabledAdvance).not.toHaveBeenCalled();

    const schedule = vi.fn((_callback: () => void, _delayMs: number) => (
      17 as unknown as ReturnType<typeof globalThis.setTimeout>
    ));
    expect(scheduleCorrectAutoAdvance(true, false, onAdvance, schedule)).toBeNull();
    expect(scheduleCorrectAutoAdvance(false, true, onAdvance, schedule)).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("cancels playback and every pending wrong-feedback callback", () => {
    vi.useFakeTimers();
    const activeCancel = vi.fn();
    const playSequence = vi.fn(() => ({ cancel: activeCancel }));
    const onAdvance = vi.fn();
    const feedback = startAnswerFeedback({
      direction: visualDirection,
      correct: false,
      answeredMidis: [48, 50, 52],
      expectedMidis: [60, 62, 64],
      autoAdvance: true,
      playSequence,
      onAdvance
    });

    feedback.cancel();
    vi.runAllTimers();

    expect(activeCancel).toHaveBeenCalledOnce();
    expect(playSequence).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels correct auto-advance before it can run", () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    const feedback = startAnswerFeedback({
      direction: visualDirection,
      correct: true,
      answeredMidis: [60, 62],
      expectedMidis: [60, 62],
      autoAdvance: true,
      playSequence: () => ({ cancel: vi.fn() }),
      onAdvance
    });

    feedback.cancel();
    vi.runAllTimers();

    expect(onAdvance).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
