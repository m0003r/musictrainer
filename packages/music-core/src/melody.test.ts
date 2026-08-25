import { describe, expect, it } from "vitest";
import {
  CLEFS,
  DIFFICULTY_PRESETS,
  createMelodicSequence,
  createNaturalRange,
  createQuestion,
  diatonicIndex,
  difficultyPreset,
  hasDistinctAdjacentMidi,
  isValidMelodicSequence,
  keySignatureAlter,
  melodicDeltas,
  melodicSequenceWeight,
  notesForClefDifficulty
} from "./index.js";
import type { Note } from "./types.js";

function seededRng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

function expectHardInvariants(
  sequence: readonly Note[],
  maxMelodicDistance: number,
  context: string
): void {
  expect(isValidMelodicSequence(sequence, maxMelodicDistance), context).toBe(true);
  if (sequence.length === 1) return;

  const deltas = melodicDeltas(sequence);
  expect(deltas.every((delta) => delta !== 0), context).toBe(true);
  expect(deltas.every((delta) => Math.abs(delta) <= maxMelodicDistance), context).toBe(true);
  expect(deltas.filter((delta) => Math.abs(delta) >= 3).length, context).toBeLessThanOrEqual(1);

  const positions = [0];
  for (const delta of deltas) positions.push(positions[positions.length - 1]! + delta);
  expect(Math.max(...positions) - Math.min(...positions), context)
    .toBeLessThanOrEqual(Math.min(8, Math.max(4, maxMelodicDistance)));

  const directionChanges = deltas.slice(1).filter((delta, index) => (
    Math.sign(delta) !== Math.sign(deltas[index]!)
  )).length;
  expect(directionChanges, context).toBeLessThanOrEqual(2);

  const largeStepIndex = deltas.findIndex((delta) => Math.abs(delta) >= 3);
  if (sequence.length >= 3 && largeStepIndex >= 0) {
    expect(largeStepIndex, context).toBeLessThan(deltas.length - 1);
    expect(Math.sign(deltas[largeStepIndex + 1]!), context)
      .toBe(-Math.sign(deltas[largeStepIndex]!));
    expect(Math.abs(deltas[largeStepIndex + 1]!), context).toBeLessThanOrEqual(2);
  }

  if (sequence.length === 5) {
    expect(deltas.filter((delta) => Math.abs(delta) <= 2).length, context)
      .toBeGreaterThanOrEqual(3);
    expect(deltas.every((delta) => delta === deltas[0]), context).toBe(false);
    expect(
      positions[0] === positions[2]
      && positions[2] === positions[4]
      && positions[1] === positions[3],
      context
    ).toBe(false);
  }
}

