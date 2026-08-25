import { accidentalForNote, formatNoteName, notesForClef, type Clef, type KeyFifths, type NameSystem, type Note, type Representation, type WrittenAccidental } from "@music-trainer/core";
import { playSequence } from "../audio.js";
import { NotationCard } from "./NotationCard.js";
import { PianoKeyboard } from "./PianoKeyboard.js";
import type { MidiRange } from "./PianoKeyboard.js";

interface RepresentationViewProps {
  representation: Representation;
  note: Note | readonly Note[];
  clef: Clef;
  nameSystem: NameSystem;
  onPresented?: () => void;
  showKeyboardNoteLabels?: boolean;
  showKeyboardOctaveLabels?: boolean;
  keyboardRange?: MidiRange;
  keyFifths?: KeyFifths;
  writtenAccidental?: WrittenAccidental | null | readonly (WrittenAccidental | null)[];
  onPlaySequence?: (midis: readonly number[], onFirstNoteStarted?: () => void) => void;
}

export function playSoundPrompt(
  midis: readonly number[],
  onPresented?: () => void,
  onPlaySequence?: (midis: readonly number[], onFirstNoteStarted?: () => void) => void
): void {
  if (onPlaySequence) onPlaySequence(midis, onPresented);
  else playSequence(midis, 520, onPresented);
}

export function RepresentationView({
  representation, note, clef, nameSystem, onPresented,
  showKeyboardNoteLabels = false, showKeyboardOctaveLabels = false, keyboardRange,
  keyFifths = 0, writtenAccidental, onPlaySequence
}: RepresentationViewProps) {
  const notes = Array.isArray(note) ? note : [note];
  if (representation === "notation") {
    return <NotationCard note={note} clef={clef} keyFifths={keyFifths}
      writtenAccidental={writtenAccidental === undefined ? notes.map((item) => accidentalForNote(item, keyFifths)) : writtenAccidental}
      {...(onPresented ? { onRendered: onPresented } : {})} />;
  }
  if (representation === "name") {
    if (nameSystem === "all") {
      return (
        <div className="note-names">
          <span><small>Русские слоги</small><strong>{notes.map((item) => formatNoteName(item, "ru")).join(" · ")}</strong></span>
          <span><small>Буквенная система</small><strong>{notes.map((item) => formatNoteName(item, "de")).join(" · ")}</strong></span>
        </div>
      );
    }
    return <div className="note-name">{notes.map((item) => formatNoteName(item, nameSystem)).join(" · ")}</div>;
  }
  if (representation === "keyboard") {
    const rangeNotes = notesForClef(clef);
    return (
      <PianoKeyboard
        mode="source"
        noteMidis={notes.map((item) => item.midi)}
        range={keyboardRange ?? { minMidi: rangeNotes[0]!.midi, maxMidi: rangeNotes[rangeNotes.length - 1]!.midi }}
        showNoteLabels={showKeyboardNoteLabels}
        showOctaveLabels={showKeyboardOctaveLabels}
      />
    );
  }
  return (
    <button className="sound-button" type="button" onClick={() => playSoundPrompt(notes.map((item) => item.midi), onPresented, onPlaySequence)}>
      <span aria-hidden="true">♪</span>
      Прослушать
    </button>
  );
}
