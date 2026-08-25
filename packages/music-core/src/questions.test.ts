import { describe, expect, it } from "vitest";
import {
  CLEFS,
  DIRECTIONS,
  NAME_SYSTEMS,
  createNaturalRange,
  createQuestion,
  diatonicIndex,
  difficultyPreset,
  directionsForSelections,
  isCorrectAnswer,
  midiForNote,
  keySignatureAlter,
  notesForClef,
  notesForClefDifficulty
} from "./index.js";

describe("music domain", () => {
  it("contains every directed pair exactly once", () => {
    expect(DIRECTIONS).toHaveLength(12);
    expect(new Set(DIRECTIONS.map(({ source, target }) => `${source}->${target}`)).size).toBe(12);
  });

  it("builds directions from independent checked source and target sets", () => {
    expect(directionsForSelections(["notation", "sound"], ["keyboard", "sound"])).toEqual([
      { source: "notation", target: "keyboard" },
      { source: "notation", target: "sound" },
      { source: "sound", target: "keyboard" }
    ]);
  });

  it("creates a valid question for every directed pair", () => {
    for (const direction of DIRECTIONS) {
      const question = createQuestion({ direction, clef: "alto", nameSystem: "de", rng: () => 0.25 });
      expect(question.direction).toEqual(direction);
      expect(question.options).toHaveLength(4);
      expect(isCorrectAnswer(question, question.note.midi)).toBe(true);
    }
  });

  it("covers the complete first-slice matrix of directions, clefs and naming systems", () => {
    let checkedContexts = 0;
    for (const direction of DIRECTIONS) {
      for (const clef of CLEFS) {
        const notes = notesForClef(clef);
        const availableMidis = new Set(notes.map((note) => note.midi));
        for (const nameSystem of NAME_SYSTEMS) {
          const question = createQuestion({ direction, clef, nameSystem, notes, rng: () => 0.37 });
          expect(question.direction).toEqual(direction);
          expect(question.clef).toBe(clef);
          expect(question.nameSystem).toBe(nameSystem);
          expect(question.options).toHaveLength(4);
          expect(new Set(question.options.map((note) => note.midi)).size).toBe(4);
          expect(question.options.every((note) => availableMidis.has(note.midi))).toBe(true);
          expect(question.options.some((note) => note.midi === question.note.midi)).toBe(true);
          checkedContexts += 1;
        }
      }
    }
    expect(checkedContexts).toBe(12 * 7 * 3);
  });

  it("keeps neighboring notes out of level-one answer options", () => {
    const settings = difficultyPreset(1).settings;
    const notes = notesForClefDifficulty("treble", settings.ledgerLines);
    for (let seed = 0; seed < 10; seed += 1) {
      const question = createQuestion({
        direction: { source: "notation", target: "name" },
        clef: "treble",
        nameSystem: "all",
        notes,
        optionCount: settings.optionCount,
        minDiatonicDistance: settings.minDiatonicDistance,
        rng: () => seed / 10
      });
      for (const option of question.options) {
        if (option.midi === question.note.midi) continue;
        expect(Math.abs(diatonicIndex(option) - diatonicIndex(question.note))).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("supports flexible option counts and ledger-line ranges", () => {
    expect(notesForClefDifficulty("alto", 0)).toHaveLength(9);
    expect(notesForClefDifficulty("alto", 3)).toHaveLength(21);
    const question = createQuestion({
      direction: { source: "sound", target: "notation" },
      clef: "alto",
      nameSystem: "all",
      notes: notesForClefDifficulty("alto", 3),
      optionCount: 6,
      minDiatonicDistance: 1,
      rng: () => 0.5
    });
    expect(question.options).toHaveLength(6);
  });

  it("creates four unique answer options including the target", () => {
    const question = createQuestion({
      direction: { source: "notation", target: "name" },
      clef: "treble",
      nameSystem: "ru",
      rng: () => 0.4
    });

    expect(question.options).toHaveLength(4);
    expect(new Set(question.options.map((note) => note.midi)).size).toBe(4);
    expect(question.options.some((note) => note.midi === question.note.midi)).toBe(true);
    expect(isCorrectAnswer(question, question.note.midi)).toBe(true);
  });

  it("creates ordered sequences from one through five notes with bounded diatonic movement", () => {
    const notes = notesForClefDifficulty("treble", 3);

    for (const notesPerQuestion of [1, 2, 3, 4, 5] as const) {
      const question = createQuestion({
        direction: { source: "notation", target: "sound" },
        clef: "treble",
        nameSystem: "all",
        notes,
        notesPerQuestion,
        maxMelodicDistance: 2,
        rng: () => 0
      });

      expect(question.sequence).toHaveLength(notesPerQuestion);
      expect(question.optionSequences).toHaveLength(4);
      for (let index = 1; index < question.sequence.length; index += 1) {
        expect(Math.abs(
          diatonicIndex(question.sequence[index]!) - diatonicIndex(question.sequence[index - 1]!)
        )).toBeLessThanOrEqual(2);
      }
    }
  });

  it("compares the complete ordered sequence exactly", () => {
    const question = createQuestion({
      direction: { source: "sound", target: "keyboard" },
      clef: "alto",
      nameSystem: "de",
      notesPerQuestion: 3,
      maxMelodicDistance: 2,
      rng: () => 0
    });
    const answer = question.sequence.map((note) => note.midi);

    expect(isCorrectAnswer(question, answer)).toBe(true);
    expect(isCorrectAnswer(question, answer.slice(0, 2))).toBe(false);
    expect(isCorrectAnswer(question, [answer[1]!, answer[0]!, answer[2]!])).toBe(false);
    expect(isCorrectAnswer(question, answer[0]!)).toBe(false);
  });

  it("keeps a contextual same-step accidental distractor when the accidental is not first", () => {
    const randomValues = [0.5, 0.5, 0.5, 0.99, 0];
    let randomIndex = 0;
    const question = createQuestion({
      direction: { source: "notation", target: "name" },
      clef: "treble",
      nameSystem: "all",
      notes: notesForClefDifficulty("treble", 2),
      notesPerQuestion: 3,
      keyFifths: -2,
      allowWrittenAccidentals: true,
      rng: () => randomValues[randomIndex++] ?? 0
    });
    const accidentalPosition = question.writtenAccidentals.findIndex((accidental) => accidental !== null);

    expect(accidentalPosition).toBe(2);
    const writtenNote = question.sequence[accidentalPosition]!;
    const inheritedAlter = keySignatureAlter(writtenNote.step, question.keyFifths);
    expect(question.optionSequences).toContainEqual(question.sequence.map((note, index) => (
      index === accidentalPosition
        ? { ...note, alter: inheritedAlter, midi: midiForNote({ ...note, alter: inheritedAlter }) }
        : note
    )));
  });

  it("keeps option sequences unique and low-level mutations sufficiently distant", () => {
    const settings = difficultyPreset(1).settings;
    const question = createQuestion({
      direction: { source: "name", target: "notation" },
      clef: "bass",
      nameSystem: "ru",
      notes: notesForClefDifficulty("bass", settings.ledgerLines),
      notesPerQuestion: 3,
      optionCount: settings.optionCount,
      minDiatonicDistance: settings.minDiatonicDistance,
      maxMelodicDistance: settings.maxMelodicDistance,
      rng: () => 0
    });
    const keys = question.optionSequences.map((sequence) => sequence.map((note) => note.midi).join(","));

    expect(new Set(keys).size).toBe(question.optionSequences.length);
    for (const option of question.optionSequences) {
      const changedPositions = option.flatMap((note, index) => (
        note.midi === question.sequence[index]?.midi ? [] : [index]
      ));
      if (changedPositions.length === 0) continue;
      expect(changedPositions).toHaveLength(1);
      const position = changedPositions[0]!;
      expect(Math.abs(
        diatonicIndex(option[position]!) - diatonicIndex(question.sequence[position]!)
      )).toBeGreaterThanOrEqual(settings.minDiatonicDistance);
    }
  });

  it("rejects invalid sequence settings", () => {
    const base = {
      direction: { source: "notation", target: "name" } as const,
      clef: "treble" as const,
      nameSystem: "all" as const
    };

    expect(() => createQuestion({ ...base, notesPerQuestion: 0 })).toThrow(
      "Notes per question must be an integer from 1 to 5"
    );
    expect(() => createQuestion({ ...base, notesPerQuestion: 6 })).toThrow(
      "Notes per question must be an integer from 1 to 5"
    );
    expect(() => createQuestion({ ...base, maxMelodicDistance: 0 })).toThrow(
      "Maximum melodic distance must be an integer from 1 to 8"
    );
    expect(() => createQuestion({ ...base, maxMelodicDistance: 9 })).toThrow(
      "Maximum melodic distance must be an integer from 1 to 8"
    );
  });

  it("avoids the previous note when alternatives exist", () => {
    const notes = createNaturalRange(60, 65);
    const question = createQuestion({
      direction: { source: "sound", target: "keyboard" },
      clef: "bass",
      nameSystem: "de",
      notes,
      previousMidi: notes[0]!.midi,
      rng: () => 0
    });

    expect(question.note.midi).not.toBe(notes[0]?.midi);
  });

  it("derives MIDI pitch from a spelled note", () => {
    expect(midiForNote({ step: "C", octave: 4, alter: 0 })).toBe(60);
    expect(midiForNote({ step: "B", octave: 4, alter: -1 })).toBe(70);
    expect(midiForNote({ step: "F", octave: 5, alter: 1 })).toBe(78);
  });

  it("applies key signatures and generates a different explicit accidental", () => {
    expect(keySignatureAlter("F", 3)).toBe(1);
    expect(keySignatureAlter("B", -2)).toBe(-1);
    const question = createQuestion({
      direction: { source: "notation", target: "keyboard" },
      clef: "treble",
      nameSystem: "all",
      notes: notesForClefDifficulty("treble", 1),
      keyFifths: 1,
      allowWrittenAccidentals: true,
      optionCount: 4,
      rng: () => 0
    });
    expect(question.keyFifths).toBe(1);
    expect(question.writtenAccidental).not.toBeNull();
    expect(question.note.alter).toBe(question.writtenAccidental);
    expect(new Set(question.options.map((option) => option.midi)).size).toBe(4);
    expect(question.options).toContainEqual(expect.objectContaining({
      step: question.note.step,
      octave: question.note.octave,
      alter: keySignatureAlter(question.note.step, question.keyFifths)
    }));
  });

  it("uses the requested clef range through three ledger lines", async () => {
    const { notesForClef } = await import("./index.js");
    expect(notesForClef("treble").map((note) => note.midi)).toEqual(expect.arrayContaining([53, 88]));
    expect(notesForClef("bass").map((note) => note.midi)).toEqual(expect.arrayContaining([33, 67]));
    expect(notesForClef("soprano").map((note) => note.midi)).toEqual(expect.arrayContaining([50, 84]));
    expect(notesForClef("mezzoSoprano").map((note) => note.midi)).toEqual(expect.arrayContaining([47, 81]));
    expect(notesForClef("baritone").map((note) => note.midi)).toEqual(expect.arrayContaining([36, 71]));
  });
});
