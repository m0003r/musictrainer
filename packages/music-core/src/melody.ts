import { diatonicIndex } from "./notes.js";
import type { Note } from "./types.js";

interface WeightedContour {
  deltas: readonly number[];
  positions: readonly number[];
  weight: number;
}

export interface CreateMelodyOptions {
  notes: readonly Note[];
  noteCount: number;
  maxMelodicDistance: number;
  previousMidi?: number;
  allowedFirstNotes?: readonly Note[];
  rng: () => number;
}

export interface EnumerateMelodiesOptions {
  notes: readonly Note[];
  noteCount: number;
  maxMelodicDistance: number;
  allowedFirstNotes?: readonly Note[];
}

const contourCache = new Map<string, readonly WeightedContour[]>();
// Indexed by absolute diatonic distance. A leap remains less likely than either
// small step, while the decreasing tail keeps the custom maximum audible.
const DISTANCE_WEIGHTS = [0, 9, 5, 2.2, 1.5, 0.36, 0.25, 0.17, 0.12] as const;
const LARGE_STEP_RECOVERY_WEIGHT = 1.25;

export function melodicDeltas(notes: readonly Pick<Note, "step" | "octave">[]): number[] {
  const deltas: number[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    deltas.push(diatonicIndex(notes[index]!) - diatonicIndex(notes[index - 1]!));
  }
  return deltas;
}

export function isValidMelodicContour(
  deltas: readonly number[],
  maxMelodicDistance: number
): boolean {
  if (deltas.length < 1 || deltas.length > 4) return false;
  if (deltas.some((delta) => delta === 0 || Math.abs(delta) > maxMelodicDistance)) return false;

  const largeStepIndexes = deltas.flatMap((delta, index) => (
    Math.abs(delta) >= 3 ? [index] : []
  ));
  if (largeStepIndexes.length > 1) return false;

  if (deltas.length >= 2 && largeStepIndexes.length === 1) {
    const largeStepIndex = largeStepIndexes[0]!;
    if (largeStepIndex === deltas.length - 1) return false;
    const recovery = deltas[largeStepIndex + 1]!;
    if (Math.sign(recovery) === Math.sign(deltas[largeStepIndex]!) || Math.abs(recovery) > 2) {
      return false;
    }
  }

  const positions = [0];
  for (const delta of deltas) positions.push(positions[positions.length - 1]! + delta);
  const ambit = Math.max(...positions) - Math.min(...positions);
  if (ambit > Math.min(8, Math.max(4, maxMelodicDistance))) return false;

  let directionChanges = 0;
  for (let index = 1; index < deltas.length; index += 1) {
    if (Math.sign(deltas[index]!) !== Math.sign(deltas[index - 1]!)) directionChanges += 1;
  }
  if (directionChanges > 2) return false;

  if (deltas.length === 4) {
    if (deltas.filter((delta) => Math.abs(delta) <= 2).length < 3) return false;
    if (deltas.every((delta) => delta === deltas[0])) return false;
    if (positions[0] === positions[2]
      && positions[2] === positions[4]
      && positions[1] === positions[3]) return false;
  }

  return true;
}

export function isValidMelodicSequence(
  notes: readonly Pick<Note, "step" | "octave">[],
  maxMelodicDistance: number
): boolean {
  return notes.length === 1
    || isValidMelodicContour(melodicDeltas(notes), maxMelodicDistance);
}

function contourWeight(deltas: readonly number[]): number {
  let weight = 1;
  for (const delta of deltas) {
    weight *= DISTANCE_WEIGHTS[Math.abs(delta)]!;
  }

  for (let index = 1; index < deltas.length; index += 1) {
    const previous = deltas[index - 1]!;
    const current = deltas[index]!;
    if (Math.abs(previous) >= 3) weight *= LARGE_STEP_RECOVERY_WEIGHT;
    else if (Math.sign(previous) === Math.sign(current)) weight *= 1.15;
    else if (Math.abs(previous) <= 2 && Math.abs(current) <= 2) weight *= 0.9;
  }
  return weight;
}

export function melodicSequenceWeight(
  notes: readonly Pick<Note, "step" | "octave">[],
  maxMelodicDistance: number
): number {
  if (notes.length === 1) return 1;
  const deltas = melodicDeltas(notes);
  if (!isValidMelodicContour(deltas, maxMelodicDistance)) {
    throw new Error("Cannot weight a sequence that violates the melodic contour rules");
  }
  return contourWeight(deltas);
}

