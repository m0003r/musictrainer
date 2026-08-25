import { afterEach, describe, expect, it, vi } from "vitest";
import { configurePlayback, playNote } from "./audio.js";

describe("audio playback routing", () => {
  afterEach(() => {
    configurePlayback("webaudio", null);
    vi.useRealTimers();
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
});
