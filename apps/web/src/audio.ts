import { midiToFrequency } from "@music-trainer/core";

let audioContext: AudioContext | null = null;
export type PlaybackMode = "webaudio" | "midi";

let playbackMode: PlaybackMode = "webaudio";
let midiOutput: MIDIOutput | null = null;

export function configurePlayback(mode: PlaybackMode, output: MIDIOutput | null): void {
  playbackMode = mode;
  midiOutput = output;
}

export function playNote(midi: number, durationSeconds = 0.9): void {
  if (playbackMode === "midi" && midiOutput) {
    const output = midiOutput;
    output.send([0x90, midi, 100]);
    globalThis.setTimeout(() => output.send([0x80, midi, 0]), durationSeconds * 1000);
    return;
  }
  audioContext ??= new AudioContext();
  const context = audioContext;
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

/** Plays an ordered pitch sequence with equal spacing; rhythm training is deliberately out of scope. */
export function playSequence(midis: readonly number[], gapMs = 520): void {
  midis.forEach((midi, index) => {
    globalThis.setTimeout(() => playNote(midi, Math.min(0.75, gapMs / 1000)), index * gapMs);
  });
}
