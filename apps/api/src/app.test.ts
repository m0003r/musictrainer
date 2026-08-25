import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

async function createProfile(app: ReturnType<typeof createApp>, name = "Анна") {
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",
    payload: { name }
  });
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) throw new Error("Session cookie is missing");
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookieHeader) throw new Error("Session cookie is empty");
  return { response, cookie: cookieHeader.split(";", 1)[0]! };
}

describe("local profile API", () => {
  it("creates a profile, stores an attempt and aggregates progress", async () => {
    const app = createApp({ databasePath: ":memory:" });
    const created = await createProfile(app);
    expect(created.response.statusCode).toBe(201);
    expect(created.response.json()).toMatchObject({ profile: { name: "Анна" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/attempts",
      headers: { cookie: created.cookie },
      payload: {
        questionId: "q-1",
        source: "notation",
        target: "name",
        clef: "alto",
        nameSystem: "de",
        expectedMidi: 60,
        expectedStep: "C",
        expectedOctave: 4,
        expectedAlter: 0,
        keyFifths: 0,
        writtenAccidental: null,
        answeredMidi: 60,
        correct: true,
        responseTimeMs: 1200,
        inputMethod: "pointer",
        occurredAt: "2026-08-25T12:00:00.000Z"
      }
    });
    expect(response.statusCode).toBe(201);

    const progress = await app.inject({ method: "GET", url: "/api/progress", headers: { cookie: created.cookie } });
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toMatchObject({
      totalAttempts: 1,
      directions: {
        "notation->name": {
          attempts: 1, correct: 1, accuracy: 1, averageResponseTimeMs: 1200,
          recentAttempts: 1, recentCorrect: 1, recentCorrectResponseTimeMs: 1200
        }
      },
      masteryCells: [{
        source: "notation", target: "name", clef: "alto", nameSystem: "de",
        expectedMidi: 60, expectedStep: "C", expectedOctave: 4, expectedAlter: 0,
        keyFifths: 0, writtenAccidental: null,
        attempts: 1, correct: 1, accuracy: 1
      }]
    });
    await app.close();
  });

  it("rejects attempts without a session", async () => {
    const app = createApp({ databasePath: ":memory:" });
    const response = await app.inject({ method: "GET", url: "/api/progress" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects inconsistent correctness", async () => {
    const app = createApp({ databasePath: ":memory:" });
    const created = await createProfile(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/attempts",
      headers: { cookie: created.cookie },
      payload: {
        questionId: "q-2",
        source: "sound",
        target: "keyboard",
        clef: "treble",
        nameSystem: "ru",
        expectedMidi: 60,
        expectedStep: "C",
        expectedOctave: 4,
        expectedAlter: 0,
        keyFifths: 0,
        writtenAccidental: null,
        answeredMidi: 62,
        correct: true,
        responseTimeMs: 500,
        inputMethod: "midi",
        occurredAt: "2026-08-25T12:00:00.000Z"
      }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("leaves a profile and allows selecting it again without a password", async () => {
    const app = createApp({ databasePath: ":memory:" });
    const created = await createProfile(app, "Миша");
    const profileId = created.response.json().profile.id as number;
    const leave = await app.inject({ method: "POST", url: "/api/profiles/leave", headers: { cookie: created.cookie } });
    expect(leave.statusCode).toBe(200);
    const afterLeave = await app.inject({ method: "GET", url: "/api/profiles/current", headers: { cookie: created.cookie } });
    expect(afterLeave.statusCode).toBe(401);

    const select = await app.inject({
      method: "POST",
      url: `/api/profiles/${profileId}/select`
    });
    expect(select.statusCode).toBe(200);
    expect(select.json()).toMatchObject({ profile: { id: profileId, name: "Миша" } });
    await app.close();
  });

  it("lists profiles and rejects a duplicate normalized name", async () => {
    const app = createApp({ databasePath: ":memory:" });
    await createProfile(app, "  Анна   Мария  ");
    const list = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(list.json()).toMatchObject({ profiles: [{ name: "Анна Мария", attempts: 0 }] });
    const duplicate = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "анна мария" } });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });

  it("rejects a MIDI pitch inconsistent with its note spelling", async () => {
    const app = createApp({ databasePath: ":memory:" });
    const created = await createProfile(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/attempts",
      headers: { cookie: created.cookie },
      payload: {
        questionId: "q-spelling",
        source: "name",
        target: "keyboard",
        clef: "bass",
        nameSystem: "de",
        expectedMidi: 61,
        expectedStep: "C",
        expectedOctave: 4,
        expectedAlter: 0,
        keyFifths: 0,
        writtenAccidental: null,
        answeredMidi: 61,
        correct: true,
        responseTimeMs: 700,
        inputMethod: "pointer",
        occurredAt: "2026-08-25T12:00:00.000Z"
      }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("rejects an accidental inconsistent with the key signature context", async () => {
    const app = createApp({ databasePath: ":memory:" });
    const created = await createProfile(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/attempts",
      headers: { cookie: created.cookie },
      payload: {
        questionId: "q-signature",
        source: "notation",
        target: "keyboard",
        clef: "treble",
        nameSystem: "all",
        expectedMidi: 66,
        expectedStep: "F",
        expectedOctave: 4,
        expectedAlter: 1,
        keyFifths: 1,
        writtenAccidental: 0,
        answeredMidi: 66,
        correct: true,
        responseTimeMs: 500,
        inputMethod: "midi",
        occurredAt: "2026-08-25T12:00:00.000Z"
      }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
