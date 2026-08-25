import type { NameSystem, Note, Step } from "./types.js";

type SingleNameSystem = Exclude<NameSystem, "all">;

const names: Record<SingleNameSystem, Record<Step, string>> = {
  ru: { C: "До", D: "Ре", E: "Ми", F: "Фа", G: "Соль", A: "Ля", B: "Си" },
  de: { C: "C", D: "D", E: "E", F: "F", G: "G", A: "A", B: "H" }
};

function russianPitchName(note: Note): string {
  const base = names.ru[note.step];
  if (note.alter === 0) return base;
  if (note.alter === 1) return `${base}-диез`;
  if (note.alter === -1) return `${base}-бемоль`;
  if (note.alter === 2) return `${base}-дубль-диез`;
  if (note.alter === -2) return `${base}-дубль-бемоль`;
  throw new Error(`Unsupported alteration: ${note.alter}`);
}

function germanPitchName(note: Note, lowercase = false): string {
  const canonical = names.de[note.step];
  const natural = lowercase ? canonical.toLowerCase() : canonical;
  if (note.alter === 0) return natural;
  if (note.alter === 1) return `${natural}is`;
  if (note.alter === 2) return `${natural}isis`;
  if (note.alter === -1) {
    if (note.step === "B") return lowercase ? "b" : "B";
    if (note.step === "E") return lowercase ? "es" : "Es";
    if (note.step === "A") return lowercase ? "as" : "As";
    return `${natural}es`;
  }
  if (note.alter === -2) {
    if (note.step === "A") return lowercase ? "ases" : "Ases";
    if (note.step === "E") return lowercase ? "eses" : "Eses";
    return `${natural}eses`;
  }
  throw new Error(`Unsupported alteration: ${note.alter}`);
}

const russianOctaves: Record<number, string> = {
  0: "субконтроктавы",
  1: "контроктавы",
  2: "большой октавы",
  3: "малой октавы",
  4: "первой октавы",
  5: "второй октавы",
  6: "третьей октавы",
  7: "четвёртой октавы",
  8: "пятой октавы"
};

const germanOctaveMarks: Record<number, string> = {
  0: "₂",
  1: "₁",
  2: "",
  3: "",
  4: "¹",
  5: "²",
  6: "³",
  7: "⁴",
  8: "⁵"
};

export function formatNoteName(note: Note, system: NameSystem, includeOctave = true): string {
  if (system === "all") {
    return `${formatNoteName(note, "ru", includeOctave)} · ${formatNoteName(note, "de", includeOctave)}`;
  }
  if (system === "ru") {
    const base = russianPitchName(note);
    if (!includeOctave) return base;
    return `${base} ${russianOctaves[note.octave] ?? `${note.octave}-й октавы`}`;
  }

  const base = germanPitchName(note, includeOctave && note.octave >= 3);
  if (!includeOctave) return base;
  return `${base}${germanOctaveMarks[note.octave] ?? note.octave}`;
}

export const NAME_SYSTEM_LABELS: Record<NameSystem, string> = {
  ru: "Русские слоги",
  de: "Deutsche Buchstaben",
  all: "Русские + немецкие"
};
