import { createNaturalRange, diatonicIndex, noteFromDiatonicIndex } from "./notes.js";
import type { Clef, Note } from "./types.js";

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type LedgerLineCount = 0 | 1 | 2 | 3;
export type OptionCount = 2 | 3 | 4 | 5 | 6;
export type DiatonicDistance = 1 | 2 | 3 | 4;
export type KeySignatureCount = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type NotesPerQuestion = 1 | 2 | 3 | 4 | 5;
export type MelodicDistance = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface DifficultySettings {
  ledgerLines: LedgerLineCount;
  optionCount: OptionCount;
  minDiatonicDistance: DiatonicDistance;
  maxKeySignatureFifths: KeySignatureCount;
  allowWrittenAccidentals: boolean;
  notesPerQuestion: NotesPerQuestion;
  maxMelodicDistance: MelodicDistance;
}

export interface DifficultyPreset {
  level: DifficultyLevel;
  label: string;
  description: string;
  settings: DifficultySettings;
}

export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  { level: 1, label: "Опора", description: "1 нота · 2 далёких варианта · без знаков", settings: { ledgerLines: 0, optionCount: 2, minDiatonicDistance: 4, maxKeySignatureFifths: 0, allowWrittenAccidentals: false, notesPerQuestion: 1, maxMelodicDistance: 4 } },
  { level: 2, label: "Различение", description: "1 нота · 3 разнесённых варианта", settings: { ledgerLines: 0, optionCount: 3, minDiatonicDistance: 3, maxKeySignatureFifths: 0, allowWrittenAccidentals: false, notesPerQuestion: 1, maxMelodicDistance: 3 } },
  { level: 3, label: "Короткая связь", description: "2 ноты · ±1 добавочная · до 1 знака", settings: { ledgerLines: 1, optionCount: 4, minDiatonicDistance: 2, maxKeySignatureFifths: 1, allowWrittenAccidentals: false, notesPerQuestion: 2, maxMelodicDistance: 3 } },
  { level: 4, label: "Фраза", description: "3 ноты · ±2 добавочные · до 2 знаков", settings: { ledgerLines: 2, optionCount: 4, minDiatonicDistance: 2, maxKeySignatureFifths: 2, allowWrittenAccidentals: false, notesPerQuestion: 3, maxMelodicDistance: 4 } },
  { level: 5, label: "Полный диапазон", description: "4 ноты · ±3 добавочные · случайные знаки", settings: { ledgerLines: 3, optionCount: 4, minDiatonicDistance: 1, maxKeySignatureFifths: 4, allowWrittenAccidentals: true, notesPerQuestion: 4, maxMelodicDistance: 5 } },
  { level: 6, label: "Точное чтение", description: "5 нот · все ключевые и случайные знаки", settings: { ledgerLines: 3, optionCount: 6, minDiatonicDistance: 1, maxKeySignatureFifths: 7, allowWrittenAccidentals: true, notesPerQuestion: 5, maxMelodicDistance: 4 } }
] as const;

const STAFF_BOTTOM: Record<Clef, Note> = {
  treble: { midi: 64, step: "E", octave: 4, alter: 0 },
  bass: { midi: 43, step: "G", octave: 2, alter: 0 },
  soprano: { midi: 60, step: "C", octave: 4, alter: 0 },
  mezzoSoprano: { midi: 57, step: "A", octave: 3, alter: 0 },
  alto: { midi: 53, step: "F", octave: 3, alter: 0 },
  tenor: { midi: 50, step: "D", octave: 3, alter: 0 },
  baritone: { midi: 47, step: "B", octave: 2, alter: 0 }
};

/** Natural notes from the staff, optionally extended to the requested ledger line. */
export function notesForClefDifficulty(clef: Clef, ledgerLines: LedgerLineCount): Note[] {
  const bottomIndex = diatonicIndex(STAFF_BOTTOM[clef]);
  const firstIndex = bottomIndex - ledgerLines * 2;
  const lastIndex = bottomIndex + 8 + ledgerLines * 2;
  const first = noteFromDiatonicIndex(firstIndex);
  const last = noteFromDiatonicIndex(lastIndex);
  return createNaturalRange(first.midi, last.midi);
}

export function difficultyPreset(level: DifficultyLevel): DifficultyPreset {
  return DIFFICULTY_PRESETS.find((preset) => preset.level === level) ?? DIFFICULTY_PRESETS[0]!;
}
