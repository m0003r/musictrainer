import { describe, expect, it, vi } from "vitest";
import { describeMidiInputs, noteOnFromMidiData, openMidiInput } from "./useMidi.js";

describe("MIDI input", () => {
  it("accepts note-on messages on every channel", () => {
    expect(noteOnFromMidiData([0x90, 60, 100])).toBe(60);
    expect(noteOnFromMidiData([0x9f, 71, 1])).toBe(71);
  });

  it("ignores note-off, zero velocity and invalid pitches", () => {
    expect(noteOnFromMidiData([0x80, 60, 100])).toBeNull();
    expect(noteOnFromMidiData([0x90, 60, 0])).toBeNull();
    expect(noteOnFromMidiData([0x90, 128, 100])).toBeNull();
  });

  it("distinguishes connected inputs from granted access without devices", () => {
    expect(describeMidiInputs([])).toEqual({ status: "no-devices", deviceNames: [] });
    expect(describeMidiInputs([{ id: "piano", name: "Digital Piano" }])).toEqual({
      status: "connected",
      deviceNames: ["Digital Piano"]
    });
  });

  it("provides a stable fallback for unnamed devices", () => {
    expect(describeMidiInputs([{ id: "7", name: null }]).deviceNames).toEqual(["MIDI 7"]);
  });

  it("explicitly opens an input before forwarding note-on messages", async () => {
    const open = vi.fn(async () => undefined);
    const input = { open, onmidimessage: null } as unknown as MIDIInput;
    const onNote = vi.fn();

    await openMidiInput(input, onNote);
    expect(open).toHaveBeenCalledOnce();
    input.onmidimessage?.({ data: new Uint8Array([0x92, 64, 90]) } as MIDIMessageEvent);
    expect(onNote).toHaveBeenCalledWith(64);
  });
});