function contoursFor(noteCount: number, maxMelodicDistance: number): readonly WeightedContour[] {
  const cacheKey = `${noteCount}:${maxMelodicDistance}`;
  const cached = contourCache.get(cacheKey);
  if (cached) return cached;

  const contours: WeightedContour[] = [];
  const deltas: number[] = [];
  const distances: number[] = [];
  for (let distance = 1; distance <= maxMelodicDistance; distance += 1) {
    distances.push(distance, -distance);
  }

  const enumerate = (): void => {
    if (deltas.length === noteCount - 1) {
      if (!isValidMelodicContour(deltas, maxMelodicDistance)) return;
      const positions = [0];
      for (const delta of deltas) positions.push(positions[positions.length - 1]! + delta);
      contours.push({ deltas: [...deltas], positions, weight: contourWeight(deltas) });
      return;
    }
    for (const delta of distances) {
      deltas.push(delta);
      enumerate();
      deltas.pop();
    }
  };

  enumerate();
  contourCache.set(cacheKey, contours);
  return contours;
}

function assertMelodySettings(noteCount: number, maxMelodicDistance: number): void {
  if (!Number.isInteger(noteCount) || noteCount < 2 || noteCount > 5) {
    throw new Error("Melodic contour length must be an integer from 2 to 5 notes");
  }
  if (!Number.isInteger(maxMelodicDistance)
    || maxMelodicDistance < 1
    || maxMelodicDistance > 8) {
    throw new Error("Maximum melodic distance must be an integer from 1 to 8");
  }
}

function weightedIndex(values: readonly WeightedContour[], rng: () => number): number {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  const draw = Math.max(0, Math.min(1 - Number.EPSILON, rng())) * totalWeight;
  let cumulativeWeight = 0;
  for (let index = 0; index < values.length; index += 1) {
    cumulativeWeight += values[index]!.weight;
    if (draw < cumulativeWeight) return index;
  }
  return values.length - 1;
}

function randomIndex(length: number, rng: () => number): number {
  return Math.min(length - 1, Math.floor(Math.max(0, rng()) * length));
}

export function createMelodicSequence(options: CreateMelodyOptions): Note[] {
  const candidates = compatibleContours(options);
  const compatibleFirstNotes = options.notes.filter((note) => candidates.some(({ starts }) => (
    starts.some((start) => diatonicIndex(start) === diatonicIndex(note))
  )));
  const alternativeFirstNotes = options.previousMidi === undefined
    ? compatibleFirstNotes
    : compatibleFirstNotes.filter((note) => note.midi !== options.previousMidi);
  const eligibleFirstNotes = alternativeFirstNotes.length > 0
    ? alternativeFirstNotes
    : compatibleFirstNotes;

  if (eligibleFirstNotes.length === 0) {
    throw new Error(
      `The selected range cannot provide a ${options.noteCount}-note melodic contour `
      + `at maximum distance ${options.maxMelodicDistance}`
    );
  }

  // Choose the first note before the contour so central notes do not gain probability
  // merely because more contours can be transposed onto them.
  const first = eligibleFirstNotes[randomIndex(eligibleFirstNotes.length, options.rng)]!;
  const firstIndex = diatonicIndex(first);
  const eligibleContours = candidates.filter(({ starts }) => starts.some((start) => (
    diatonicIndex(start) === firstIndex
  ))).map(({ contour }) => contour);
  const selected = eligibleContours[weightedIndex(eligibleContours, options.rng)]!;
  const noteByIndex = new Map(options.notes.map((note) => [diatonicIndex(note), note]));
  return selected.positions.map((position) => noteByIndex.get(firstIndex + position)!);
}

function compatibleContours(options: EnumerateMelodiesOptions): Array<{
  contour: WeightedContour;
  starts: Note[];
}> {
  assertMelodySettings(options.noteCount, options.maxMelodicDistance);
  const noteByIndex = new Map(options.notes.map((note) => [diatonicIndex(note), note]));
  const allowedFirstIndexes = options.allowedFirstNotes
    ? new Set(options.allowedFirstNotes.map(diatonicIndex))
    : null;

  return contoursFor(options.noteCount, options.maxMelodicDistance).flatMap((contour) => {
    const starts = options.notes.filter((note) => {
      const startIndex = diatonicIndex(note);
      return (allowedFirstIndexes === null || allowedFirstIndexes.has(startIndex))
        && contour.positions.every((position) => noteByIndex.has(startIndex + position));
    });
    return starts.length > 0 ? [{ contour, starts }] : [];
  });
}

export function enumerateMelodicSequences(options: EnumerateMelodiesOptions): Note[][] {
  const noteByIndex = new Map(options.notes.map((note) => [diatonicIndex(note), note]));
  return compatibleContours(options).flatMap(({ contour, starts }) => starts.map((first) => {
    const firstIndex = diatonicIndex(first);
    return contour.positions.map((position) => noteByIndex.get(firstIndex + position)!);
  }));
}
