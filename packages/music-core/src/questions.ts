import { DEFAULT_NOTES, diatonicIndex } from "./notes.js";
import {
  createMelodicSequence,
  enumerateMelodicSequences,
  hasDistinctAdjacentMidi,
  isValidMelodicSequence,
  melodicSequenceWeight
} from "./melody.js";
import { noteInKeySignature, noteWithWrittenAccidental } from "./signatures.js";
import type { Clef, Direction, KeyFifths, NameSystem, Note, Question } from "./types.js";

export interface CreateQuestionOptions {
  direction: Direction;
  clef: Clef;
  nameSystem: NameSystem;
  notes?: Note[];
  previousMidi?: number;
  optionCount?: number;
  minDiatonicDistance?: number;
  notesPerQuestion?: number;
  maxMelodicDistance?: number;
  keyFifths?: KeyFifths;
  allowWrittenAccidentals?: boolean;
  rng?: () => number;
}

function randomIndex(length: number, rng: () => number): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}

function shuffled<T>(values: T[], rng: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, rng);
    const current = result[index];
    const replacement = result[swapIndex];
    if (current !== undefined && replacement !== undefined) {
      result[index] = replacement;
      result[swapIndex] = current;
    }
  }
  return result;
}

function weightedSampleWithoutReplacement<T>(
  values: readonly T[],
  count: number,
  weight: (value: T) => number,
  rng: () => number
): T[] {
  const remaining = [...values];
  const selected: T[] = [];
  while (selected.length < count && remaining.length > 0) {
    const weights = remaining.map(weight);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const draw = Math.max(0, Math.min(1 - Number.EPSILON, rng())) * totalWeight;
    let cumulativeWeight = 0;
    let selectedIndex = remaining.length - 1;
    for (let index = 0; index < remaining.length; index += 1) {
      cumulativeWeight += weights[index]!;
      if (draw < cumulativeWeight) {
        selectedIndex = index;
        break;
      }
    }
    selected.push(remaining.splice(selectedIndex, 1)[0]!);
  }
  return selected;
}

