import { useCallback, useEffect, useRef, useState } from "react";

export type MidiStatus = "unsupported" | "idle" | "connecting" | "connected" | "no-devices" | "denied" | "error";

interface MidiInputDescription {
  id: string;
  name: string | null;
}

export interface MidiOutputDescription {
  id: string;
  name: string;
}

export function noteOnFromMidiData(data: ArrayLike<number>): number | null {
  const statusByte = data[0] ?? 0;
  const midi = data[1];
  const velocity = data[2] ?? 0;
  if ((statusByte & 0xf0) !== 0x90 || velocity <= 0 || midi === undefined || midi < 0 || midi > 127) {
    return null;
  }
  return midi;
}

export function describeMidiInputs(inputs: Iterable<MidiInputDescription>): {
  status: "connected" | "no-devices";
  deviceNames: string[];
} {
  const values = [...inputs];
  return {
    status: values.length > 0 ? "connected" : "no-devices",
    deviceNames: values.map((input) => input.name ?? `MIDI ${input.id}`)
  };
}

export async function openMidiInput(input: MIDIInput, onNote: (midi: number) => void): Promise<void> {
  await input.open();
  input.onmidimessage = (event) => {
    const data = event.data;
    if (!data) return;
    const midi = noteOnFromMidiData(data);
    if (midi !== null) onNote(midi);
  };
}

export function useMidi(onNote: (midi: number) => void) {
  const [status, setStatus] = useState<MidiStatus>(
    typeof navigator.requestMIDIAccess === "function" ? "idle" : "unsupported"
  );
  const [deviceNames, setDeviceNames] = useState<string[]>([]);
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [outputs, setOutputs] = useState<MidiOutputDescription[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const accessRef = useRef<MIDIAccess | null>(null);
  const outputsRef = useRef(new Map<string, MIDIOutput>());
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;

  const bindInputs = useCallback(async (access: MIDIAccess) => {
    const inputs = [...access.inputs.values()];
    const description = describeMidiInputs(inputs);
    setDeviceNames(description.deviceNames);
    setErrorMessage("");
    let openedInputs = 0;
    const openedOutputs: MidiOutputDescription[] = [];
    outputsRef.current.clear();
    for (const output of access.outputs.values()) {
      try {
        await output.open();
        outputsRef.current.set(output.id, output);
        openedOutputs.push({ id: output.id, name: output.name ?? `MIDI ${output.id}` });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть MIDI-выход");
      }
    }
    setOutputs(openedOutputs);
    setSelectedOutputId((current) => openedOutputs.some(({ id }) => id === current) ? current : openedOutputs[0]?.id ?? null);
    if (inputs.length === 0) {
      setStatus("no-devices");
      return;
    }
    for (const input of inputs) {
      try {
        // Firefox requires an explicit open() for some USB/Bluetooth devices;
        // Chrome normally opens implicitly when the handler is assigned.
        await openMidiInput(input, (midi) => {
          setLastNote(midi);
          onNoteRef.current(midi);
        });
        openedInputs += 1;
      } catch (error) {
        input.onmidimessage = null;
        setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть MIDI-вход");
      }
    }
    setStatus(openedInputs > 0 ? "connected" : "error");
  }, []);

  const connect = useCallback(async () => {
    const request = navigator.requestMIDIAccess;
    if (!request) {
      setStatus("unsupported");
      return;
    }
    setStatus("connecting");
    try {
      const access = await request.call(navigator, { sysex: false });
      accessRef.current = access;
      await bindInputs(access);
      access.onstatechange = () => { void bindInputs(access); };
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Браузер отклонил доступ к MIDI");
      setStatus("denied");
    }
  }, [bindInputs]);

  useEffect(() => () => {
    const access = accessRef.current;
    if (!access) return;
    access.onstatechange = null;
    for (const input of access.inputs.values()) {
      input.onmidimessage = null;
    }
    for (const output of access.outputs.values()) {
      void output.close();
    }
  }, []);

  return {
    status,
    deviceNames,
    lastNote,
    errorMessage,
    outputs,
    selectedOutputId,
    selectedOutput: selectedOutputId === null ? null : outputsRef.current.get(selectedOutputId) ?? null,
    selectOutput: setSelectedOutputId,
    connect
  };
}