describe("melodic contour grammar", () => {
  it("detects adjacent enharmonic unisons but permits a later repeated pitch", () => {
    expect(hasDistinctAdjacentMidi([
      { midi: 64 },
      { midi: 64 }
    ])).toBe(false); // E4 followed by F-flat4.
    expect(hasDistinctAdjacentMidi([
      { midi: 60 },
      { midi: 60 }
    ])).toBe(false); // B-sharp3 followed by C4.
    expect(hasDistinctAdjacentMidi([
      { midi: 60 },
      { midi: 62 },
      { midi: 60 }
    ])).toBe(true);
  });

  it("avoids written enharmonic collisions in both directions", () => {
    const cases = [
      {
        notes: createNaturalRange(64, 65),
        keyFifths: 0 as const,
        rngValues: [0, 0, 0.99, 0],
        expectedMidis: [64, 66]
      },
      {
        notes: createNaturalRange(59, 60),
        keyFifths: 0 as const,
        rngValues: [0, 0, 0, 0],
        expectedMidis: [58, 60]
      },
      {
        notes: createNaturalRange(65, 67),
        keyFifths: 1 as const,
        rngValues: [0, 0, 0.99, 0],
        expectedMidis: [66, 68]
      }
    ];

    for (const testCase of cases) {
      let rngIndex = 0;
      const question = createQuestion({
        direction: { source: "notation", target: "sound" },
        clef: "treble",
        nameSystem: "all",
        notes: testCase.notes,
        notesPerQuestion: 2,
        maxMelodicDistance: 1,
        optionCount: 2,
        keyFifths: testCase.keyFifths,
        allowWrittenAccidentals: true,
        rng: () => testCase.rngValues[rngIndex++] ?? 0
      });

      expect(question.sequence.map((note) => note.midi)).toEqual(testCase.expectedMidis);
      expect(hasDistinctAdjacentMidi(question.sequence)).toBe(true);
      expect(question.optionSequences.every(hasDistinctAdjacentMidi)).toBe(true);
    }
  });

  it("keeps targets and every distractor collision-free for one to five notes and all signatures", () => {
    const notes = notesForClefDifficulty("treble", 3);
    const keyFifthsValues = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7] as const;
    let contextCount = 0;

    for (const notesPerQuestion of [1, 2, 3, 4, 5] as const) {
      for (const keyFifths of keyFifthsValues) {
        for (let seed = 1; seed <= 5; seed += 1) {
          const question = createQuestion({
            direction: { source: "sound", target: "notation" },
            clef: "treble",
            nameSystem: "all",
            notes,
            notesPerQuestion,
            maxMelodicDistance: 4,
            keyFifths,
            allowWrittenAccidentals: true,
            rng: seededRng(notesPerQuestion * 100_000 + (keyFifths + 7) * 100 + seed)
          });

          expect(hasDistinctAdjacentMidi(
            question.sequence
          ), `target: length ${notesPerQuestion}, key ${keyFifths}, seed ${seed}`).toBe(true);
          for (const [optionIndex, option] of question.optionSequences.entries()) {
            expect(hasDistinctAdjacentMidi(
              option
            ), `option ${optionIndex}: length ${notesPerQuestion}, key ${keyFifths}, seed ${seed}`).toBe(true);
          }
          contextCount += 1;
        }
      }
    }

    expect(contextCount).toBe(5 * 15 * 5);
  });

  it("enforces every hard invariant across seeded lengths and distance ceilings", () => {
    const notes = notesForClefDifficulty("treble", 3);
    let questionCount = 0;

    for (const notesPerQuestion of [2, 3, 4, 5] as const) {
      for (const maxMelodicDistance of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
        for (let seed = 1; seed <= 25; seed += 1) {
          const question = createQuestion({
            direction: { source: "notation", target: "sound" },
            clef: "treble",
            nameSystem: "all",
            notes,
            notesPerQuestion,
            maxMelodicDistance,
            rng: seededRng(seed * 101 + notesPerQuestion * 11 + maxMelodicDistance)
          });

          for (const [optionIndex, option] of question.optionSequences.entries()) {
            expectHardInvariants(
              option,
              maxMelodicDistance,
              `length ${notesPerQuestion}, max ${maxMelodicDistance}, seed ${seed}, option ${optionIndex}`
            );
          }
          questionCount += 1;
        }
      }
    }

    expect(questionCount).toBe(800);
  });

  it("keeps two-note custom max-eight leaps noticeable but subordinate", () => {
    const notes = createNaturalRange(36, 96);
    const rng = seededRng(91_827);
    let largeSteps = 0;
    let sixthOrLargerSteps = 0;
    let largestStep = 0;

    for (let sample = 0; sample < 10_000; sample += 1) {
      const sequence = createMelodicSequence({
        notes,
        noteCount: 2,
        maxMelodicDistance: 8,
        rng
      });
      const distance = Math.abs(melodicDeltas(sequence)[0]!);
      if (distance > 2) largeSteps += 1;
      if (distance >= 5) sixthOrLargerSteps += 1;
      largestStep = Math.max(largestStep, distance);
    }

    expect(largeSteps / 10_000).toBeGreaterThanOrEqual(0.1);
    expect(largeSteps / 10_000).toBeLessThanOrEqual(0.25);
    expect(sixthOrLargerSteps / 10_000).toBeGreaterThanOrEqual(0.02);
    expect(sixthOrLargerSteps / 10_000).toBeLessThanOrEqual(0.08);
    expect(largestStep).toBeLessThanOrEqual(8);
  });

  it("keeps level six phrases compact in a large seeded sample", () => {
    const settings = difficultyPreset(6).settings;
    const notes = notesForClefDifficulty("treble", settings.ledgerLines);
    const rng = seededRng(6_006);
    let largeFragments = 0;
    let smallSteps = 0;
    let allSteps = 0;
    let hardInvariantViolations = 0;

    expect(settings.maxMelodicDistance).toBe(4);
    for (let sample = 0; sample < 1_500; sample += 1) {
      const sequence = createMelodicSequence({
        notes,
        noteCount: settings.notesPerQuestion,
        maxMelodicDistance: settings.maxMelodicDistance,
        rng
      });
      const deltas = melodicDeltas(sequence);
      if (deltas.some((delta) => Math.abs(delta) >= 3)) largeFragments += 1;
      smallSteps += deltas.filter((delta) => Math.abs(delta) <= 2).length;
      allSteps += deltas.length;
      if (!isValidMelodicSequence(sequence, settings.maxMelodicDistance)) {
        hardInvariantViolations += 1;
      }
    }

    expect(hardInvariantViolations).toBe(0);
    expect(largeFragments / 1_500).toBeGreaterThanOrEqual(0.2);
    expect(largeFragments / 1_500).toBeLessThanOrEqual(0.45);
    expect(smallSteps / allSteps).toBeGreaterThanOrEqual(0.88);
  });

  it("keeps the correct level-six contour weight exchangeable with six options", () => {
    const settings = difficultyPreset(6).settings;
    const notes = notesForClefDifficulty("treble", settings.ledgerLines);
    const rng = seededRng(3);
    let strictHighestCount = 0;
    let midRankSum = 0;

    for (let sample = 0; sample < 3_000; sample += 1) {
      const question = createQuestion({
        direction: { source: "sound", target: "notation" },
        clef: "treble",
        nameSystem: "all",
        notes,
        optionCount: 6,
        minDiatonicDistance: settings.minDiatonicDistance,
        notesPerQuestion: settings.notesPerQuestion,
        maxMelodicDistance: settings.maxMelodicDistance,
        keyFifths: 0,
        allowWrittenAccidentals: false,
        rng
      });
      const correctWeight = melodicSequenceWeight(
        question.sequence,
        settings.maxMelodicDistance
      );
      const optionWeights = question.optionSequences.map((sequence) => (
        melodicSequenceWeight(sequence, settings.maxMelodicDistance)
      ));
      const greaterCount = optionWeights.filter((weight) => weight > correctWeight).length;
      const equalOtherCount = optionWeights.filter((weight) => weight === correctWeight).length - 1;
      if (greaterCount === 0 && equalOtherCount === 0) strictHighestCount += 1;
      midRankSum += 1 + greaterCount + equalOtherCount / 2;
    }

    expect(strictHighestCount / 3_000).toBeGreaterThanOrEqual(0.1);
    expect(strictHighestCount / 3_000).toBeLessThanOrEqual(0.24);
    expect(midRankSum / 3_000).toBeGreaterThanOrEqual(2.9);
    expect(midRankSum / 3_000).toBeLessThanOrEqual(4.1);
  });

  it("keeps compensated leaps audible in five-note custom max-eight phrases", () => {
    const notes = createNaturalRange(36, 96);
    const rng = seededRng(44_019);
    let largeFragments = 0;
    let sixthOrLargerFragments = 0;
    let hardInvariantViolations = 0;

    for (let sample = 0; sample < 750; sample += 1) {
      const sequence = createMelodicSequence({
        notes,
        noteCount: 5,
        maxMelodicDistance: 8,
        rng
      });
      const deltas = melodicDeltas(sequence);
      if (deltas.some((delta) => Math.abs(delta) > 2)) largeFragments += 1;
      if (deltas.some((delta) => Math.abs(delta) >= 5)) sixthOrLargerFragments += 1;
      if (!isValidMelodicSequence(sequence, 8)) hardInvariantViolations += 1;
    }

    expect(hardInvariantViolations).toBe(0);
    expect(largeFragments / 750).toBeGreaterThanOrEqual(0.15);
    expect(largeFragments / 750).toBeLessThanOrEqual(0.4);
    expect(sixthOrLargerFragments / 750).toBeGreaterThanOrEqual(0.02);
    expect(sixthOrLargerFragments / 750).toBeLessThanOrEqual(0.1);
  });

  it("uses the same contour rules for ordinary distractors and preserves accidental contrast", () => {
    const rng = seededRng(44_019);
    const notes = notesForClefDifficulty("alto", 3);

    for (let sample = 0; sample < 100; sample += 1) {
      const question = createQuestion({
        direction: { source: "notation", target: "name" },
        clef: "alto",
        nameSystem: "all",
        notes,
        notesPerQuestion: 5,
        maxMelodicDistance: 4,
        optionCount: 6,
        keyFifths: -3,
        allowWrittenAccidentals: true,
        rng
      });
      const specialContrasts = question.optionSequences.filter((option) => {
        const changed = option.flatMap((note, index) => (
          note.midi === question.sequence[index]?.midi ? [] : [index]
        ));
        return changed.length === 1
          && diatonicIndex(option[changed[0]!]!) === diatonicIndex(question.sequence[changed[0]!]!);
      });

      expect(specialContrasts).toHaveLength(1);
      for (const option of question.optionSequences) {
        if (specialContrasts.includes(option)) continue;
        expectHardInvariants(option, 4, `sample ${sample}`);
      }
    }
  });

  it("builds every preset option count for all key signatures and seven clefs", () => {
    const keyFifthsValues = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7] as const;
    let contextCount = 0;

    for (const preset of DIFFICULTY_PRESETS) {
      const settings = preset.settings;
      for (const clef of CLEFS) {
        const notes = notesForClefDifficulty(clef, settings.ledgerLines);
        for (const keyFifths of keyFifthsValues) {
          const question = createQuestion({
            direction: { source: "keyboard", target: "sound" },
            clef,
            nameSystem: "all",
            notes,
            optionCount: settings.optionCount,
            minDiatonicDistance: settings.minDiatonicDistance,
            notesPerQuestion: settings.notesPerQuestion,
            maxMelodicDistance: settings.maxMelodicDistance,
            keyFifths,
            allowWrittenAccidentals: settings.allowWrittenAccidentals,
            rng: seededRng(preset.level * 10_000 + contextCount + 1)
          });

          expect(question.optionSequences, `level ${preset.level}, ${clef}, key ${keyFifths}`)
            .toHaveLength(settings.optionCount);
          expect(new Set(question.optionSequences.map((option) => (
            option.map((note) => note.midi).join(",")
          ))).size).toBe(settings.optionCount);
          contextCount += 1;
        }
      }
    }

    expect(contextCount).toBe(6 * 7 * 15);
  });

  it("fails finitely and clearly when the range cannot host a valid contour", () => {
    expect(() => createQuestion({
      direction: { source: "notation", target: "sound" },
      clef: "treble",
      nameSystem: "all",
      notes: createNaturalRange(60, 62),
      notesPerQuestion: 5,
      maxMelodicDistance: 1,
      optionCount: 2,
      rng: seededRng(1)
    })).toThrow("cannot provide a 5-note melodic contour at maximum distance 1");
  });

  it("keeps the accidental contrast on the inherited staff position", () => {
    const question = createQuestion({
      direction: { source: "notation", target: "name" },
      clef: "treble",
      nameSystem: "all",
      notes: notesForClefDifficulty("treble", 2),
      notesPerQuestion: 4,
      maxMelodicDistance: 3,
      keyFifths: 2,
      allowWrittenAccidentals: true,
      rng: seededRng(772)
    });
    const accidentalPosition = question.writtenAccidentals.findIndex((value) => value !== null);
    const inheritedAlter = keySignatureAlter(question.sequence[accidentalPosition]!.step, 2);

    expect(question.optionSequences).toContainEqual(question.sequence.map((note, index) => (
      index === accidentalPosition
        ? {
          ...note,
          alter: inheritedAlter,
          midi: note.midi - note.alter + inheritedAlter
        }
        : note
    )));
  });
});
