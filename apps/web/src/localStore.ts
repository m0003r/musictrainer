import { keySignatureAlter, midiForNote,
  type Clef,
  type DifficultyLevel,
  type DifficultySettings,
  type KeyFifths,
  type NameSystem,
  type Representation,
  type Step,
  type WrittenAccidental
} from "@music-trainer/core";

export const LOCAL_STORE_VERSION = 1 as const;
export const LOCAL_STORE_KEY = "music-trainer:local-store";

export interface LocalProfile {
  id: number;
  name: string;
}

export interface LocalProfileSummary extends LocalProfile {
  attempts: number;
  lastAttemptAt: string | null;
}

export interface LocalAttempt {
  questionId: string;
  source: Representation;
  target: Representation;
  clef: Clef;
  nameSystem: NameSystem;
  keyFifths: KeyFifths;
  expectedSequence: Array<{
    midi: number;
    step: Step;
    octave: number;
    alter: number;
    writtenAccidental: WrittenAccidental | null;
  }>;
  answeredSequence: number[];
  correct: boolean;
  responseTimeMs: number;
  inputMethod: "pointer" | "keyboard" | "midi";
  occurredAt: string;
}

export interface LocalTrainerSettings {
  level: DifficultyLevel;
  customDifficulty: boolean;
  difficulty: DifficultySettings;
  sources: Representation[];
  targets: Representation[];
  selectedClefs: Clef[];
  hints: {
    keyboardNoteLabels: boolean;
    keyboardOctaveLabels: boolean;
    clefGuide: boolean;
  };
  autoAdvance: boolean;
  playbackMode: "webaudio" | "midi";
}

export interface LocalDirectionProgress {
  attempts: number;
  correct: number;
  accuracy: number;
  averageResponseTimeMs: number;
  recentAttempts: number;
  recentCorrect: number;
  recentCorrectResponseTimeMs: number | null;
  previousCorrectResponseTimeMs: number | null;
}

export interface LocalProgress {
  profile: LocalProfile;
  totalAttempts: number;
  directions: Record<string, LocalDirectionProgress>;
}

export type LocalStoreErrorCode =
  | "browser_only"
  | "corrupt_data"
  | "unsupported_version"
  | "invalid_name"
  | "duplicate_profile"
  | "profile_not_found"
  | "no_active_profile"
  | "invalid_attempt";

export class LocalStoreError extends Error {
  constructor(readonly code: LocalStoreErrorCode, message: string) {
    super(message);
    this.name = "LocalStoreError";
  }
}

interface StoredProfile extends LocalProfile {
  nameKey: string;
  createdAt: string;
  settings: LocalTrainerSettings | null;
}

interface StoredAttempt extends LocalAttempt {
  profileId: number;
}

interface StoreStateV1 {
  version: typeof LOCAL_STORE_VERSION;
  nextProfileId: number;
  activeProfileId: number | null;
  profiles: StoredProfile[];
  attempts: StoredAttempt[];
}

function emptyState(): StoreStateV1 {
  return { version: LOCAL_STORE_VERSION, nextProfileId: 1, activeProfileId: null, profiles: [], attempts: [] };
}

function browserStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new LocalStoreError("browser_only", "Local profiles require browser localStorage");
  }
  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStoredProfile(value: unknown): value is StoredProfile {
  return isRecord(value)
    && Number.isInteger(value.id)
    && typeof value.name === "string"
    && typeof value.nameKey === "string"
    && typeof value.createdAt === "string"
    && (value.settings === null || isRecord(value.settings));
}

function isStoredAttempt(value: unknown): value is StoredAttempt {
  return isRecord(value)
    && Number.isInteger(value.profileId)
    && typeof value.questionId === "string"
    && typeof value.source === "string"
    && typeof value.target === "string"
    && Array.isArray(value.expectedSequence)
    && Array.isArray(value.answeredSequence)
    && typeof value.correct === "boolean"
    && typeof value.responseTimeMs === "number"
    && typeof value.occurredAt === "string";
}

function readState(): StoreStateV1 {
  const serialized = browserStorage().getItem(LOCAL_STORE_KEY);
  if (serialized === null) return emptyState();
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new LocalStoreError("corrupt_data", "Stored local profile data is not valid JSON");
  }
  if (!isRecord(value) || value.version !== LOCAL_STORE_VERSION) {
    throw new LocalStoreError("unsupported_version", "Stored local profile data uses an unsupported version");
  }
  if (
    !Number.isInteger(value.nextProfileId)
    || !(value.activeProfileId === null || Number.isInteger(value.activeProfileId))
    || !Array.isArray(value.profiles)
    || !value.profiles.every(isStoredProfile)
    || !Array.isArray(value.attempts)
    || !value.attempts.every(isStoredAttempt)
  ) {
    throw new LocalStoreError("corrupt_data", "Stored local profile data has an invalid shape");
  }
  return value as unknown as StoreStateV1;
}

function writeState(state: StoreStateV1): void {
  browserStorage().setItem(LOCAL_STORE_KEY, JSON.stringify(state));
}

function normalizeProfileName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function profileNameKey(name: string): string {
  return name.toLocaleLowerCase("ru-RU");
}

function publicProfile(profile: StoredProfile): LocalProfile {
  return { id: profile.id, name: profile.name };
}

function resolveProfile(state: StoreStateV1, profileId?: number): StoredProfile {
  const id = profileId ?? state.activeProfileId;
  if (id === null) throw new LocalStoreError("no_active_profile", "No local profile is active");
  const profile = state.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new LocalStoreError("profile_not_found", `Local profile ${id} was not found`);
  return profile;
}

