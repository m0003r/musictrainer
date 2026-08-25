import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Clef, KeyFifths, NameSystem, Representation, Step, WrittenAccidental } from "@music-trainer/core";

export interface StoredProfile {
  id: number;
  name: string;
}

export interface ProfileSummary extends StoredProfile {
  attempts: number;
  lastAttemptAt: string | null;
}

export interface AttemptInput {
  questionId: string;
  source: Representation;
  target: Representation;
  clef: Clef;
  nameSystem: NameSystem;
  expectedMidi: number;
  expectedStep: Step;
  expectedOctave: number;
  expectedAlter: number;
  keyFifths: KeyFifths;
  writtenAccidental: WrittenAccidental | null;
  answeredMidi: number;
  correct: boolean;
  responseTimeMs: number;
  inputMethod: "pointer" | "keyboard" | "midi";
  occurredAt: string;
}

export class MusicTrainerStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const metadataExists = this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_metadata'
    `).get() !== undefined;
    const version = metadataExists
      ? (this.db.prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'").get() as { value: string } | undefined)?.value
      : undefined;
    if (version === "4") return;

    this.db.pragma("foreign_keys = OFF");
    try {
      this.db.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS sessions;
        DROP TABLE IF EXISTS attempts;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS profiles;
        DROP TABLE IF EXISTS app_metadata;

        CREATE TABLE app_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO app_metadata (key, value) VALUES ('schema_version', '4');

        CREATE TABLE profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          question_id TEXT NOT NULL,
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          clef TEXT NOT NULL,
          name_system TEXT NOT NULL,
          expected_midi INTEGER NOT NULL,
          expected_step TEXT NOT NULL,
          expected_octave INTEGER NOT NULL,
          expected_alter INTEGER NOT NULL,
          key_fifths INTEGER NOT NULL,
          written_accidental INTEGER,
          answered_midi INTEGER NOT NULL,
          correct INTEGER NOT NULL,
          response_time_ms INTEGER NOT NULL,
          input_method TEXT NOT NULL,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX attempts_profile_direction
          ON attempts(profile_id, source, target, occurred_at);
        CREATE INDEX attempts_profile_context
          ON attempts(profile_id, source, target, clef, name_system, expected_midi, occurred_at);
        COMMIT;
      `);
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
  }

  createProfile(name: string, nameKey: string): StoredProfile {
    const result = this.db.prepare(`
      INSERT INTO profiles (name, name_key, created_at) VALUES (?, ?, ?)
    `).run(name, nameKey, new Date().toISOString());
    return this.findProfileById(Number(result.lastInsertRowid))!;
  }

  findProfileByNameKey(nameKey: string): StoredProfile | null {
    const row = this.db.prepare(`
      SELECT id, name FROM profiles WHERE name_key = ?
    `).get(nameKey) as StoredProfile | undefined;
    return row ?? null;
  }

  findProfileById(id: number): StoredProfile | null {
    const row = this.db.prepare("SELECT id, name FROM profiles WHERE id = ?").get(id) as StoredProfile | undefined;
    return row ?? null;
  }

  listProfiles(): ProfileSummary[] {
    return this.db.prepare(`
      SELECT profiles.id, profiles.name, COUNT(attempts.id) AS attempts,
        MAX(attempts.occurred_at) AS lastAttemptAt
      FROM profiles LEFT JOIN attempts ON attempts.profile_id = profiles.id
      GROUP BY profiles.id, profiles.name
      ORDER BY CASE WHEN lastAttemptAt IS NULL THEN 1 ELSE 0 END, lastAttemptAt DESC, profiles.id
    `).all() as ProfileSummary[];
  }

  createSession(profileId: number, tokenHash: string, expiresAt: number): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    this.db.prepare("INSERT INTO sessions (token_hash, profile_id, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash, profileId, expiresAt);
  }

  findProfileBySession(tokenHash: string): StoredProfile | null {
    const row = this.db.prepare(`
      SELECT profiles.id, profiles.name
      FROM sessions JOIN profiles ON profiles.id = sessions.profile_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash, Date.now()) as StoredProfile | undefined;
    return row ?? null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  recordAttempt(profileId: number, attempt: AttemptInput): void {
    this.db.prepare(`
      INSERT INTO attempts (
        profile_id, question_id, source, target, clef, name_system,
        expected_midi, expected_step, expected_octave, expected_alter, key_fifths, written_accidental, answered_midi,
        correct, response_time_ms, input_method, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profileId, attempt.questionId, attempt.source, attempt.target,
      attempt.clef, attempt.nameSystem, attempt.expectedMidi, attempt.expectedStep,
      attempt.expectedOctave, attempt.expectedAlter, attempt.keyFifths, attempt.writtenAccidental,
      attempt.answeredMidi, attempt.correct ? 1 : 0,
      attempt.responseTimeMs, attempt.inputMethod, attempt.occurredAt
    );
  }

  progress(profileId: number) {
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY source, target ORDER BY occurred_at DESC, id DESC
        ) AS recent_rank
        FROM attempts WHERE profile_id = ?
      )
      SELECT source, target, COUNT(*) AS attempts, SUM(correct) AS correct,
        ROUND(AVG(response_time_ms)) AS averageResponseTimeMs,
        SUM(CASE WHEN recent_rank <= 10 THEN 1 ELSE 0 END) AS recentAttempts,
        SUM(CASE WHEN recent_rank <= 10 THEN correct ELSE 0 END) AS recentCorrect,
        ROUND(AVG(CASE WHEN recent_rank <= 10 AND correct = 1 THEN response_time_ms END)) AS recentCorrectResponseTimeMs,
        ROUND(AVG(CASE WHEN recent_rank BETWEEN 11 AND 20 AND correct = 1 THEN response_time_ms END)) AS previousCorrectResponseTimeMs
      FROM ranked GROUP BY source, target
    `).all(profileId) as Array<{
      source: Representation;
      target: Representation;
      attempts: number;
      correct: number;
      averageResponseTimeMs: number;
      recentAttempts: number;
      recentCorrect: number;
      recentCorrectResponseTimeMs: number | null;
      previousCorrectResponseTimeMs: number | null;
    }>;
    return Object.fromEntries(rows.map((row) => [`${row.source}->${row.target}`, {
      attempts: row.attempts,
      correct: row.correct,
      accuracy: row.attempts === 0 ? 0 : row.correct / row.attempts,
      averageResponseTimeMs: row.averageResponseTimeMs,
      recentAttempts: row.recentAttempts,
      recentCorrect: row.recentCorrect,
      recentCorrectResponseTimeMs: row.recentCorrectResponseTimeMs,
      previousCorrectResponseTimeMs: row.previousCorrectResponseTimeMs
    }]));
  }

  masteryCells(profileId: number) {
    const rows = this.db.prepare(`
      SELECT source, target, clef, name_system AS nameSystem, expected_midi AS expectedMidi,
        expected_step AS expectedStep, expected_octave AS expectedOctave, expected_alter AS expectedAlter,
        key_fifths AS keyFifths, written_accidental AS writtenAccidental,
        COUNT(*) AS attempts, SUM(correct) AS correct,
        ROUND(AVG(response_time_ms)) AS averageResponseTimeMs,
        MAX(occurred_at) AS lastAttemptAt
      FROM attempts WHERE profile_id = ?
      GROUP BY source, target, clef, name_system, expected_midi, expected_step, expected_octave, expected_alter, key_fifths, written_accidental
      ORDER BY source, target, clef, name_system, expected_midi
    `).all(profileId) as Array<{
      source: Representation;
      target: Representation;
      clef: Clef;
      nameSystem: NameSystem;
      expectedMidi: number;
      expectedStep: Step;
      expectedOctave: number;
      expectedAlter: number;
      keyFifths: KeyFifths;
      writtenAccidental: WrittenAccidental | null;
      attempts: number;
      correct: number;
      averageResponseTimeMs: number;
      lastAttemptAt: string;
    }>;
    return rows.map((row) => ({
      ...row,
      accuracy: row.attempts === 0 ? 0 : row.correct / row.attempts
    }));
  }

  totalAttempts(profileId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM attempts WHERE profile_id = ?").get(profileId) as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
