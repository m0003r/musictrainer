import type { Clef, Note, Step } from "./types.js";

const NATURAL_STEPS: ReadonlyArray<{ pitchClass: number; step: Step }> = [
  { pitchClass: 0, step: "C" },
  { pitchClass: 2, step: "D" },
  { pitchClass: 4, step: "E" },
  { pitchClass: 5, step: "F" },
  { pitchClass: 7, step: "G" },
  { pitchClass: 9, step: "A" },
  { pitchClass: 11, step: "B" }
];

const naturalByPitchClass = new Map(NATURAL_STEPS.map((item) => [item.pitchClass, item.step]));
const naturalIndexByStep = new Map(NATURAL_STEPS.map((item, index) => [item.step, index]));

export function diatonicIndex(note: Pick<Note, "step" | "octave">): number {
  const stepIndex = naturalIndexByStep.get(note.step);
  if (stepIndex === undefined) throw new Error(`Unsupported step: ${note.step}`);
  return note.octave * 7 + stepIndex;
}

export function noteFromDiatonicIndex(index: number): Note {
  const octave = Math.floor(index / 7);
  const stepIndex = ((index % 7) + 7) % 7;
  const step = NATURAL_STEPS[stepIndex]!.step;
  return { midi: midiForNote({ step, octave, alter: 0 }), step, octave, alter: 0 };
}

export function noteFromMidi(midi: number): Note {
  const normalized = Math.round(midi);
  const pitchClass = ((normalized % 12) + 12) % 12;
  const step = naturalByPitchClass.get(pitchClass);
  if (!step) {
    throw new Error(`MIDI note ${midi} is not a natural note`);
  }

  return {
    midi: normalized,
    step,
    octave: Math.floor(normalized / 12) - 1,
    alter: 0
  };
}

export function createNaturalRange(minMidi = 48, maxMidi = 83): Note[] {
  const notes: Note[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (naturalByPitchClass.has(midi % 12)) {
      notes.push(noteFromMidi(midi));
    }
  }
  return notes;
}

export const DEFAULT_NOTES = createNaturalRange();

const CLEF_NATURAL_RANGES: Record<Clef, readonly [minMidi: number, maxMidi: number]> = {
  treble: [53, 88],
  bass: [33, 67],
  soprano: [50, 84],
  mezzoSoprano: [47, 81],
  alto: [43, 77],
  tenor: [40, 74],
  baritone: [36, 71]
};

/** Natural notes from the third ledger line below through the third above. */
export function notesForClef(clef: Clef): Note[] {
  const [minMidi, maxMidi] = CLEF_NATURAL_RANGES[clef];
  return createNaturalRange(minMidi, maxMidi);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiForNote(note: Pick<Note, "step" | "octave" | "alter">): number {
  const natural = NATURAL_STEPS.find(({ step }) => step === note.step);
  if (!natural) throw new Error(`Unsupported step: ${note.step}`);
  return (note.octave + 1) * 12 + natural.pitchClass + note.alter;
}

export function scientificName(note: Note): string {
  const accidental = note.alter > 0 ? "♯".repeat(note.alter) : "♭".repeat(Math.abs(note.alter));
  return `${note.step}${accidental}${note.octave}`;
}
