export type SoundChoiceKeyboardAction =
  | { kind: "audition"; optionIndex: number }
  | { kind: "confirm"; optionIndex: number }
  | null;

/** Maps keyboard input without allowing a sound answer that was never auditioned. */
export function soundChoiceKeyboardAction(
  key: string,
  options: readonly unknown[],
  activeOption: number | null
): SoundChoiceKeyboardAction {
  if (/^[1-6]$/.test(key)) {
    const optionIndex = Number(key) - 1;
    return options[optionIndex] === undefined ? null : { kind: "audition", optionIndex };
  }
  if (key === "Enter" && activeOption !== null && options[activeOption] !== undefined) {
    return { kind: "confirm", optionIndex: activeOption };
  }
  return null;
}
