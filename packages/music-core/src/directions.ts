import { REPRESENTATIONS, type Direction, type Representation } from "./types.js";

export const REPRESENTATION_LABELS: Record<Representation, string> = {
  notation: "Запись",
  name: "Название",
  keyboard: "Клавиатура",
  sound: "Звучание"
};

export const DIRECTIONS: Direction[] = REPRESENTATIONS.flatMap((source) =>
  REPRESENTATIONS.filter((target) => target !== source).map((target) => ({ source, target }))
);

export function directionKey(direction: Direction): string {
  return `${direction.source}->${direction.target}`;
}

export function parseDirection(value: string): Direction | null {
  const [source, target] = value.split("->") as [Representation | undefined, Representation | undefined];
  if (!source || !target || source === target) {
    return null;
  }
  if (!REPRESENTATIONS.includes(source) || !REPRESENTATIONS.includes(target)) {
    return null;
  }
  return { source, target };
}

export function formatDirection(direction: Direction): string {
  return `${REPRESENTATION_LABELS[direction.source]} → ${REPRESENTATION_LABELS[direction.target]}`;
}

export function directionsForSelections(
  sources: readonly Representation[],
  targets: readonly Representation[]
): Direction[] {
  return sources.flatMap((source) => (
    targets.filter((target) => target !== source).map((target) => ({ source, target }))
  ));
}
