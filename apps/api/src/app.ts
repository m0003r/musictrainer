import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { keySignatureAlter, midiForNote } from "@music-trainer/core";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  hashSessionToken
} from "./auth.js";
import { MusicTrainerStore, type AttemptInput, type StoredProfile } from "./database.js";

interface AppOptions {
  databasePath?: string;
  secureCookies?: boolean;
}

interface ProfileInput {
  name: string;
}

const profileSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 40 }
  },
  additionalProperties: false
} as const;

function normalizeProfileName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function profileNameKey(name: string): string {
  return name.toLocaleLowerCase("ru-RU");
}

function publicProfile(profile: StoredProfile) {
  return { id: profile.id, name: profile.name };
}

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const store = new MusicTrainerStore(options.databasePath ?? resolve(process.cwd(), "../../data/music-trainer.sqlite"));
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";

  void app.register(cookie);
  void app.register(cors, { origin: true, credentials: true });
  app.addHook("onClose", async () => store.close());

  function setSession(reply: FastifyReply, profile: StoredProfile): void {
    const { token, tokenHash } = createSessionToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    store.createSession(profile.id, tokenHash, expiresAt);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      expires: new Date(expiresAt)
    });
  }

  function currentProfile(request: FastifyRequest): StoredProfile | null {
    const token = request.cookies[SESSION_COOKIE];
    return token ? store.findProfileBySession(hashSessionToken(token)) : null;
  }

  function requireProfile(request: FastifyRequest, reply: FastifyReply): StoredProfile | null {
    const profile = currentProfile(request);
    if (!profile) {
      void reply.code(401).send({ error: "Profile required" });
      return null;
    }
    return profile;
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/profiles", async () => ({ profiles: store.listProfiles() }));

  app.post<{ Body: ProfileInput }>("/api/profiles", { schema: { body: profileSchema } }, async (request, reply) => {
    const name = normalizeProfileName(request.body.name);
    if (!name) return reply.code(400).send({ error: "Profile name is required" });
    const nameKey = profileNameKey(name);
    if (store.findProfileByNameKey(nameKey)) return reply.code(409).send({ error: "Profile already exists" });
    const profile = store.createProfile(name, nameKey);
    setSession(reply, profile);
    return reply.code(201).send({ profile: publicProfile(profile) });
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/select", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^[1-9][0-9]*$" } },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const profile = store.findProfileById(Number(request.params.id));
    if (!profile) return reply.code(404).send({ error: "Profile not found" });
    const currentToken = request.cookies[SESSION_COOKIE];
    if (currentToken) store.deleteSession(hashSessionToken(currentToken));
    setSession(reply, profile);
    return { profile: publicProfile(profile) };
  });

  app.post("/api/profiles/leave", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) store.deleteSession(hashSessionToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/profiles/current", async (request, reply) => {
    const profile = currentProfile(request);
    if (!profile) return reply.code(401).send({ error: "Profile required" });
    return { profile: publicProfile(profile) };
  });

  app.post<{ Body: AttemptInput }>("/api/attempts", {
    schema: {
      body: {
        type: "object",
        required: [
          "questionId", "source", "target", "clef", "nameSystem",
          "expectedMidi", "expectedStep", "expectedOctave", "expectedAlter", "answeredMidi",
          "keyFifths", "writtenAccidental", "correct", "responseTimeMs", "inputMethod", "occurredAt"
        ],
        properties: {
          questionId: { type: "string", minLength: 1, maxLength: 100 },
          source: { enum: ["notation", "name", "keyboard", "sound"] },
          target: { enum: ["notation", "name", "keyboard", "sound"] },
          clef: { enum: ["treble", "bass", "soprano", "mezzoSoprano", "alto", "tenor", "baritone"] },
          nameSystem: { enum: ["ru", "de", "all"] },
          expectedMidi: { type: "integer", minimum: 0, maximum: 127 },
          expectedStep: { enum: ["C", "D", "E", "F", "G", "A", "B"] },
          expectedOctave: { type: "integer", minimum: -1, maximum: 9 },
          expectedAlter: { type: "integer", minimum: -2, maximum: 2 },
          keyFifths: { type: "integer", minimum: -7, maximum: 7 },
          writtenAccidental: { anyOf: [{ type: "integer", minimum: -1, maximum: 1 }, { type: "null" }] },
          answeredMidi: { type: "integer", minimum: 0, maximum: 127 },
          correct: { type: "boolean" },
          responseTimeMs: { type: "integer", minimum: 0 },
          inputMethod: { enum: ["pointer", "keyboard", "midi"] },
          occurredAt: { type: "string" }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const profile = requireProfile(request, reply);
    if (!profile) return;
    const attempt = request.body;
    const inheritedAlter = keySignatureAlter(attempt.expectedStep, attempt.keyFifths);
    const writtenAlterIsValid = attempt.writtenAccidental === null
      ? attempt.expectedAlter === inheritedAlter
      : attempt.expectedAlter === attempt.writtenAccidental && attempt.writtenAccidental !== inheritedAlter;
    if (
      attempt.source === attempt.target ||
      Number.isNaN(Date.parse(attempt.occurredAt)) ||
      !writtenAlterIsValid ||
      midiForNote({ step: attempt.expectedStep, octave: attempt.expectedOctave, alter: attempt.expectedAlter }) !== attempt.expectedMidi ||
      attempt.correct !== (attempt.expectedMidi === attempt.answeredMidi)
    ) {
      return reply.code(400).send({ error: "Invalid attempt" });
    }
    store.recordAttempt(profile.id, attempt);
    return reply.code(201).send({ accepted: true });
  });

  app.get("/api/progress", async (request, reply) => {
    const profile = requireProfile(request, reply);
    if (!profile) return;
    return {
      profile: publicProfile(profile),
      totalAttempts: store.totalAttempts(profile.id),
      directions: store.progress(profile.id),
      masteryCells: store.masteryCells(profile.id)
    };
  });

  return app;
}
