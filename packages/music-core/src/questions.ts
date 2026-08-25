import { DEFAULT_NOTES, diatonicIndex } from "./notes.js";
import { chooseWrittenAccidental, noteInKeySignature, noteWithWrittenAccidental } from "./signatures.js";
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
  const firstInheritedNote = targetPool[randomIndex(targetPool.length, rng)];
  if (!firstInheritedNote) {
    throw new Error("Cannot choose a target note");
  }

  const inheritedSequence = [firstInheritedNote];
  while (inheritedSequence.length < notesPerQuestion) {
    const previous = inheritedSequence[inheritedSequence.length - 1]!;
    const melodicCandidates = pool.filter((candidate) => (
      candidate.midi !== previous.midi
      && Math.abs(diatonicIndex(candidate) - diatonicIndex(previous)) <= maxMelodicDistance
    ));
    if (melodicCandidates.length === 0) {
      throw new Error("The selected range cannot provide a sequence at this distance");
    }
    inheritedSequence.push(melodicCandidates[randomIndex(melodicCandidates.length, rng)]!);
  }

  const accidentalIndex = options.allowWrittenAccidentals
    ? randomIndex(inheritedSequence.length, rng)
    : -1;
  const writtenAccidentals = inheritedSequence.map((inherited, index) => (
    index === accidentalIndex ? chooseWrittenAccidental(inherited, keyFifths, rng) : null
  ));
  const sequence = inheritedSequence.map((inherited, index) => {
    const written = writtenAccidentals[index];
    return written === null || written === undefined
      ? inherited
      : noteWithWrittenAccidental(inherited, written);
  });

  const sequenceKey = (notes: readonly Note[]) => notes.map((item) => item.midi).join(",");
  const distractorSequences: Note[][] = [];
  const seen = new Set([sequenceKey(sequence)]);
  if (accidentalIndex >= 0) {
    const contextual = [...sequence];
    contextual[accidentalIndex] = inheritedSequence[accidentalIndex]!;
    seen.add(sequenceKey(contextual));
    distractorSequences.push(contextual);
  }
  const fitsMelodicContext = (candidate: Note, position: number): boolean => {
    const previous = inheritedSequence[position - 1];
    const next = inheritedSequence[position + 1];
    return (previous === undefined
      || Math.abs(diatonicIndex(candidate) - diatonicIndex(previous)) <= maxMelodicDistance)
      && (next === undefined
        || Math.abs(diatonicIndex(candidate) - diatonicIndex(next)) <= maxMelodicDistance);
  };
  const mutationCandidates = sequence.flatMap((target, position) => (
    eligibleDistractors(inheritedSequence[position]!)
      .filter((candidate) => candidate.midi !== target.midi)
      .filter((candidate) => fitsMelodicContext(candidate, position))
      .map((candidate) => ({ position, candidate }))
  ));
  for (const mutation of shuffled(mutationCandidates, rng)) {
    if (distractorSequences.length >= optionCount - 1) break;
    const distractor = [...sequence];
    distractor[mutation.position] = mutation.candidate;
    const key = sequenceKey(distractor);
    if (seen.has(key)) continue;
    seen.add(key);
    distractorSequences.push(distractor);
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
