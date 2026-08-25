import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLEFS, CLEF_LABELS } from "@music-trainer/core";
import { ClefGuide } from "./ClefGuide.js";

describe("clef guide", () => {
  it("explains the reference line for every selected clef", () => {
    const markup = renderToStaticMarkup(createElement(ClefGuide, { clefs: CLEFS }));

    for (const clef of CLEFS) expect(markup).toContain(CLEF_LABELS[clef]);
    expect(markup).toContain("Соседняя линия или промежуток");
  });
});