export function listProfiles(): LocalProfileSummary[] {
  const state = readState();
  return state.profiles.map((profile) => {
    const attempts = state.attempts.filter((attempt) => attempt.profileId === profile.id);
    const lastAttemptAt = attempts.reduce<string | null>(
      (latest, attempt) => latest === null || attempt.occurredAt > latest ? attempt.occurredAt : latest,
      null
    );
    return { ...publicProfile(profile), attempts: attempts.length, lastAttemptAt };
  }).sort((left, right) => {
    if (left.lastAttemptAt === null && right.lastAttemptAt !== null) return 1;
    if (left.lastAttemptAt !== null && right.lastAttemptAt === null) return -1;
    if (left.lastAttemptAt !== right.lastAttemptAt) return (right.lastAttemptAt ?? "").localeCompare(left.lastAttemptAt ?? "");
    return left.id - right.id;
  });
}

export function createProfile(name: string): LocalProfile {
  const state = readState();
  const normalized = normalizeProfileName(name);
  if (normalized.length === 0 || normalized.length > 40) {
    throw new LocalStoreError("invalid_name", "Profile name must contain between 1 and 40 characters");
  }
  const nameKey = profileNameKey(normalized);
  if (state.profiles.some((profile) => profile.nameKey === nameKey)) {
    throw new LocalStoreError("duplicate_profile", "A local profile with this name already exists");
  }
  const profile: StoredProfile = {
    id: state.nextProfileId,
    name: normalized,
    nameKey,
    createdAt: new Date().toISOString(),
    settings: null
  };
  state.nextProfileId += 1;
  state.activeProfileId = profile.id;
  state.profiles.push(profile);
  writeState(state);
  return publicProfile(profile);
}

export function selectProfile(profileId: number): LocalProfile {
  const state = readState();
  const profile = resolveProfile(state, profileId);
  state.activeProfileId = profile.id;
  writeState(state);
  return publicProfile(profile);
}

export function getActiveProfile(): LocalProfile | null {
  const state = readState();
  if (state.activeProfileId === null) return null;
  const profile = state.profiles.find((candidate) => candidate.id === state.activeProfileId);
  return profile ? publicProfile(profile) : null;
}

export function leaveProfile(): void {
  const state = readState();
  state.activeProfileId = null;
  writeState(state);
}

export function recordAttempt(attempt: LocalAttempt, profileId?: number): void {
  const state = readState();
  const profile = resolveProfile(state, profileId);
  const expectedMidis = attempt.expectedSequence.map((note) => note.midi);
  const validSequence = attempt.expectedSequence.length >= 1
    && attempt.expectedSequence.length <= 5
    && attempt.answeredSequence.length === attempt.expectedSequence.length
    && attempt.expectedSequence.every((note) => {
      const inherited = keySignatureAlter(note.step, attempt.keyFifths);
      const accidentalIsValid = note.writtenAccidental === null
        ? note.alter === inherited
        : note.alter === note.writtenAccidental && note.writtenAccidental !== inherited;
      return Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
        && midiForNote(note) === note.midi && accidentalIsValid;
    })
    && attempt.answeredSequence.every((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127);
  const computedCorrect = validSequence
    && expectedMidis.every((midi, index) => midi === attempt.answeredSequence[index]);
  if (
    attempt.source === attempt.target
    || !validSequence
    || attempt.correct !== computedCorrect
    || !Number.isFinite(attempt.responseTimeMs)
    || attempt.responseTimeMs < 0
    || Number.isNaN(Date.parse(attempt.occurredAt))
  ) {
    throw new LocalStoreError("invalid_attempt", "Attempt data is invalid");
  }
  state.attempts.push({ ...attempt, profileId: profile.id });
  writeState(state);
}

function roundedAverage(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function getProgress(profileId?: number): LocalProgress {
  const state = readState();
  const profile = resolveProfile(state, profileId);
  const attempts = state.attempts.filter((attempt) => attempt.profileId === profile.id);
  const grouped = new Map<string, StoredAttempt[]>();
  for (const attempt of attempts) {
    const key = `${attempt.source}->${attempt.target}`;
    grouped.set(key, [...(grouped.get(key) ?? []), attempt]);
  }
  const directions: Record<string, LocalDirectionProgress> = {};
  for (const [key, values] of grouped) {
    const ordered = values.map((attempt, index) => ({ attempt, index }))
      .sort((left, right) => left.attempt.occurredAt.localeCompare(right.attempt.occurredAt) || left.index - right.index)
      .map(({ attempt }) => attempt);
    const recent = ordered.slice(-10);
    const previous = ordered.slice(-20, -10);
    const correct = ordered.filter((attempt) => attempt.correct).length;
    directions[key] = {
      attempts: ordered.length,
      correct,
      accuracy: correct / ordered.length,
      averageResponseTimeMs: roundedAverage(ordered.map((attempt) => attempt.responseTimeMs))!,
      recentAttempts: recent.length,
      recentCorrect: recent.filter((attempt) => attempt.correct).length,
      recentCorrectResponseTimeMs: roundedAverage(recent.filter((attempt) => attempt.correct).map((attempt) => attempt.responseTimeMs)),
      previousCorrectResponseTimeMs: roundedAverage(previous.filter((attempt) => attempt.correct).map((attempt) => attempt.responseTimeMs))
    };
  }
  return { profile: publicProfile(profile), totalAttempts: attempts.length, directions };
}

export function loadSettings(profileId?: number): LocalTrainerSettings | null {
  const state = readState();
  const settings = resolveProfile(state, profileId).settings;
  return settings === null ? null : structuredClone(settings);
}

export function saveSettings(settings: LocalTrainerSettings, profileId?: number): void {
  const state = readState();
  const profile = resolveProfile(state, profileId);
  profile.settings = structuredClone(settings);
  writeState(state);
}
