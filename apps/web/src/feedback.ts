import type { Direction } from "@music-trainer/core";

export const AUTO_ADVANCE_DELAY_MS = 1000;
export const WRONG_ANSWER_GAP_MS = 520;
export const WRONG_EXPECTED_PAUSE_MS = 120;
export const CORRECT_FEEDBACK_MAX_MS = 900;

export interface AcousticFeedbackCue {
  sequence: "answered" | "expected";
  delayMs: number;
  gapMs: number;
}

export interface CancellablePlayback {
  cancel(): void;
}

export interface AnswerFeedback {
  cancel(): void;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

function sequenceDurationMs(length: number, gapMs: number): number {
  return Math.max(1, length) * gapMs;
}

/** Builds the same acoustic plan that App executes through startAnswerFeedback. */
export function acousticFeedbackCues(
  direction: Direction,
  correct: boolean,
  answeredLength: number
): AcousticFeedbackCue[] {
  if (!correct) {
    return [
      { sequence: "answered", delayMs: 0, gapMs: WRONG_ANSWER_GAP_MS },
      {
        sequence: "expected",
        delayMs: sequenceDurationMs(answeredLength, WRONG_ANSWER_GAP_MS) + WRONG_EXPECTED_PAUSE_MS,
        gapMs: WRONG_ANSWER_GAP_MS
      }
    ];
  }
  const alreadyHeard = direction.source === "sound" || direction.target === "sound";
  if (alreadyHeard) return [];
  return [{
    sequence: "expected",
    delayMs: 0,
    gapMs: Math.min(WRONG_ANSWER_GAP_MS, Math.floor(CORRECT_FEEDBACK_MAX_MS / Math.max(1, answeredLength)))
  }];
}

export function scheduleCorrectAutoAdvance(
  enabled: boolean,
  correct: boolean,
  onAdvance: () => void,
  schedule: (callback: () => void, delayMs: number) => TimerHandle = (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
): TimerHandle | null {
  return enabled && correct ? schedule(onAdvance, AUTO_ADVANCE_DELAY_MS) : null;
}

export function startAnswerFeedback(options: {
  direction: Direction;
  correct: boolean;
  answeredMidis: readonly number[];
  expectedMidis: readonly number[];
  autoAdvance: boolean;
  playSequence: (midis: readonly number[], gapMs: number) => CancellablePlayback;
  onAdvance: () => void;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancelScheduled?: (timer: TimerHandle) => void;
}): AnswerFeedback {
  const schedule = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const cancelScheduled = options.cancelScheduled ?? ((timer) => globalThis.clearTimeout(timer));
  const timers = new Set<TimerHandle>();
  let playback: CancellablePlayback | null = null;
  let cancelled = false;

  const playCue = (cue: AcousticFeedbackCue) => {
    if (cancelled) return;
    playback?.cancel();
    const midis = cue.sequence === "answered" ? options.answeredMidis : options.expectedMidis;
    playback = options.playSequence(midis, cue.gapMs);
  };

  for (const cue of acousticFeedbackCues(options.direction, options.correct, options.answeredMidis.length)) {
    if (cue.delayMs === 0) {
      playCue(cue);
      continue;
    }
    const timer = schedule(() => {
      timers.delete(timer);
      playCue(cue);
    }, cue.delayMs);
    timers.add(timer);
  }

  const autoTimer = scheduleCorrectAutoAdvance(options.autoAdvance, options.correct, () => {
    if (autoTimer !== null) timers.delete(autoTimer);
    if (!cancelled) options.onAdvance();
  }, schedule);
  if (autoTimer !== null) timers.add(autoTimer);

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const timer of timers) cancelScheduled(timer);
      timers.clear();
      playback?.cancel();
      playback = null;
    }
  };
}
