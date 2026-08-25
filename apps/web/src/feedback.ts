import type { Direction } from "@music-trainer/core";

export interface AcousticFeedbackCue {
  pitch: "answered" | "expected";
  delayMs: number;
}

/** A wrong answer is always contrasted as "your pitch, then the expected pitch". */
export function acousticFeedbackCues(direction: Direction, correct: boolean): AcousticFeedbackCue[] {
  if (!correct) {
    return [
      { pitch: "answered", delayMs: 0 },
      { pitch: "expected", delayMs: 650 }
    ];
  }
  const alreadyHeard = direction.source === "sound" || direction.target === "sound";
  return alreadyHeard ? [] : [{ pitch: "expected", delayMs: 0 }];
}
