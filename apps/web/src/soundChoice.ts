import type { Note } from "@music-trainer/core";

export type SoundChoiceKeyboardAction =
  | { kind: "audition"; midi: number }
  | { kind: "confirm"; midi: number }
  | null;

/** Maps keyboard input without allowing a sound answer that was never auditioned. */
export function soundChoiceKeyboardAction(
  key: string,
  options: readonly Note[],
  activeMidi: number | null
): SoundChoiceKeyboardAction {
  if (/^[1-6]$/.test(key)) {
    const option = options[Number(key) - 1];
    return option ? { kind: "audition", midi: option.midi } : null;
  }
  if (key === "Enter" && activeMidi !== null) {
    return { kind: "confirm", midi: activeMidi };
  }
  return null;
}
