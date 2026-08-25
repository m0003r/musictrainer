import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { createNaturalRange } from "@music-trainer/core";

export interface MidiRange {
  minMidi: number;
  maxMidi: number;
}

interface CommonProps {
  range: MidiRange;
  compact?: boolean;
  showNoteLabels?: boolean;
  showOctaveLabels?: boolean;
}

type PianoKeyboardProps = CommonProps & (
  | {
      mode: "source";
      noteMidis: readonly number[];
    }
  | {
      mode: "answer";
      selectedMidis: readonly number[];
      correctMidis: readonly number[] | null;
      correctionOnly: boolean;
      disabled: boolean;
      onCommit: (midi: number) => void;
    }
  | {
      mode: "review";
      correctMidis: readonly number[];
      selectedMidis?: readonly number[] | null;
    }
);

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const KEY_LABELS = [
  "До · C",
  "До♯ / Ре♭ · Cis / Des",
  "Ре · D",
  "Ре♯ / Ми♭ · Dis / Es",
  "Ми · E",
  "Фа · F",
  "Фа♯ / Соль♭ · Fis / Ges",
  "Соль · G",
  "Соль♯ / Ля♭ · Gis / As",
  "Ля · A",
  "Ля♯ / Си♭ · Ais / B",
  "Си · H"
] as const;
const OCTAVE_LABELS: Record<number, string> = {
  1: "контр.", 2: "большая", 3: "малая", 4: "1 октава", 5: "2 октава", 6: "3 октава", 7: "4 октава"
};

function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

export function PianoKeyboard(props: PianoKeyboardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const whiteNotes = useMemo(
    () => createNaturalRange(props.range.minMidi, props.range.maxMidi),
    [props.range.maxMidi, props.range.minMidi]
  );
  const blackMidis = useMemo(
    () => Array.from(
      { length: props.range.maxMidi - props.range.minMidi + 1 },
      (_, index) => props.range.minMidi + index
    ).filter(isBlackKey),
    [props.range.maxMidi, props.range.minMidi]
  );
  function classesFor(midi: number): string {
    const classes = ["piano-key"];
    if (props.mode === "source" && props.noteMidis.includes(midi)) classes.push("is-active");
    if (props.mode === "review") {
      if (props.correctMidis.includes(midi)) classes.push("is-correct");
      else if (props.selectedMidis?.includes(midi)) classes.push("is-wrong");
    }
    if (props.mode === "answer") {
      if (props.correctMidis !== null) {
        if (props.correctMidis.includes(midi)) classes.push("is-correct");
        else if (props.selectedMidis.includes(midi)) classes.push("is-wrong");
        else classes.push("is-muted");
      } else if (props.selectedMidis.includes(midi)) {
        classes.push("is-active");
      }
      if (props.correctionOnly && props.correctMidis?.includes(midi)) classes.push("needs-correction");
    }
    return classes.join(" ");
  }

  function keyContents(midi: number): ReactNode {
    const pitchClass = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const sourceMidis = props.mode === "source" ? props.noteMidis : [];
    const sequenceIndex = sourceMidis.indexOf(midi);
    return (
      <>
        {props.showNoteLabels && <span className="key-note-label">{KEY_LABELS[pitchClass]}</span>}
        {props.showOctaveLabels && pitchClass === 0 && <span className="key-octave-label">{OCTAVE_LABELS[octave] ?? `${octave} октава`}</span>}
        {sequenceIndex >= 0 && sourceMidis.length > 1 && <span className="key-sequence-label">{sequenceIndex + 1}</span>}
      </>
    );
  }

  function renderKey(midi: number, kind: "white" | "black") {
    const className = `${kind}-key ${classesFor(midi)}`;

    if (props.mode === "answer") {
      return (
        <button
          type="button"
          className={className}
          disabled={props.disabled}
          onClick={() => props.onCommit(midi)}
          aria-label={`${KEY_LABELS[((midi % 12) + 12) % 12]}, MIDI ${midi}`}
        >
          {keyContents(midi)}
        </button>
      );
    }
    return <span className={className} aria-hidden="true">{keyContents(midi)}</span>;
  }

  const ariaLabel = props.mode === "source"
    ? "Фортепианная клавиатура с выделенной последовательностью клавиш"
    : props.mode === "answer"
      ? "Фортепианная клавиатура: нажмите любую клавишу"
      : "Правильная клавиша на фортепианной клавиатуре";
  const boardStyle = { "--white-key-count": whiteNotes.length } as CSSProperties;

  return (
    <div
      className={`piano-viewport is-${props.mode}${props.compact ? " is-compact" : ""}`}
      ref={viewportRef}
      role={props.mode === "answer" ? "group" : "img"}
      aria-label={ariaLabel}
    >
      <div className="piano" style={boardStyle}>
        <div className="white-keys">
          {whiteNotes.map((note) => <span className="white-key-slot" key={note.midi}>{renderKey(note.midi, "white")}</span>)}
        </div>
        {blackMidis.map((midi) => {
          const precedingWhites = whiteNotes.filter((note) => note.midi < midi).length;
          const style = {
            left: `${(precedingWhites / whiteNotes.length) * 100}%`,
            width: `${(0.62 / whiteNotes.length) * 100}%`
          };
          return <span className="black-key-slot" key={midi} style={style}>{renderKey(midi, "black")}</span>;
        })}
      </div>
    </div>
  );
}
