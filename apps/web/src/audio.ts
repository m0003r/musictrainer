import { midiToFrequency } from "@music-trainer/core";

let audioContext: AudioContext | null = null;
export type PlaybackMode = "webaudio" | "midi";

let playbackMode: PlaybackMode = "webaudio";
let midiOutput: MIDIOutput | null = null;
interface NotePlayback {
  cancel(): void;
}

const pendingMidiNoteOffs = new Map<ReturnType<typeof globalThis.setTimeout>, NotePlayback>();

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

function sendMidiNoteOff(output: MIDIOutput, midi: number): void {
  try {
    output.send([0x80, midi, 0]);
  } catch {
    // Cleanup remains best-effort when the output disappeared during playback.
  }
}

function tryPlayMidiNote(midi: number, durationSeconds: number): NotePlayback | null {
  const output = midiOutput;
  if (playbackMode !== "midi" || !output || !canSendTo(output)) return null;
  try {
    output.send([0x90, midi, 100]);
  } catch {
    return null;
  }

  let active = true;
  const timer = globalThis.setTimeout(() => {
    pendingMidiNoteOffs.delete(timer);
    active = false;
    if (!canSendTo(output)) return;
    sendMidiNoteOff(output, midi);
  }, durationSeconds * 1000);
  const playback = {
    cancel() {
      if (!active) return;
      active = false;
      globalThis.clearTimeout(timer);
      pendingMidiNoteOffs.delete(timer);
      sendMidiNoteOff(output, midi);
    }
  };
  pendingMidiNoteOffs.set(timer, playback);
  return playback;
}

function startWebAudioNote(context: AudioContext, midi: number, durationSeconds: number): NotePlayback {
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

  let active = true;
  return {
    cancel() {
      if (!active) return;
      active = false;
      const cancelTime = context.currentTime;
      try {
        fundamental.stop(cancelTime);
      } catch {
        // A closed context or an already-ended oscillator needs no further cleanup.
      }
      try {
        overtone.stop(cancelTime);
      } catch {
        // A closed context or an already-ended oscillator needs no further cleanup.
      }
    }
  };
}

function startNote(midi: number, durationSeconds: number): NotePlayback {
  const midiPlayback = tryPlayMidiNote(midi, durationSeconds);
  if (midiPlayback) return midiPlayback;

  audioContext ??= new AudioContext();
  const context = audioContext;
  if (context.state === "suspended") {
    let cancelled = false;
    let playback: NotePlayback | null = null;
    void context.resume().then(() => {
      if (!cancelled && audioContext === context && context.state !== "closed") {
        playback = startWebAudioNote(context, midi, durationSeconds);
      }
    }).catch(() => undefined);
    return {
      cancel() {
        cancelled = true;
        playback?.cancel();
      }
    };
  }
  if (context.state !== "closed") return startWebAudioNote(context, midi, durationSeconds);
  return { cancel() {} };
}

export function playNote(midi: number, durationSeconds = 0.9): void {
  startNote(midi, durationSeconds);
}

/** Plays an ordered pitch sequence with equal spacing; rhythm training is deliberately out of scope. */
export function playSequence(midis: readonly number[], gapMs = 520): SequencePlayback {
  const durationSeconds = Math.min(0.75, gapMs / 1000);
  const notes: NotePlayback[] = [];
  if (midis[0] !== undefined) notes.push(startNote(midis[0], durationSeconds));
  const timers: Array<ReturnType<typeof globalThis.setTimeout> | null> = midis.slice(1).map((midi, index) => globalThis.setTimeout(
    () => {
      timers[index] = null;
      notes.push(startNote(midi, durationSeconds));
    },
    (index + 1) * gapMs
  ));
  return {
    cancel() {
      for (const timer of timers) {
        if (timer !== null) globalThis.clearTimeout(timer);
      }
      timers.fill(null);
      for (const note of notes) note.cancel();
      notes.length = 0;
    }
  };
}

export function disposeAudio(): void {
  for (const playback of pendingMidiNoteOffs.values()) playback.cancel();
  pendingMidiNoteOffs.clear();
  const context = audioContext;
  audioContext = null;
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
}
