import { afterEach, describe, expect, it, vi } from "vitest";
import { configurePlayback, disposeAudio, playNote, playSequence } from "./audio.js";

function installAudioContext(initialState: AudioContextState = "running") {
  const oscillator = () => ({
    type: "sine",
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  });
  const context = {
    currentTime: 2,
    state: initialState,
    destination: {},
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn()
    })),
    createOscillator: vi.fn(oscillator),
    resume: vi.fn(async () => { context.state = "running"; }),
    close: vi.fn(async () => { context.state = "closed"; })
  };
  vi.stubGlobal("AudioContext", vi.fn(function AudioContext() { return context; }));
  return context;
}

describe("audio playback routing", () => {
  afterEach(() => {
    disposeAudio();
    configurePlayback("webaudio", null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends note-on and note-off through the selected MIDI output", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    playNote(61, 0.5);
    expect(send).toHaveBeenCalledWith([0x90, 61, 100]);
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenLastCalledWith([0x80, 61, 0]);
  });

  it("does not send note-off to an output removed during playback", () => {
    vi.useFakeTimers();
    const output = { state: "connected", connection: "open", send: vi.fn() };
    configurePlayback("midi", output as unknown as MIDIOutput);

    playNote(61, 0.5);
    output.state = "disconnected";
    vi.advanceTimersByTime(500);

    expect(output.send).toHaveBeenCalledTimes(1);
  });

  it("falls back to Web Audio when MIDI send fails", () => {
    const context = installAudioContext();
    configurePlayback("midi", { send: vi.fn(() => { throw new Error("removed"); }) } as unknown as MIDIOutput);

    expect(() => playNote(64)).not.toThrow();

    expect(context.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("resumes a suspended AudioContext before creating audio nodes", async () => {
    const context = installAudioContext("suspended");

    playNote(60);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.createOscillator).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("cancels notes in a sequence that have not started", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    const playback = playSequence([60, 62, 64], 100);
    vi.advanceTimersByTime(0);
    playback.cancel();
    vi.advanceTimersByTime(1000);

    const noteOns = send.mock.calls.filter(([message]) => message[0] === 0x90);
    expect(noteOns).toEqual([[[0x90, 60, 100]]]);
  });
});
