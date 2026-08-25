import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { orderedSequenceIndices, PianoKeyboard } from "./PianoKeyboard.js";

describe("piano keyboard sequence labels", () => {
  it("keeps every ordered position when a note is repeated", () => {
    expect(orderedSequenceIndices([60, 62, 60], 60)).toEqual([1, 3]);
    expect(orderedSequenceIndices([60, 62, 60], 62)).toEqual([2]);
  });

  it("returns no position for a note outside the sequence", () => {
    expect(orderedSequenceIndices([60, 62, 60], 64)).toEqual([]);
  });

  it("renders repeated ordered positions in source and review modes", () => {
    const sourceMarkup = renderToStaticMarkup(createElement(PianoKeyboard, {
      mode: "source", range: { minMidi: 60, maxMidi: 64 }, noteMidis: [60, 62, 60]
    }));
    const reviewMarkup = renderToStaticMarkup(createElement(PianoKeyboard, {
      mode: "review", range: { minMidi: 60, maxMidi: 64 }, correctMidis: [60, 62, 60]
    }));

    for (const markup of [sourceMarkup, reviewMarkup]) {
      expect(markup).toContain('<span class="key-sequence-label">1</span>');
      expect(markup).toContain('<span class="key-sequence-label">2</span>');
      expect(markup).toContain('<span class="key-sequence-label">3</span>');
    }
  });

  it("renders every MIDI key as a button in answer mode", () => {
    const markup = renderToStaticMarkup(createElement(PianoKeyboard, {
      mode: "answer", range: { minMidi: 60, maxMidi: 64 }, selectedMidis: [], correctMidis: null,
      correctionOnly: false, disabled: false, onCommit: () => undefined
    }));

    expect(markup.split("<button")).toHaveLength(6);
    expect(markup).not.toContain("disabled");
  });
});
