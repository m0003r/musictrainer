export const REPRESENTATIONS = ["notation", "name", "keyboard", "sound"] as const;

export type Representation = (typeof REPRESENTATIONS)[number];

export const CLEFS = ["treble", "bass", "soprano", "mezzoSoprano", "alto", "tenor", "baritone"] as const;

export type Clef = (typeof CLEFS)[number];

export const NAME_SYSTEMS = ["ru", "de", "all"] as const;

export type NameSystem = (typeof NAME_SYSTEMS)[number];

export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

export type KeyFifths = -7 | -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The sign printed directly before a note; 0 means a natural sign. */
export type WrittenAccidental = -1 | 0 | 1;

export interface Note {
  midi: number;
  step: Step;
  octave: number;
  alter: number;
}

export interface Direction {
  source: Representation;
  target: Representation;
}

export interface Question {
  id: string;
  /** Compatibility alias for the first note; use sequence for rendering/answers. */
  note: Note;
  /** Compatibility aliases for the first note of each option. */
  options: Note[];
  sequence: Note[];
  optionSequences: Note[][];
  direction: Direction;
  clef: Clef;
  nameSystem: NameSystem;
  keyFifths: KeyFifths;
  writtenAccidental: WrittenAccidental | null;
  writtenAccidentals: Array<WrittenAccidental | null>;
}

export interface DirectionProgress {
  source: Representation;
  target: Representation;
  attempts: number;
  correct: number;
  averageResponseTimeMs: number;
}
