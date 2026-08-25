import { describe, expect, it } from "vitest";
import { formatNoteName, type Note } from "./index.js";

function note(step: Note["step"], alter: number): Note {
  return { midi: 60 + alter, step, octave: 4, alter };
}

describe("note names", () => {
  it("uses H for German B natural and B for B-flat", () => {
    expect(formatNoteName(note("B", 0), "de")).toBe("h¹");
    expect(formatNoteName(note("B", -1), "de")).toBe("b¹");
  });

  it("formats German and Russian accidentals", () => {
    expect(formatNoteName(note("F", 1), "de", false)).toBe("Fis");
    expect(formatNoteName(note("E", -1), "de", false)).toBe("Es");
    expect(formatNoteName(note("C", 2), "ru", false)).toBe("До-дубль-диез");
  });

  it("formats octave registers as used in Russian theory exercises", () => {
    expect(formatNoteName(note("C", 0), "ru")).toBe("До первой октавы");
    expect(formatNoteName({ ...note("C", 0), octave: 3 }, "de")).toBe("c");
    expect(formatNoteName({ ...note("C", 0), octave: 2 }, "de")).toBe("C");
  });

  it("shows Russian and German names together", () => {
    expect(formatNoteName(note("C", 0), "all")).toBe("До первой октавы · c¹");
  });
});
