import { describe, expect, it, vi } from "vitest";
import {
  describeMidiInputs,
  midiRequestErrorStatus,
  noteOnFromMidiData,
  openMidiInput,
  replaceMidiInputBindings
} from "./useMidi.js";

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

  it("distinguishes permission rejection from operational access errors", () => {
    expect(midiRequestErrorStatus(new DOMException("blocked", "NotAllowedError"))).toBe("denied");
    expect(midiRequestErrorStatus(new Error("adapter failed"))).toBe("error");
  });

  it("filters disconnected devices from the visible input list", () => {
    expect(describeMidiInputs([
      { id: "gone", name: "Old keyboard", state: "disconnected" },
      { id: "live", name: "Live keyboard", state: "connected" }
    ])).toEqual({ status: "connected", deviceNames: ["Live keyboard"] });
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

  it("detaches and closes an obsolete input before binding the selection", async () => {
    const oldClose = vi.fn(async () => undefined);
    const oldInput = { id: "old", state: "disconnected", close: oldClose, onmidimessage: vi.fn() } as unknown as MIDIInput;
    const newOpen = vi.fn(async () => undefined);
    const newInput = {
      id: "new",
      state: "connected",
      open: newOpen,
      close: vi.fn(async () => undefined),
      onmidimessage: null
    } as unknown as MIDIInput;
    const bindings = new Map([["old", oldInput]]);

    const result = await replaceMidiInputBindings([oldInput, newInput], "new", bindings, vi.fn());

    expect(oldInput.onmidimessage).toBeNull();
    expect(oldClose).toHaveBeenCalledOnce();
    expect(newOpen).toHaveBeenCalledOnce();
    expect(bindings.get("new")).toBe(newInput);
    expect(result).toEqual({ opened: 1, error: null });
  });

  it("closes an input whose async open completes after its generation is obsolete", async () => {
    const close = vi.fn(async () => undefined);
    const input = {
      id: "late",
      state: "connected",
      open: vi.fn(async () => undefined),
      close,
      onmidimessage: null
    } as unknown as MIDIInput;
    const bindings = new Map<string, MIDIInput>();

    const result = await replaceMidiInputBindings([input], "late", bindings, vi.fn(), () => false);

    expect(close).toHaveBeenCalledOnce();
    expect(input.onmidimessage).toBeNull();
    expect(bindings).toHaveLength(0);
    expect(result.opened).toBe(0);
  });
});
