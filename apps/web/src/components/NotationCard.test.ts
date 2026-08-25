import { describe, expect, it } from "vitest";
import { NOTATION_RENDER_OPTIONS } from "./NotationCard.js";

describe("notation rendering options", () => {
  it("does not draw a time signature in isolated pitch exercises", () => {
    expect(NOTATION_RENDER_OPTIONS.drawTimeSignatures).toBe(false);
  });
});
