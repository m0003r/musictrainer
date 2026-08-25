import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { difficultyPreset } from "@music-trainer/core";
import {
  LOCAL_STORE_KEY,
  LocalStoreError,
  createProfile,
  getActiveProfile,
  getProgress,
  leaveProfile,
  listProfiles,
  loadSettings,
  recordAttempt,
  resolveInitialDifficulty,
  saveSettings,
  selectProfile,
  type LocalAttempt,
  type LocalTrainerSettings
} from "./localStore.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();

function attempt(overrides: Partial<LocalAttempt> = {}): LocalAttempt {
  return {
    questionId: "question-1",
    source: "notation",
    target: "keyboard",
    clef: "treble",
    nameSystem: "all",
    keyFifths: 0,
    expectedSequence: [{ midi: 60, step: "C", octave: 4, alter: 0, writtenAccidental: null }],
    answeredSequence: [60],
    correct: true,
    responseTimeMs: 800,
    inputMethod: "pointer",
    occurredAt: "2026-08-25T12:00:00.000Z",
    ...overrides
  };
}

const settings: LocalTrainerSettings = {
  level: 2,
  customDifficulty: false,
  difficulty: {
    ledgerLines: 1,
    optionCount: 4,
    minDiatonicDistance: 1,
    notesPerQuestion: 1,
    maxMelodicDistance: 4,
    maxKeySignatureFifths: 0,
    allowWrittenAccidentals: false
  },
  sources: ["notation", "sound"],
  targets: ["keyboard"],
  selectedClefs: ["treble"],
  hints: { keyboardNoteLabels: false, keyboardOctaveLabels: true, clefGuide: false },
  autoAdvance: true,
  playbackMode: "webaudio"
};

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("initial difficulty", () => {
  it("uses the current first preset when no settings exist", () => {
    expect(resolveInitialDifficulty(null)).toEqual(difficultyPreset(1).settings);
  });

  it("recomputes a persisted preset instead of restoring its stale values", () => {
    expect(resolveInitialDifficulty(settings)).toEqual(difficultyPreset(settings.level).settings);
    expect(resolveInitialDifficulty(settings)).not.toEqual(settings.difficulty);
  });

  it("restores exact persisted values for custom difficulty", () => {
    const custom = { ...settings, customDifficulty: true };
    expect(resolveInitialDifficulty(custom)).toEqual(custom.difficulty);
  });
});

describe("local profiles", () => {
  it("creates normalized passwordless profiles and prevents duplicate names", () => {
    expect(createProfile("  Анна   Мария ")).toEqual({ id: 1, name: "Анна Мария" });
    expect(getActiveProfile()).toEqual({ id: 1, name: "Анна Мария" });
    expect(() => createProfile("анна мария")).toThrowError(expect.objectContaining({ code: "duplicate_profile" }));
    expect(storage.getItem(LOCAL_STORE_KEY)).not.toContain("password");
  });

  it("persists active-profile selection and leaving", () => {
    const first = createProfile("Первый");
    const second = createProfile("Второй");
    expect(getActiveProfile()).toEqual(second);
    expect(selectProfile(first.id)).toEqual(first);
    expect(getActiveProfile()).toEqual(first);
    leaveProfile();
    expect(getActiveProfile()).toBeNull();
  });

  it("keeps attempts and progress isolated by profile", () => {
    const first = createProfile("Первый");
    recordAttempt(attempt({ correct: false, answeredSequence: [61], responseTimeMs: 1200 }));
    recordAttempt(attempt({ questionId: "question-2", occurredAt: "2026-08-25T12:01:00.000Z" }));
    const second = createProfile("Второй");
    recordAttempt(attempt({ source: "sound", questionId: "question-3", occurredAt: "2026-08-25T13:00:00.000Z" }));

    expect(getProgress(first.id)).toEqual({
      profile: first,
      totalAttempts: 2,
      directions: {
        "notation->keyboard": {
          attempts: 2,
          correct: 1,
          accuracy: 0.5,
          averageResponseTimeMs: 1000,
          recentAttempts: 2,
          recentCorrect: 1,
          recentCorrectResponseTimeMs: 800,
          previousCorrectResponseTimeMs: null
        }
      }
    });
    expect(getProgress(second.id).totalAttempts).toBe(1);
    expect(listProfiles().map((profile) => [profile.name, profile.attempts])).toEqual([["Второй", 1], ["Первый", 2]]);
  });

  it("persists independent trainer settings and returns defensive copies", () => {
    const first = createProfile("Первый");
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded).toEqual(settings);
    loaded!.sources.push("name");
    expect(loadSettings()).toEqual(settings);

    createProfile("Второй");
    expect(loadSettings()).toBeNull();
    expect(loadSettings(first.id)).toEqual(settings);
  });

  it("stores and validates complete ordered sequences with per-note accidentals", () => {
    createProfile("Анна");
    const sequenceAttempt = attempt({
      keyFifths: -1,
      expectedSequence: [
        { midi: 70, step: "B", octave: 4, alter: -1, writtenAccidental: null },
        { midi: 62, step: "D", octave: 4, alter: 0, writtenAccidental: null },
        { midi: 71, step: "B", octave: 4, alter: 0, writtenAccidental: 0 }
      ],
      answeredSequence: [70, 62, 71]
    });
    recordAttempt(sequenceAttempt);
    expect(getProgress().totalAttempts).toBe(1);
    expect(() => recordAttempt({ ...sequenceAttempt, answeredSequence: [70, 62, 70], correct: true }))
      .toThrowError(expect.objectContaining({ code: "invalid_attempt" }));
  });

  it("rejects unknown storage versions without overwriting them", () => {
    const future = JSON.stringify({ version: 99, profiles: [] });
    storage.setItem(LOCAL_STORE_KEY, future);
    expect(() => listProfiles()).toThrowError(expect.objectContaining({ code: "unsupported_version" }));
    expect(storage.getItem(LOCAL_STORE_KEY)).toBe(future);
  });

  it("rejects corrupted nested settings instead of crashing the trainer later", () => {
    createProfile("Анна");
    saveSettings(settings);
    const state = JSON.parse(storage.getItem(LOCAL_STORE_KEY)!);
    state.profiles[0].settings.difficulty = {};
    storage.setItem(LOCAL_STORE_KEY, JSON.stringify(state));

    expect(() => listProfiles()).toThrowError(expect.objectContaining({ code: "corrupt_data" }));
  });

  it("rejects corrupted persisted note sequences", () => {
    createProfile("Анна");
    recordAttempt(attempt());
    const state = JSON.parse(storage.getItem(LOCAL_STORE_KEY)!);
    state.attempts[0].expectedSequence[0].midi = 127;
    storage.setItem(LOCAL_STORE_KEY, JSON.stringify(state));

    expect(() => getProgress()).toThrowError(expect.objectContaining({ code: "corrupt_data" }));
  });

  it("fails explicitly outside a browser", () => {
    Reflect.deleteProperty(globalThis, "window");
    expect(() => listProfiles()).toThrowError(LocalStoreError);
    expect(() => listProfiles()).toThrowError(expect.objectContaining({ code: "browser_only" }));
  });
});