export function createQuestion(options: CreateQuestionOptions): Question {
  const rng = options.rng ?? Math.random;
  const naturalPool = options.notes ?? DEFAULT_NOTES;
  const optionCount = options.optionCount ?? 4;
  const minDiatonicDistance = options.minDiatonicDistance ?? 1;
  const notesPerQuestion = options.notesPerQuestion ?? 1;
  const maxMelodicDistance = options.maxMelodicDistance ?? 8;
  const keyFifths = options.keyFifths ?? 0;
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 6) {
    throw new Error("Option count must be an integer from 2 to 6");
  }
  if (!Number.isInteger(minDiatonicDistance) || minDiatonicDistance < 1) {
    throw new Error("Minimum diatonic distance must be a positive integer");
  }
  if (!Number.isInteger(notesPerQuestion) || notesPerQuestion < 1 || notesPerQuestion > 5) {
    throw new Error("Notes per question must be an integer from 1 to 5");
  }
  if (!Number.isInteger(maxMelodicDistance) || maxMelodicDistance < 1 || maxMelodicDistance > 8) {
    throw new Error("Maximum melodic distance must be an integer from 1 to 8");
  }
  if (!Number.isInteger(keyFifths) || keyFifths < -7 || keyFifths > 7) {
    throw new Error("Key signature must contain from seven flats to seven sharps");
  }
  if (naturalPool.length < optionCount) {
    throw new Error(`At least ${optionCount} notes are required to create a question`);
  }

  const pool = naturalPool.map((note) => noteInKeySignature(note, keyFifths));

  const eligibleDistractors = (target: Note) => pool.filter((candidate) => (
    candidate.midi !== target.midi
    && Math.abs(diatonicIndex(candidate) - diatonicIndex(target)) >= minDiatonicDistance
  ));
  const viableTargets = pool.filter((target) => eligibleDistractors(target).length >= optionCount - 1);
  if (viableTargets.length === 0) {
    throw new Error("The selected range cannot provide enough options at this distance");
  }
  const candidates = viableTargets.filter((note) => note.midi !== options.previousMidi);
  const targetPool = candidates.length > 0 ? candidates : viableTargets;
  const inheritedSequence = notesPerQuestion === 1
    ? [targetPool[randomIndex(targetPool.length, rng)]!]
    : createMelodicSequence({
      notes: pool,
      noteCount: notesPerQuestion,
      maxMelodicDistance,
      ...(options.previousMidi === undefined ? {} : { previousMidi: options.previousMidi }),
      allowedFirstNotes: viableTargets,
      requireDistinctAdjacentMidi: true,
      rng
    });
  if (!inheritedSequence[0]) throw new Error("Cannot choose a target note");

  const validAccidentalsAt = (position: number): Array<-1 | 0 | 1> => (
    ([-1, 0, 1] as const).filter((accidental) => {
      if (accidental === inheritedSequence[position]!.alter) return false;
      const candidate = inheritedSequence.map((note, index) => (
        index === position ? noteWithWrittenAccidental(note, accidental) : note
      ));
      return hasDistinctAdjacentMidi(candidate);
    })
  );
  const accidentalPositions = options.allowWrittenAccidentals
    ? inheritedSequence.flatMap((_, index) => validAccidentalsAt(index).length > 0 ? [index] : [])
    : [];
  if (options.allowWrittenAccidentals && accidentalPositions.length === 0) {
    throw new Error("The selected range cannot provide enough distinct sounding options");
  }
  const accidentalIndex = accidentalPositions.length > 0
    ? accidentalPositions[randomIndex(accidentalPositions.length, rng)]!
    : -1;
  const validAccidentals = accidentalIndex >= 0 ? validAccidentalsAt(accidentalIndex) : [];
  const designatedAccidental = accidentalIndex >= 0
    ? validAccidentals[randomIndex(validAccidentals.length, rng)]!
    : null;
  const desiredAlters = inheritedSequence.map((inherited, index) => (
    index === accidentalIndex ? designatedAccidental! : inherited.alter
  ));
  const activeAlterByStaffPosition = new Map<string, number>();
  const writtenAccidentals = inheritedSequence.map((inherited, index) => {
    const position = `${inherited.step}${inherited.octave}`;
    const activeAlter = activeAlterByStaffPosition.get(position) ?? inherited.alter;
    const desiredAlter = desiredAlters[index]!;
    if (desiredAlter === activeAlter) return null;
    activeAlterByStaffPosition.set(position, desiredAlter);
    return desiredAlter as -1 | 0 | 1;
  });
  const sequence = inheritedSequence.map((inherited, index) => (
    noteWithWrittenAccidental(inherited, desiredAlters[index]! as -1 | 0 | 1)
  ));

  const sequenceKey = (notes: readonly Note[]) => notes.map((item) => item.midi).join(",");
  const distractorSequences: Note[][] = [];
  const seen = new Set([sequenceKey(sequence)]);
  if (accidentalIndex >= 0) {
    const contextual = [...sequence];
    contextual[accidentalIndex] = inheritedSequence[accidentalIndex]!;
    seen.add(sequenceKey(contextual));
    distractorSequences.push(contextual);
  }
  const uniqueUnseenSequences = (candidates: readonly Note[][]): Note[][] => {
    const candidateKeys = new Set(seen);
    return candidates.filter((candidate) => {
      const key = sequenceKey(candidate);
      if (candidateKeys.has(key)) return false;
      candidateKeys.add(key);
      return true;
    });
  };
  const mutationCandidates = sequence.flatMap((target, position) => (
    eligibleDistractors(inheritedSequence[position]!)
      .filter((candidate) => candidate.midi !== target.midi)
      .filter((candidate) => {
        const mutated = [...inheritedSequence];
        mutated[position] = candidate;
        return isValidMelodicSequence(mutated, maxMelodicDistance);
      })
      .map((candidate) => {
        const distractor = [...sequence];
        distractor[position] = candidate;
        return distractor;
      })
      .filter(hasDistinctAdjacentMidi)
  ));
  const mutationDistractors = weightedSampleWithoutReplacement(
    uniqueUnseenSequences(mutationCandidates),
    optionCount - 1 - distractorSequences.length,
    (candidate) => melodicSequenceWeight(candidate, maxMelodicDistance),
    rng
  );
  for (const distractor of mutationDistractors) {
    const key = sequenceKey(distractor);
    seen.add(key);
    distractorSequences.push(distractor);
  }
  if (notesPerQuestion > 1 && distractorSequences.length < optionCount - 1) {
    const contourDistractors = enumerateMelodicSequences({
      notes: pool,
      noteCount: notesPerQuestion,
      maxMelodicDistance,
      requireDistinctAdjacentMidi: true
    }).flatMap((candidate) => {
      const changedPositions = candidate.flatMap((note, index) => (
        note.midi === inheritedSequence[index]?.midi ? [] : [index]
      ));
      if (changedPositions.length === 0 || changedPositions.some((position) => (
        Math.abs(diatonicIndex(candidate[position]!) - diatonicIndex(inheritedSequence[position]!))
          < minDiatonicDistance
      ))) return [];
      const distractor = candidate.map((note, index) => (
        changedPositions.includes(index) ? note : sequence[index]!
      ));
      return hasDistinctAdjacentMidi(distractor) ? [distractor] : [];
    });
    const fallbackDistractors = weightedSampleWithoutReplacement(
      uniqueUnseenSequences(contourDistractors),
      optionCount - 1 - distractorSequences.length,
      (candidate) => melodicSequenceWeight(candidate, maxMelodicDistance),
      rng
    );
    for (const distractor of fallbackDistractors) {
      const key = sequenceKey(distractor);
      seen.add(key);
      distractorSequences.push(distractor);
    }
  }
  if (distractorSequences.length < optionCount - 1) {
    throw new Error("The selected range cannot provide enough distinct sounding options");
  }
  const optionSequences = shuffled([sequence, ...distractorSequences], rng);
  const note = sequence[0]!;

  return {
    id: `${Date.now().toString(36)}-${Math.floor(rng() * 1_000_000).toString(36)}`,
    note,
    options: optionSequences.map((candidate) => candidate[0]!),
    sequence,
    optionSequences,
    direction: options.direction,
    clef: options.clef,
    nameSystem: options.nameSystem,
    keyFifths,
    writtenAccidental: writtenAccidentals[0] ?? null,
    writtenAccidentals
  };
}

export function isCorrectAnswer(question: Question, answer: number | readonly number[]): boolean {
  const midis = typeof answer === "number" ? [answer] : answer;
  return midis.length === question.sequence.length
    && midis.every((midi, index) => midi === question.sequence[index]?.midi);
}
