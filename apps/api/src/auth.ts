import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "music_trainer_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
