import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLEFS, CLEF_LABELS } from "@music-trainer/core";
import { NOTATION_RENDER_OPTIONS, NotationCard } from "./NotationCard.js";

describe("notation rendering options", () => {
  it("does not draw a time signature in isolated pitch exercises", () => {
    expect(NOTATION_RENDER_OPTIONS.drawTimeSignatures).toBe(false);
  });

  it("exposes the selected clef for accessibility and acceptance diagnostics", () => {
    for (const clef of CLEFS) {
      const markup = renderToStaticMarkup(createElement(NotationCard, {
        note: { midi: 60, step: "C", octave: 4, alter: 0 },
        clef
      }));
      expect(markup).toContain(`data-clef="${clef}"`);
      expect(markup).toContain(`Нотная запись, ${CLEF_LABELS[clef]}`);
    }
  });
});
