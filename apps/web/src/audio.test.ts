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

  it("sends an immediate best-effort note-off when disposed during a MIDI note", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    playNote(67, 5);
    disposeAudio();
    vi.advanceTimersByTime(5000);

    expect(send.mock.calls).toEqual([
      [[0x90, 67, 100]],
      [[0x80, 67, 0]]
    ]);
  });

  it("keeps disposal safe when immediate MIDI note-off is rejected", () => {
    vi.useFakeTimers();
    const send = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error("device removed"); });
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    playNote(69, 5);

    expect(() => disposeAudio()).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("still closes an existing Web Audio context on disposal", () => {
    const context = installAudioContext();

    playNote(60);
    disposeAudio();

    expect(context.close).toHaveBeenCalledOnce();
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

  it("reports the first Web Audio onset synchronously for a running context and only once", () => {
    vi.useFakeTimers();
    const context = installAudioContext();
    const onFirstNoteStarted = vi.fn();

    playSequence([60, 62], 100, onFirstNoteStarted);

    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    expect(onFirstNoteStarted).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(context.createOscillator).toHaveBeenCalledTimes(4);
    expect(onFirstNoteStarted).toHaveBeenCalledOnce();
  });

  it("waits for a suspended context to resume and start before reporting onset", async () => {
    const context = installAudioContext("suspended");
    let resolveResume!: () => void;
    context.resume.mockImplementation(() => new Promise<void>((resolve) => {
      resolveResume = () => {
        context.state = "running";
        resolve();
      };
    }));
    const onFirstNoteStarted = vi.fn();

    playSequence([60], 100, onFirstNoteStarted);
    expect(onFirstNoteStarted).not.toHaveBeenCalled();
    expect(context.createOscillator).not.toHaveBeenCalled();

    resolveResume();
    await Promise.resolve();

    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    expect(onFirstNoteStarted).toHaveBeenCalledOnce();
  });

  it("does not report onset when resuming a suspended context fails", async () => {
    const context = installAudioContext("suspended");
    context.resume.mockRejectedValue(new Error("resume rejected"));
    const onFirstNoteStarted = vi.fn();

    playSequence([60], 100, onFirstNoteStarted);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(onFirstNoteStarted).not.toHaveBeenCalled();
  });

  it("does not start or report onset when cancelled before a suspended context resumes", async () => {
    const context = installAudioContext("suspended");
    let resolveResume!: () => void;
    context.resume.mockImplementation(() => new Promise<void>((resolve) => {
      resolveResume = () => {
        context.state = "running";
        resolve();
      };
    }));
    const onFirstNoteStarted = vi.fn();

    const playback = playSequence([60], 100, onFirstNoteStarted);
    playback.cancel();
    resolveResume();
    await Promise.resolve();

    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(onFirstNoteStarted).not.toHaveBeenCalled();
  });

  it("reports onset after a successful MIDI note-on and only once per sequence", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const onFirstNoteStarted = vi.fn();
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    playSequence([60, 62], 100, onFirstNoteStarted);

    expect(send).toHaveBeenCalledWith([0x90, 60, 100]);
    expect(onFirstNoteStarted).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledWith([0x90, 62, 100]);
    expect(onFirstNoteStarted).toHaveBeenCalledOnce();
  });

  it("cancels notes in a sequence that have not started", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    const playback = playSequence([60, 62, 64], 100);
    expect(send).toHaveBeenCalledWith([0x90, 60, 100]);
    playback.cancel();
    vi.advanceTimersByTime(1000);

    const noteOns = send.mock.calls.filter(([message]) => message[0] === 0x90);
    expect(noteOns).toEqual([[[0x90, 60, 100]]]);
  });

  it("silences active Web Audio voices when a sequence is cancelled", () => {
    const context = installAudioContext();

    const playback = playSequence([60], 100);
    const oscillators = context.createOscillator.mock.results.map(({ value }) => value);
    playback.cancel();

    expect(oscillators).toHaveLength(2);
    for (const oscillator of oscillators) {
      expect(oscillator.stop).toHaveBeenLastCalledWith(context.currentTime);
    }
  });

  it("sends one immediate MIDI note-off and cancels the scheduled duplicate", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    configurePlayback("midi", { send } as unknown as MIDIOutput);

    const playback = playSequence([65], 100);
    playback.cancel();

    expect(send.mock.calls).toEqual([
      [[0x90, 65, 100]],
      [[0x80, 65, 0]]
    ]);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not silence another sequence when one Web Audio sequence is cancelled", () => {
    const context = installAudioContext();

    const first = playSequence([60], 100);
    playSequence([67], 100);
    const oscillators = context.createOscillator.mock.results.map(({ value }) => value);
    first.cancel();

    expect(oscillators).toHaveLength(4);
    expect(oscillators[0].stop).toHaveBeenLastCalledWith(context.currentTime);
    expect(oscillators[1].stop).toHaveBeenLastCalledWith(context.currentTime);
    expect(oscillators[2].stop).toHaveBeenCalledOnce();
    expect(oscillators[3].stop).toHaveBeenCalledOnce();
  });
});
