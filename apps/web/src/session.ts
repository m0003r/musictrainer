import { DIRECTIONS, directionKey, type Direction } from "@music-trainer/core";

export interface SessionDirectionStats {
  attempts: number;
  correct: number;
  averageResponseTimeMs?: number;
  recentAttempts?: number;
  recentCorrect?: number;
  recentCorrectResponseTimeMs?: number | null;
  previousCorrectResponseTimeMs?: number | null;
}

export type SessionStats = Record<string, SessionDirectionStats>;

export function chooseMixedDirection(
  stats: SessionStats,
  rng = Math.random,
  directions: readonly Direction[] = DIRECTIONS
): Direction {
  if (directions.length === 0) throw new Error("At least one direction is required");
  const weights = directions.map((direction) => {
    const current = stats[directionKey(direction)];
    if (!current) {
      return 4;
    }
    const recentAttempts = current.recentAttempts ?? current.attempts;
    const recentCorrect = current.recentCorrect ?? current.correct;
    const errorRate = recentAttempts === 0 ? 1 : 1 - recentCorrect / recentAttempts;
    const uncertainty = 2 / Math.sqrt(current.attempts + 1);
    const recentTime = current.recentCorrectResponseTimeMs;
    const previousTime = current.previousCorrectResponseTimeMs;
    const slowdown = recentTime && previousTime
      ? Math.max(-0.5, Math.min(1, recentTime / previousTime - 1))
      : 0;
    return Math.max(0.5, 1 + errorRate * 5 + uncertainty + slowdown * 2);
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = rng() * total;
  for (let index = 0; index < directions.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor <= 0) {
      return directions[index] ?? directions[0]!;
    }
  }
  return directions[directions.length - 1]!;
}

export function recordSessionAttempt(
  stats: SessionStats,
  direction: Direction,
  correct: boolean,
  responseTimeMs?: number
): SessionStats {
  const key = directionKey(direction);
  const current = stats[key] ?? { attempts: 0, correct: 0 };
  const next: SessionDirectionStats = {
    attempts: current.attempts + 1,
    correct: current.correct + (correct ? 1 : 0)
  };
  if (responseTimeMs !== undefined) {
    next.averageResponseTimeMs = Math.round(
      ((current.averageResponseTimeMs ?? 0) * current.attempts + responseTimeMs) / (current.attempts + 1)
    );
  }
  if (current.recentAttempts !== undefined) next.recentAttempts = current.recentAttempts;
  if (current.recentCorrect !== undefined) next.recentCorrect = current.recentCorrect;
  if (current.recentCorrectResponseTimeMs !== undefined) next.recentCorrectResponseTimeMs = current.recentCorrectResponseTimeMs;
  if (current.previousCorrectResponseTimeMs !== undefined) next.previousCorrectResponseTimeMs = current.previousCorrectResponseTimeMs;
  return {
    ...stats,
    [key]: next
  };
}
