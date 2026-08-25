import { describe, expect, it } from "vitest";
import { CLEFS, noteFromMidi, noteToMusicXml, type Clef } from "./index.js";

const expectedClefs: Record<Clef, readonly [sign: string, line: number]> = {
  treble: ["G", 2],
  bass: ["F", 4],
  soprano: ["C", 1],
  mezzoSoprano: ["C", 2],
  alto: ["C", 3],
  tenor: ["C", 4],
  baritone: ["F", 3]
};

describe("MusicXML", () => {
  it("writes every supported clef with the correct sign and line", () => {
    for (const clef of CLEFS) {
      const [sign, line] = expectedClefs[clef];
      const xml = noteToMusicXml(noteFromMidi(60), clef);
      expect(xml).toContain(`<clef><sign>${sign}</sign><line>${line}</line></clef>`);
      expect(xml).toContain('<measure number="1" implicit="yes" width="360">');
      expect(xml).toContain('<note print-object="no" print-spacing="yes">');
      expect(xml).toContain("<pitch><step>C</step><octave>4</octave></pitch>");
      expect(xml).not.toContain("<time>");
    }
  });

  it("writes key signatures and explicit sharps, flats and naturals without a time signature", () => {
    const natural = noteToMusicXml({ midi: 65, step: "F", octave: 4, alter: 0 }, "treble", 1, 0);
    expect(natural).toContain("<key><fifths>1</fifths></key>");
    expect(natural).toContain("<accidental>natural</accidental>");
    expect(natural).not.toContain("<time>");

    const flat = noteToMusicXml({ midi: 61, step: "D", octave: 4, alter: -1 }, "bass", -3, -1);
    expect(flat).toContain("<alter>-1</alter>");
    expect(flat).toContain("<accidental>flat</accidental>");
  });

  it("writes five equal-duration notes on a staff wide enough for seven key signs", () => {
    const notes = [60, 62, 64, 65, 67].map(noteFromMidi);
    const xml = noteToMusicXml(notes, "treble", 7, [null, null, null, 0, null]);
    const visibleNotes = xml.match(/<note>/g) ?? [];

    expect(xml).toContain('<measure number="1" implicit="yes" width="648">');
    expect(xml).toContain("<key><fifths>7</fifths></key>");
    expect(visibleNotes).toHaveLength(5);
    expect(xml.match(/<duration>1<\/duration>/g)).toHaveLength(5);
    expect(xml.match(/<type>quarter<\/type>/g)).toHaveLength(5);
    expect(xml).toContain("<accidental>natural</accidental>");
    expect(xml).not.toContain("<time>");
  });
});
