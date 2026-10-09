import { useState, useEffect, useRef, useCallback } from "react";

/** Web MIDI connection state. */
export type MidiStatus =
  | "unsupported" // no Web MIDI in this browser (e.g. Safari)
  | "idle" // not connected yet; connecting needs a click
  | "connecting"
  | "ready" // access granted (there may still be no device plugged in)
  | "blocked"; // the browser refused access

// Set once MIDI has connected on this device, so later visits reconnect
// without a click even where the permission state can't be read.
const REMEMBER_KEY = "pianoapp.midiEnabled";

function midiAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
}

/** "unknown" where the browser can't report MIDI permission (e.g. iOS Web MIDI browsers). */
async function queryMidiPermission(): Promise<{ state: PermissionState | "unknown"; status: PermissionStatus | null }> {
  try {
    if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
      return { state: "unknown", status: null };
    }
    const status = await navigator.permissions.query({ name: "midi" as PermissionName });
    return { state: status.state, status };
  } catch {
    return { state: "unknown", status: null };
  }
}

function describeMidiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || "");
  // Firefox rejects with "WebMIDI requires a site permission add-on to activate"
  // whenever it doesn't grant access, including when no device is plugged in.
  if (/firefox/i.test(navigator.userAgent) || /site permission add-on/i.test(message)) {
    return (
      'Firefox only allows MIDI through a one-time "site permission add-on", and only offers it ' +
      "while a MIDI device is connected. Plug in your keyboard (restart Firefox if you just " +
      'connected it), click Connect MIDI, then choose "Continue to Installation" and "Add".'
    );
  }
  const name = err && typeof err === "object" ? (err as { name?: string }).name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "MIDI access was blocked. Allow MIDI devices for this site in the browser's site settings, then click Connect MIDI again.";
  }
  return message || "Failed to access MIDI devices.";
}

export function useMidiInput() {
  const [midiNotes, setMidiNotes] = useState<number[]>([]);
  const [deviceNames, setDeviceNames] = useState<string[]>([]);
  const [status, setStatus] = useState<MidiStatus>(() => (midiAvailable() ? "idle" : "unsupported"));
  const [error, setError] = useState<string | null>(null);

  const activeNotesRef = useRef<Set<number>>(new Set());
  const accessRef = useRef<MIDIAccess | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);

  const handleMessage = useCallback((event: MIDIMessageEvent) => {
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
  }, []);

  const attachInputs = useCallback(
    (access: MIDIAccess) => {
      const names: string[] = [];
      access.inputs.forEach((input) => {
        input.onmidimessage = handleMessage;
        // Unplugged ports can stay in the map with state "disconnected".
        if (input.state !== "disconnected") names.push(input.name || "MIDI Input");
      });
      setDeviceNames(names);
    },
    [handleMessage],
  );

  /**
   * Requests MIDI access. Firefox only offers its site permission add-on, and
   * Chrome only prompts, in response to the user, so a refused automatic
   * attempt just leaves the Connect button; the reason is shown only when the
   * user asked.
   */
  const requestAccess = useCallback(
    (userInitiated: boolean) => {
      if (!midiAvailable() || accessRef.current || pendingRef.current) return;
      let request: Promise<MIDIAccess> | undefined;
      try {
        request = navigator.requestMIDIAccess({ sysex: false });
      } catch (err: unknown) {
        // Some shims (e.g. old "Web MIDI Browser" on iOS) throw synchronously...
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("unsupported");
        setError("MIDI setup error: " + msg);
        return;
      }
      // ...or return undefined instead of a Promise.
      if (!request || typeof (request as unknown as { then?: unknown }).then !== "function") {
        setStatus("unsupported");
        setError("MIDI API is not functional in this browser.");
        return;
      }
      pendingRef.current = true;
      setStatus("connecting");
      request.then(
        (access) => {
          pendingRef.current = false;
          if (!mountedRef.current) return;
          accessRef.current = access;
          attachInputs(access);
          access.onstatechange = (e: Event) => {
            if (!mountedRef.current) return;
            const port = (e as MIDIConnectionEvent).port;
            // Notes held on a device that was just unplugged would never get
            // their note-off, so clear them.
            if (port && port.type === "input" && port.state === "disconnected" && activeNotesRef.current.size > 0) {
              activeNotesRef.current.clear();
              setMidiNotes([]);
            }
            attachInputs(access);
          };
          try {
            localStorage.setItem(REMEMBER_KEY, "1");
          } catch {
            /* no-op */
          }
          setStatus("ready");
          setError(null);
        },
        (err: unknown) => {
          pendingRef.current = false;
          if (!mountedRef.current) return;
          setStatus("blocked");
          if (userInitiated) setError(describeMidiError(err));
        },
      );
    },
    [attachInputs],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let permission: PermissionStatus | null = null;
    if (midiAvailable()) {
      let remembered = false;
      try {
        remembered = localStorage.getItem(REMEMBER_KEY) === "1";
      } catch {
        /* no-op */
      }
      // Connect straight away only when that can't pop up a prompt: access
      // already granted, MIDI used here before, or a browser that can't say
      // (the iOS Web MIDI browsers, which never prompt). Otherwise wait for
      // "Connect MIDI" rather than prompting everyone on page load.
      queryMidiPermission().then(({ state, status: permissionStatus }) => {
        if (cancelled) return;
        if (state === "denied") setStatus("blocked");
        else if (state === "granted" || state === "unknown" || remembered) requestAccess(false);
        if (permissionStatus) {
          permission = permissionStatus;
          // Granted later from the browser's site settings: connect then.
          permissionStatus.onchange = () => {
            if (permissionStatus.state === "granted") requestAccess(false);
          };
        }
      });
    }

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (permission) permission.onchange = null;
      const access = accessRef.current;
      accessRef.current = null;
      if (access) {
        access.inputs.forEach((i) => {
          i.onmidimessage = null;
        });
        access.onstatechange = null;
      }
    };
  }, [requestAccess]);

  const connect = useCallback(() => requestAccess(true), [requestAccess]);
  const dismissError = useCallback(() => setError(null), []);

  return {
    midiNotes,
    isConnected: deviceNames.length > 0,
    deviceNames,
    status,
    error,
    supported: status !== "unsupported",
    connect,
    dismissError,
  };
}
