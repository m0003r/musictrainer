import { CLEFS, NAME_SYSTEMS, REPRESENTATIONS, keySignatureAlter, midiForNote,
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

function isIntegerIn(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isEnumValue<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function isUniqueEnumArray<const T extends readonly string[]>(values: T, value: unknown): value is T[number][] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => isEnumValue(values, item))
    && new Set(value).size === value.length;
}

function isDifficultySettings(value: unknown): value is DifficultySettings {
  return isRecord(value)
    && isIntegerIn(value.ledgerLines, 0, 3)
    && isIntegerIn(value.optionCount, 2, 6)
    && isIntegerIn(value.minDiatonicDistance, 1, 4)
    && isIntegerIn(value.maxKeySignatureFifths, 0, 7)
    && typeof value.allowWrittenAccidentals === "boolean"
    && isIntegerIn(value.notesPerQuestion, 1, 5)
    && isIntegerIn(value.maxMelodicDistance, 1, 8);
}

function isTrainerSettings(value: unknown): value is LocalTrainerSettings {
  if (!isRecord(value)
    || !isIntegerIn(value.level, 1, 6)
    || typeof value.customDifficulty !== "boolean"
    || !isDifficultySettings(value.difficulty)
    || !isUniqueEnumArray(REPRESENTATIONS, value.sources)
    || !isUniqueEnumArray(REPRESENTATIONS, value.targets)
    || !isUniqueEnumArray(CLEFS, value.selectedClefs)
    || !isRecord(value.hints)
    || typeof value.hints.keyboardNoteLabels !== "boolean"
    || typeof value.hints.keyboardOctaveLabels !== "boolean"
    || typeof value.hints.clefGuide !== "boolean"
    || typeof value.autoAdvance !== "boolean"
    || (value.playbackMode !== "webaudio" && value.playbackMode !== "midi")) return false;
  const sources = value.sources as Representation[];
  const targets = value.targets as Representation[];
  return sources.some((source) => targets.some((target) => source !== target));
}

function hasValidExpectedSequence(value: unknown, keyFifths: KeyFifths): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return false;
  const activeAlterByStaffPosition = new Map<string, number>();
  return value.every((candidate) => {
    if (!isRecord(candidate)
      || !isEnumValue(["C", "D", "E", "F", "G", "A", "B"] as const, candidate.step)
      || !Number.isInteger(candidate.octave)
      || !isIntegerIn(candidate.alter, -1, 1)
      || !isIntegerIn(candidate.midi, 0, 127)
      || !(candidate.writtenAccidental === null || isIntegerIn(candidate.writtenAccidental, -1, 1))) return false;
    const position = `${candidate.step}${candidate.octave}`;
    const inherited = keySignatureAlter(candidate.step, keyFifths);
    const active = activeAlterByStaffPosition.get(position) ?? inherited;
    const written = candidate.writtenAccidental as WrittenAccidental | null;
    const accidentalIsValid = written === null
      ? candidate.alter === active
      : candidate.alter === written && written !== active;
    if (written !== null) activeAlterByStaffPosition.set(position, written);
    return accidentalIsValid && midiForNote({
      step: candidate.step,
      octave: candidate.octave as number,
      alter: candidate.alter as number
    }) === candidate.midi;
  });
}

function hasValidAttemptPayload(value: Record<string, unknown>): boolean {
  if (typeof value.questionId !== "string"
    || !isEnumValue(REPRESENTATIONS, value.source)
    || !isEnumValue(REPRESENTATIONS, value.target)
    || value.source === value.target
    || !isEnumValue(CLEFS, value.clef)
    || !isEnumValue(NAME_SYSTEMS, value.nameSystem)
    || !isIntegerIn(value.keyFifths, -7, 7)
    || !hasValidExpectedSequence(value.expectedSequence, value.keyFifths as KeyFifths)
    || !Array.isArray(value.answeredSequence)
    || value.answeredSequence.length !== (value.expectedSequence as unknown[]).length
    || !value.answeredSequence.every((midi) => isIntegerIn(midi, 0, 127))
    || typeof value.correct !== "boolean"
    || typeof value.responseTimeMs !== "number"
    || !Number.isFinite(value.responseTimeMs)
    || value.responseTimeMs < 0
    || (value.inputMethod !== "pointer" && value.inputMethod !== "keyboard" && value.inputMethod !== "midi")
    || typeof value.occurredAt !== "string"
    || Number.isNaN(Date.parse(value.occurredAt))) return false;
  const expectedMidis = (value.expectedSequence as Array<{ midi: number }>).map((note) => note.midi);
  const answeredSequence = value.answeredSequence as number[];
  const computedCorrect = expectedMidis.every((midi, index) => midi === answeredSequence[index]);
  return value.correct === computedCorrect;
}

function isStoredProfile(value: unknown): value is StoredProfile {
  return isRecord(value)
    && isIntegerIn(value.id, 1, Number.MAX_SAFE_INTEGER)
    && typeof value.name === "string"
    && value.name.length >= 1
    && value.name.length <= 40
    && typeof value.nameKey === "string"
    && typeof value.createdAt === "string"
    && !Number.isNaN(Date.parse(value.createdAt))
    && (value.settings === null || isTrainerSettings(value.settings));
}

function isStoredAttempt(value: unknown): value is StoredAttempt {
  return isRecord(value)
    && isIntegerIn(value.profileId, 1, Number.MAX_SAFE_INTEGER)
    && hasValidAttemptPayload(value);
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
  const profiles = value.profiles as StoredProfile[];
  const attempts = value.attempts as StoredAttempt[];
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const profileNameKeys = new Set(profiles.map((profile) => profile.nameKey));
  if (profileIds.size !== profiles.length
    || profileNameKeys.size !== profiles.length
    || profiles.some((profile) => profile.nameKey !== profileNameKey(profile.name))
    || (value.activeProfileId !== null && !profileIds.has(value.activeProfileId as number))
    || attempts.some((attempt) => !profileIds.has(attempt.profileId))
    || (value.nextProfileId as number) <= Math.max(0, ...profileIds)) {
    throw new LocalStoreError("corrupt_data", "Stored local profile data has inconsistent references");
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
  if (!hasValidAttemptPayload(attempt as unknown as Record<string, unknown>)) {
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
