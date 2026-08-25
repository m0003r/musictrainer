import type { Clef, KeyFifths, Note, WrittenAccidental } from "./types.js";

const clefDefinitions: Record<Clef, { sign: "G" | "F" | "C"; line: number }> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
  soprano: { sign: "C", line: 1 },
  mezzoSoprano: { sign: "C", line: 2 },
  alto: { sign: "C", line: 3 },
  tenor: { sign: "C", line: 4 },
  baritone: { sign: "F", line: 3 }
};

export const CLEF_LABELS: Record<Clef, string> = {
  treble: "Скрипичный",
  bass: "Басовый",
  soprano: "Сопрановый",
  mezzoSoprano: "Меццо-сопрановый",
  alto: "Альтовый",
  tenor: "Теноровый",
  baritone: "Баритоновый"
};

export function noteToMusicXml(
  note: Note | readonly Note[],
  clef: Clef,
  keyFifths: KeyFifths = 0,
  writtenAccidental: WrittenAccidental | null | readonly (WrittenAccidental | null)[] = null
): string {
  const definition = clefDefinitions[clef];
  const notes = Array.isArray(note) ? note : [note];
  const accidentals = Array.isArray(writtenAccidental)
    ? writtenAccidental
    : notes.map((_, index) => index === 0 ? writtenAccidental : null);
  const renderedNotes = notes.map((current, index) => {
    const alter = current.alter === 0 ? "" : `<alter>${current.alter}</alter>`;
    const printed = accidentals[index] ?? null;
    const accidental = printed === null
      ? ""
      : `<accidental>${printed === 0 ? "natural" : printed > 0 ? "sharp" : "flat"}</accidental>`;
    return `<note>
        <pitch><step>${current.step}</step>${alter}<octave>${current.octave}</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        ${accidental}
      </note>`;
  }).join("\n      ");
  const measureWidth = 360 + Math.max(0, notes.length - 1) * 72;

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Note</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1" implicit="yes" width="${measureWidth}">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>${keyFifths}</fifths></key>
        <clef><sign>${definition.sign}</sign><line>${definition.line}</line></clef>
      </attributes>
      ${renderedNotes}
      <note print-object="no" print-spacing="yes">
        <rest />
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
}
