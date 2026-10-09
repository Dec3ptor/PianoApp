import { useState, useEffect, useRef } from "react";
import { getPolyphonicNotes } from "../lib/audioUtils";
import { setAudioSessionType } from "../lib/audioContext";

// Keep a detected note "on" this long after it was last heard, so it doesn't
// flicker when it drops out for a frame or two (anti-jitter).
const HOLD_MS = 80;

export function usePitchDetector() {
  const [midiNotes, setMidiNotes] = useState<number[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef<Float32Array | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const lastHeardRef = useRef<Map<number, number>>(new Map());

  const startListening = async () => {
    if (streamRef.current) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      setError("Microphone access needs a secure (HTTPS) connection and a supported browser.");
      return;
    }
    try {
      // iOS: capture needs the play-and-record audio session.
      setAudioSessionType("play-and-record");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });
      streamRef.current = stream;

      const audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      // Use 16384 for great frequency resolution, crucial for polyphonic FFT
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0.5; // Smooths rapid jumps
      analyserRef.current = analyser;
      // Reused every frame instead of allocating 32 KB per frame.
      bufferRef.current = new Float32Array(analyser.frequencyBinCount);

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsListening(true);
      setError(null);
      detectPitchLoop();
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      setAudioSessionType("playback");
      setError(err.message || "Microphone access denied");
    }
  };

  const stopListening = () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = undefined;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
    setAudioSessionType("playback");
    setIsListening(false);
    setMidiNotes([]);
    lastHeardRef.current.clear();
  };

  const detectPitchLoop = () => {
    const analyser = analyserRef.current;
    const ctx = audioContextRef.current;
    const buffer = bufferRef.current;
    if (!analyser || !ctx || !buffer) return;

    const detected = getPolyphonicNotes(analyser, ctx.sampleRate, buffer);

    const now = performance.now();
    const lastHeard = lastHeardRef.current;
    for (const midi of detected) lastHeard.set(midi, now);
    lastHeard.forEach((t, midi) => {
      if (now - t > HOLD_MS) lastHeard.delete(midi);
    });

    const finalActive = Array.from(lastHeard.keys()).sort((a, b) => a - b);

    setMidiNotes((prev) => {
      // Only trigger state update if notes actually changed
      if (
        prev.length === finalActive.length &&
        prev.every((v, i) => v === finalActive[i])
      ) {
        return prev;
      }
      return finalActive;
    });

    requestRef.current = requestAnimationFrame(detectPitchLoop);
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  return { midiNotes, isListening, startListening, stopListening, error };
}
