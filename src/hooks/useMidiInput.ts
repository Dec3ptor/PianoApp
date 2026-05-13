import { useState, useEffect, useRef } from "react";

export function useMidiInput() {
  const [midiNotes, setMidiNotes] = useState<number[]>([]);
  const [deviceNames, setDeviceNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const activeNotesRef = useRef<Set<number>>(new Set());
  const accessRef = useRef<MIDIAccess | null>(null);

  useEffect(() => {
    // Guard 1: API must exist and be a real function.
    if (
      typeof navigator === "undefined" ||
      typeof navigator.requestMIDIAccess !== "function"
    ) {
      setSupported(false);
      setError("Web MIDI API not supported in this browser.");
      return;
    }

    let cancelled = false;

    const handleMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 2) return;
      const status = data[0] & 0xf0;
      const note = data[1];
      const velocity = data.length > 2 ? data[2] : 0;

      const set = activeNotesRef.current;
      let changed = false;

      if (status === 0x90 && velocity > 0) {
        if (!set.has(note)) {
          set.add(note);
          changed = true;
        }
      } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
        if (set.has(note)) {
          set.delete(note);
          changed = true;
        }
      }

      if (changed) {
        setMidiNotes(Array.from(set).sort((a, b) => a - b));
      }
    };

    const attachInputs = (access: MIDIAccess) => {
      const names: string[] = [];
      access.inputs.forEach((input) => {
        names.push(input.name || "MIDI Input");
        input.onmidimessage = handleMessage;
      });
      setDeviceNames(names);
    };

    try {
      // Guard 2: some shims (e.g. old "Web MIDI Browser" on iOS) expose
      // requestMIDIAccess as a function but return undefined instead of a
      // Promise. Checking for a thenable before calling .then prevents a
      // crash that would bring the whole React tree down.
      const result = navigator.requestMIDIAccess({ sysex: false });
      if (!result || typeof (result as unknown as { then?: unknown }).then !== "function") {
        setSupported(false);
        setError("MIDI API is not functional in this browser.");
        return;
      }
      result
        .then((access) => {
          if (cancelled) return;
          accessRef.current = access;
          attachInputs(access);
          access.onstatechange = () => {
            if (!cancelled) attachInputs(access);
          };
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg || "Failed to access MIDI devices.");
        });
    } catch (err: unknown) {
      // Guard 3: catch any synchronous throw from the shim.
      const msg = err instanceof Error ? err.message : String(err);
      setSupported(false);
      setError("MIDI setup error: " + msg);
    }

    return () => {
      cancelled = true;
      const access = accessRef.current;
      if (access) {
        access.inputs.forEach((i) => {
          i.onmidimessage = null;
        });
        access.onstatechange = null;
      }
    };
  }, []);

  const isConnected = deviceNames.length > 0;

  return { midiNotes, isConnected, deviceNames, error, supported };
}
