import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeMidiInputs,
  midiRequestErrorStatus,
  noteOnFromMidiData,
  openMidiInput,
  replaceMidiInputBindings,
  useMidi
} from "./useMidi.js";

const hookHarness = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  setters: [] as ReturnType<typeof vi.fn>[]
}));

vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (setup: () => void | (() => void)) => { hookHarness.cleanup = setup() ?? undefined; },
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: <T>(initial: T) => {
    const setter = vi.fn();
    hookHarness.setters.push(setter);
    return [initial, setter];
  }
}));

function mockMidiInput(
  id: string,
  open: () => Promise<MIDIPort> = vi.fn(async () => undefined as unknown as MIDIPort)
): MIDIInput {
  return {
    id,
    name: id,
    state: "connected",
    open,
    close: vi.fn(async () => undefined),
    onmidimessage: null
  } as unknown as MIDIInput;
}

beforeEach(() => {
  hookHarness.cleanup = undefined;
  hookHarness.setters = [];
});

afterEach(() => {
  hookHarness.cleanup?.();
  vi.unstubAllGlobals();
});

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
    let current = true;
    const input = {
      id: "late",
      state: "connected",
      open: vi.fn(async () => {
        current = false;
        return undefined;
      }),
      close,
      onmidimessage: null
    } as unknown as MIDIInput;
    const bindings = new Map<string, MIDIInput>();

    const result = await replaceMidiInputBindings([input], "late", bindings, vi.fn(), () => current);

    expect(close).toHaveBeenCalledOnce();
    expect(input.onmidimessage).toBeNull();
    expect(bindings).toHaveLength(0);
    expect(result.opened).toBe(0);
  });

  it("does not detach or open ports when a queued binding is already stale", async () => {
    const existing = {
      id: "existing",
      state: "connected",
      close: vi.fn(async () => undefined),
      onmidimessage: vi.fn()
    } as unknown as MIDIInput;
    const candidate = {
      id: "candidate",
      state: "connected",
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onmidimessage: null
    } as unknown as MIDIInput;
    const bindings = new Map([["existing", existing]]);

    const result = await replaceMidiInputBindings([candidate], "candidate", bindings, vi.fn(), () => false);

    expect(existing.close).not.toHaveBeenCalled();
    expect(candidate.open).not.toHaveBeenCalled();
    expect(bindings.get("existing")).toBe(existing);
    expect(result).toEqual({ opened: 0, error: null });
  });

  it("closes a hotplug input whose open rejects and reports the error", async () => {
    const error = new Error("device vanished");
    const input = {
      id: "vanished",
      state: "connected",
      open: vi.fn(async () => { throw error; }),
      close: vi.fn(async () => undefined),
      onmidimessage: null
    } as unknown as MIDIInput;
    const bindings = new Map<string, MIDIInput>();

    const result = await replaceMidiInputBindings([input], "vanished", bindings, vi.fn());

    expect(input.close).toHaveBeenCalledOnce();
    expect(input.onmidimessage).toBeNull();
    expect(bindings).toHaveLength(0);
    expect(result).toEqual({ opened: 0, error });
  });

  it("clears lastNote on explicit input switch and hotplug fallback", async () => {
    const first = mockMidiInput("first");
    const second = mockMidiInput("second");
    const inputMap = new Map([[first.id, first], [second.id, second]]);
    const access = {
      inputs: inputMap,
      outputs: new Map(),
      onstatechange: null
    } as unknown as MIDIAccess;
    vi.stubGlobal("navigator", { requestMIDIAccess: vi.fn(async () => access) });
    const midi = useMidi(vi.fn());

    await midi.connect();
    const setLastNote = hookHarness.setters[2]!;
    setLastNote.mockClear();

    midi.selectInput("first");
    expect(setLastNote).not.toHaveBeenCalled();
    midi.selectInput("second");
    expect(setLastNote).toHaveBeenCalledWith(null);
    await vi.waitFor(() => expect(second.open).toHaveBeenCalledOnce());
    setLastNote.mockClear();

    inputMap.delete("second");
    access.onstatechange?.({ port: second } as unknown as MIDIConnectionEvent);
    await vi.waitFor(() => expect(setLastNote).toHaveBeenCalledWith(null));

  });

  it("does not mutate state or open a queued hotplug port after unmount", async () => {
    let finishOpen: (() => void) | undefined;
    const blockedOpen = vi.fn(() => new Promise<MIDIPort>((resolve) => {
      finishOpen = () => resolve(undefined as unknown as MIDIPort);
    }));
    const first = mockMidiInput("first", blockedOpen);
    const second = mockMidiInput("second");
    const inputMap = new Map([[first.id, first]]);
    const access = {
      inputs: inputMap,
      outputs: new Map(),
      onstatechange: null
    } as unknown as MIDIAccess;
    vi.stubGlobal("navigator", { requestMIDIAccess: vi.fn(async () => access) });
    const midi = useMidi(vi.fn());

    const connecting = midi.connect();
    await vi.waitFor(() => expect(blockedOpen).toHaveBeenCalledOnce());
    inputMap.set(second.id, second);
    access.onstatechange?.({ port: second } as unknown as MIDIConnectionEvent);
    hookHarness.cleanup?.();
    for (const setter of hookHarness.setters) setter.mockClear();
    finishOpen?.();
    await connecting;
    await Promise.resolve();

    expect(second.open).not.toHaveBeenCalled();
    for (const setter of hookHarness.setters) expect(setter).not.toHaveBeenCalled();
  });
});
