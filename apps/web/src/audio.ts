import { midiToFrequency } from "@music-trainer/core";

let audioContext: AudioContext | null = null;
export type PlaybackMode = "webaudio" | "midi";

let playbackMode: PlaybackMode = "webaudio";
let midiOutput: MIDIOutput | null = null;
interface PendingMidiNoteOff {
  midi: number;
  output: MIDIOutput;
}

const pendingMidiNoteOffs = new Map<ReturnType<typeof globalThis.setTimeout>, PendingMidiNoteOff>();

export interface SequencePlayback {
  cancel(): void;
}

export function configurePlayback(mode: PlaybackMode, output: MIDIOutput | null): void {
  playbackMode = mode;
  midiOutput = output;
}

function canSendTo(output: MIDIOutput): boolean {
  return (output.state === undefined || output.state === "connected") && output.connection !== "closed";
}

function tryPlayMidiNote(midi: number, durationSeconds: number): boolean {
  const output = midiOutput;
  if (playbackMode !== "midi" || !output || !canSendTo(output)) return false;
  try {
    output.send([0x90, midi, 100]);
  } catch {
    return false;
  }

  const timer = globalThis.setTimeout(() => {
    pendingMidiNoteOffs.delete(timer);
    if (!canSendTo(output)) return;
    try {
      output.send([0x80, midi, 0]);
    } catch {
      // A hot-unplugged output must not turn a scheduled note-off into an error.
    }
  }, durationSeconds * 1000);
  pendingMidiNoteOffs.set(timer, { midi, output });
  return true;
}

function startWebAudioNote(context: AudioContext, midi: number, durationSeconds: number): void {
  const now = context.currentTime;
  const frequency = midiToFrequency(midi);
  const gain = context.createGain();
  const fundamental = context.createOscillator();
  const overtone = context.createOscillator();

  fundamental.type = "triangle";
  fundamental.frequency.value = frequency;
  overtone.type = "sine";
  overtone.frequency.value = frequency * 2;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.35, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  fundamental.connect(gain);
  overtone.connect(gain);
  gain.connect(context.destination);

  fundamental.start(now);
  overtone.start(now);
  fundamental.stop(now + durationSeconds);
  overtone.stop(now + durationSeconds);
}

export function playNote(midi: number, durationSeconds = 0.9): void {
  if (tryPlayMidiNote(midi, durationSeconds)) return;

  audioContext ??= new AudioContext();
  const context = audioContext;
  if (context.state === "suspended") {
    void context.resume().then(() => {
      if (audioContext === context && context.state !== "closed") startWebAudioNote(context, midi, durationSeconds);
    }).catch(() => undefined);
    return;
  }
  if (context.state !== "closed") startWebAudioNote(context, midi, durationSeconds);
}

/** Plays an ordered pitch sequence with equal spacing; rhythm training is deliberately out of scope. */
export function playSequence(midis: readonly number[], gapMs = 520): SequencePlayback {
  const durationSeconds = Math.min(0.75, gapMs / 1000);
  if (midis[0] !== undefined) playNote(midis[0], durationSeconds);
  const timers: Array<ReturnType<typeof globalThis.setTimeout> | null> = midis.slice(1).map((midi, index) => globalThis.setTimeout(
    () => {
      timers[index] = null;
      playNote(midi, durationSeconds);
    },
    (index + 1) * gapMs
  ));
  return {
    cancel() {
      for (const timer of timers) {
        if (timer !== null) globalThis.clearTimeout(timer);
      }
      timers.fill(null);
    }
  };
}

export function disposeAudio(): void {
  for (const [timer, { midi, output }] of pendingMidiNoteOffs) {
    globalThis.clearTimeout(timer);
    try {
      output.send([0x80, midi, 0]);
    } catch {
      // Cleanup remains best-effort when the output disappeared before disposal.
    }
  }
  pendingMidiNoteOffs.clear();
  const context = audioContext;
  audioContext = null;
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
}
