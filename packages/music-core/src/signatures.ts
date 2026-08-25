import { midiForNote } from "./notes.js";
import type { KeyFifths, Note, Step, WrittenAccidental } from "./types.js";

const SHARP_ORDER: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly Step[] = ["B", "E", "A", "D", "G", "C", "F"];

export function keySignatureAlter(step: Step, fifths: KeyFifths): -1 | 0 | 1 {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, Math.abs(fifths)).includes(step)) return -1;
  return 0;
}

export function noteInKeySignature(note: Pick<Note, "step" | "octave">, fifths: KeyFifths): Note {
  const alter = keySignatureAlter(note.step, fifths);
  return { ...note, alter, midi: midiForNote({ ...note, alter }) };
}

export function noteWithWrittenAccidental(
  note: Pick<Note, "step" | "octave">,
  accidental: WrittenAccidental
): Note {
  return { ...note, alter: accidental, midi: midiForNote({ ...note, alter: accidental }) };
}

export function accidentalForNote(note: Note, fifths: KeyFifths): WrittenAccidental | null {
  return note.alter === keySignatureAlter(note.step, fifths)
    ? null
    : note.alter as WrittenAccidental;
}

export function chooseWrittenAccidental(
  note: Pick<Note, "step">,
  fifths: KeyFifths,
  rng: () => number
): WrittenAccidental {
  const inherited = keySignatureAlter(note.step, fifths);
  const choices = ([-1, 0, 1] as const).filter((value) => value !== inherited);
  return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))]!;
}

export function randomKeyFifths(maximumSigns: number, rng: () => number): KeyFifths {
  const maximum = Math.max(0, Math.min(7, Math.round(maximumSigns)));
  return (Math.floor(rng() * (maximum * 2 + 1)) - maximum) as KeyFifths;
}

export function formatKeySignature(fifths: KeyFifths): string {
  if (fifths === 0) return "Без знаков при ключе";
  const count = Math.abs(fifths);
  const word = count === 1 ? "знак" : count < 5 ? "знака" : "знаков";
  return `${count} ${word}: ${fifths > 0 ? "диезы" : "бемоли"}`;
}
