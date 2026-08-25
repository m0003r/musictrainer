import { useCallback, useEffect, useRef, useState } from "react";

export type MidiStatus = "unsupported" | "idle" | "connecting" | "connected" | "no-devices" | "denied" | "error";

export interface MidiInputDescription {
  id: string;
  name: string | null;
  state?: MIDIPortDeviceState;
}

export interface MidiOutputDescription {
  id: string;
  name: string;
}

type BoundMidiInput = Pick<MIDIInput, "id" | "open" | "close" | "onmidimessage">;

function isConnected(port: { state?: MIDIPortDeviceState }): boolean {
  return port.state === undefined || port.state === "connected";
}

export async function closeMidiInput(input: BoundMidiInput): Promise<void> {
  input.onmidimessage = null;
  try {
    await input.close();
  } catch {
    // A port can disappear between the state event and close(). It is already detached.
  }
}

export async function replaceMidiInputBindings(
  inputs: Iterable<MIDIInput>,
  selectedInputId: string | null,
  boundInputs: Map<string, MIDIInput>,
  onNote: (midi: number) => void,
  isCurrent: () => boolean = () => true
): Promise<{ opened: number; error: unknown | null }> {
  const selected = [...inputs].find((input) => isConnected(input) && input.id === selectedInputId);

  for (const [id, input] of boundInputs) {
    if (id !== selected?.id) {
      boundInputs.delete(id);
      await closeMidiInput(input);
    }
  }
  if (!selected) return { opened: 0, error: null };
  if (boundInputs.has(selected.id)) return { opened: 1, error: null };

  try {
    await openMidiInput(selected, onNote);
    if (!isCurrent() || !isConnected(selected)) {
      await closeMidiInput(selected);
      return { opened: 0, error: null };
    }
    boundInputs.set(selected.id, selected);
    return { opened: 1, error: null };
  } catch (error) {
    await closeMidiInput(selected);
    return { opened: 0, error };
  }
}

export function midiRequestErrorStatus(error: unknown): Extract<MidiStatus, "denied" | "error"> {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
    ? "denied"
    : "error";
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
  const values = [...inputs].filter(isConnected);
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
  const [inputs, setInputs] = useState<MidiInputDescription[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);
  const accessRef = useRef<MIDIAccess | null>(null);
  const inputsRef = useRef(new Map<string, MIDIInput>());
  const outputsRef = useRef(new Map<string, MIDIOutput>());
  const selectedInputIdRef = useRef<string | null>(null);
  const bindGenerationRef = useRef(0);
  const connectGenerationRef = useRef(0);
  const bindQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;

  const bindInputs = useCallback(async (access: MIDIAccess) => {
    const generation = ++bindGenerationRef.current;
    const availableInputs = [...access.inputs.values()].filter(isConnected);
    const description = describeMidiInputs(availableInputs);
    const inputDescriptions = availableInputs.map(({ id, name, state }) => ({ id, name, state }));
    const selectedId = availableInputs.some(({ id }) => id === selectedInputIdRef.current)
      ? selectedInputIdRef.current
      : availableInputs[0]?.id ?? null;
    selectedInputIdRef.current = selectedId;
    setInputs(inputDescriptions);
    setSelectedInputId(selectedId);
    setDeviceNames(description.deviceNames);
    setErrorMessage("");
    const binding = await replaceMidiInputBindings(
      availableInputs,
      selectedId,
      inputsRef.current,
      (midi) => {
        if (!mountedRef.current) return;
        setLastNote(midi);
        onNoteRef.current(midi);
      },
      () => mountedRef.current && generation === bindGenerationRef.current
    );
    if (!mountedRef.current || generation !== bindGenerationRef.current) return;

    const openedOutputs: MidiOutputDescription[] = [];
    const availableOutputs = [...access.outputs.values()].filter(isConnected);
    const availableOutputIds = new Set(availableOutputs.map(({ id }) => id));
    for (const [id, output] of outputsRef.current) {
      if (!availableOutputIds.has(id)) {
        outputsRef.current.delete(id);
        try { await output.close(); } catch { /* Device removal makes close best-effort. */ }
      }
    }
    let outputError: unknown | null = null;
    for (const output of availableOutputs) {
      try {
        if (!outputsRef.current.has(output.id)) await output.open();
        if (!mountedRef.current || generation !== bindGenerationRef.current || !isConnected(output)) {
          try { await output.close(); } catch { /* Best-effort stale-port cleanup. */ }
          continue;
        }
        outputsRef.current.set(output.id, output);
        openedOutputs.push({ id: output.id, name: output.name ?? `MIDI ${output.id}` });
      } catch (error) {
        outputError ??= error;
      }
    }
    if (!mountedRef.current || generation !== bindGenerationRef.current) return;
    setOutputs(openedOutputs);
    setSelectedOutputId((current) => openedOutputs.some(({ id }) => id === current) ? current : openedOutputs[0]?.id ?? null);
    const openError = binding.error ?? outputError;
    if (openError) {
      const target = binding.error ? "вход" : "выход";
      setErrorMessage(openError instanceof Error ? `Не удалось открыть MIDI-${target}: ${openError.message}` : `Не удалось открыть MIDI-${target}`);
    }
    if (availableInputs.length === 0) {
      setStatus("no-devices");
      return;
    }
    setStatus(binding.opened > 0 ? "connected" : "error");
  }, []);

  const queueBind = useCallback((access: MIDIAccess) => {
    bindQueueRef.current = bindQueueRef.current.catch(() => undefined).then(() => bindInputs(access));
    return bindQueueRef.current;
  }, [bindInputs]);

  const connect = useCallback(async () => {
    const request = navigator.requestMIDIAccess;
    if (!request) {
      setStatus("unsupported");
      return;
    }
    setStatus("connecting");
    const generation = ++connectGenerationRef.current;
    try {
      const access = await request.call(navigator, { sysex: false });
      if (!mountedRef.current || generation !== connectGenerationRef.current) return;
      const previousAccess = accessRef.current;
      if (previousAccess && previousAccess !== access) previousAccess.onstatechange = null;
      accessRef.current = access;
      access.onstatechange = () => { void queueBind(access); };
      await queueBind(access);
    } catch (error) {
      if (!mountedRef.current || generation !== connectGenerationRef.current) return;
      const failureStatus = midiRequestErrorStatus(error);
      setErrorMessage(error instanceof Error ? error.message : failureStatus === "denied" ? "Браузер отклонил доступ к MIDI" : "Не удалось подключить MIDI");
      setStatus(failureStatus);
    }
  }, [queueBind]);

  const selectInput = useCallback((id: string | null) => {
    selectedInputIdRef.current = id;
    setSelectedInputId(id);
    if (accessRef.current) void queueBind(accessRef.current);
  }, [queueBind]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectGenerationRef.current += 1;
      bindGenerationRef.current += 1;
      const access = accessRef.current;
      if (access) access.onstatechange = null;
      for (const input of inputsRef.current.values()) void closeMidiInput(input);
      inputsRef.current.clear();
      for (const output of outputsRef.current.values()) void output.close().catch(() => undefined);
      outputsRef.current.clear();
    };
  }, []);

  return {
    status,
    deviceNames,
    lastNote,
    errorMessage,
    inputs,
    selectedInputId,
    selectedInput: selectedInputId === null ? null : inputs.find(({ id }) => id === selectedInputId) ?? null,
    selectInput,
    outputs,
    selectedOutputId,
    selectedOutput: selectedOutputId === null ? null : outputsRef.current.get(selectedOutputId) ?? null,
    selectOutput: setSelectedOutputId,
    connect
  };
}
