import { useState, useEffect, useRef } from "react";
import { getPolyphonicNotes } from "../lib/audioUtils";

export function usePitchDetector() {
  const [midiNotes, setMidiNotes] = useState<number[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<number>();
  const activeNotesHistory = useRef<Map<number, number>>(new Map());

  const startListening = async () => {
    try {
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

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsListening(true);
      setError(null);
      detectPitchLoop();
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      setError(err.message || "Microphone access denied");
    }
  };

  const stopListening = () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsListening(false);
    setMidiNotes([]);
    activeNotesHistory.current.clear();
  };

  const detectPitchLoop = () => {
    if (!analyserRef.current || !audioContextRef.current) return;

    const detected = getPolyphonicNotes(
      analyserRef.current,
      audioContextRef.current.sampleRate,
    );

    // Frame holding logic (anti-jitter)
    // We hold a detected note for a few frames even if it drops out momentarily
    const currentFrameNotes = new Set(detected);
    const newHistory = new Map<number, number>();
    const framesToHold = 5;

    for (const [midi, frames] of activeNotesHistory.current.entries()) {
      if (currentFrameNotes.has(midi)) {
        newHistory.set(midi, framesToHold);
      } else if (frames > 1) {
        newHistory.set(midi, frames - 1);
      }
    }

    for (const midi of detected) {
      if (!newHistory.has(midi)) {
        newHistory.set(midi, framesToHold);
      }
    }

    activeNotesHistory.current = newHistory;

    const finalActive = Array.from(newHistory.keys()).sort((a, b) => a - b);

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
