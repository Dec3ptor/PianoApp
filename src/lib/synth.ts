import { Piano } from "@tonejs/piano/build/piano/Piano";
import * as Tone from "tone";

type ActiveNoteInstance =
  | { id: number; source: "sample" }
  | { id: number; source: "fallback"; osc: OscillatorNode; gain: GainNode };

export class SimpleSynth {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private compressor: DynamicsCompressorNode;
  private activeNotes: Map<number, Set<ActiveNoteInstance>> = new Map();
  private instanceIdCount = 0;
  private piano: Piano | null = null;
  private pianoLoaded = false;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.12;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // Detect low-power device so we load fewer sample layers and cap voices.
    // Loading 4 velocity layers x 88 keys is ~ 350 MP3 decodes and a lot of
    // memory; on an iPad this alone causes audible audio dropouts plus UI lag.
    const isLowPower = (() => {
      try {
        const ua = navigator.userAgent || "";
        if (/iPad|iPhone|iPod|Android/.test(ua)) return true;
        if (
          navigator.platform === "MacIntel" &&
          (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1
        )
          return true;
        if (window.matchMedia("(pointer: coarse)").matches) return true;
      } catch {
        /* no-op */
      }
      return false;
    })();

    try {
      this.piano = new Piano({
        velocities: isLowPower ? 1 : 4,
        maxPolyphony: isLowPower ? 24 : 96,
        release: !isLowPower,
        pedal: false,
        volume: {
          strings: -1,
          pedal: -12,
          keybed: -16,
          harmonics: -10,
        },
      }).toDestination();

      void this.piano
        .load()
        .then(() => {
          this.pianoLoaded = true;
        })
        .catch((error) => {
          console.error("Piano samples failed to load, using fallback synth.", error);
        });
    } catch (error) {
      console.error("Failed to initialize sampled piano, using fallback synth.", error);
      this.piano = null;
    }
  }

  private ensureAudioStarted() {
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    void Tone.start();
  }

  public warmUp() {
    this.ensureAudioStarted();
  }

  private rememberActiveNote(midiNote: number, instance: ActiveNoteInstance) {
    if (!this.activeNotes.has(midiNote)) {
      this.activeNotes.set(midiNote, new Set());
    }
    this.activeNotes.get(midiNote)!.add(instance);
  }

  private playFallbackNote(midiNote: number, id: number) {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.03);
    gain.gain.setTargetAtTime(0.001, this.ctx.currentTime + 0.03, 1.0);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();

    const instance: ActiveNoteInstance = { id, source: "fallback", osc, gain };
    this.rememberActiveNote(midiNote, instance);
  }

  public playNote(midiNote: number, velocity = 0.82): number {
    const id = ++this.instanceIdCount;
    this.ensureAudioStarted();

    if (this.piano && this.pianoLoaded) {
      // @tonejs/piano's keyDown silently no-ops when the note is already in
      // its internal _heldNotes map. Force a keyUp first so a re-strike of
      // the same midi (very common in arpeggios / chord repeats) reliably
      // triggers a new attack instead of being dropped.
      this.piano.keyUp({ midi: midiNote });
      this.piano.keyDown({ midi: midiNote, velocity });
      this.rememberActiveNote(midiNote, { id, source: "sample" });
      return id;
    }

    this.playFallbackNote(midiNote, id);
    return id;
  }

  /**
   * Schedules a note attack and release on the audio clock.
   * Use this for sequenced playback - it avoids setTimeout jitter and
   * guarantees keyUp ordering, so simultaneous / repeated notes are not
   * dropped by @tonejs/piano's _heldNotes guard.
   */
  public triggerNote(midiNote: number, durationSeconds: number, velocity = 0.82) {
    this.ensureAudioStarted();

    if (this.piano && this.pianoLoaded) {
      const now = Tone.now();
      // Clear any stale held state for this midi before the new attack.
      this.piano.keyUp({ midi: midiNote, time: now });
      this.piano.keyDown({ midi: midiNote, velocity, time: now + 0.002 });
      // Release slightly before the nominal next start so a repeat always wins.
      const release = now + 0.002 + Math.max(durationSeconds - 0.01, 0.05);
      this.piano.keyUp({ midi: midiNote, time: release });
      return;
    }

    // Fallback synth path
    const id = ++this.instanceIdCount;
    this.playFallbackNote(midiNote, id);
    setTimeout(() => this.stopNote(midiNote, id), Math.max(durationSeconds, 0.05) * 1000);
  }

  public stopNote(midiNote: number, id?: number) {
    const notes = this.activeNotes.get(midiNote);
    if (!notes) return;

    let releasedSample = false;

    for (const note of Array.from(notes)) {
      if (id !== undefined && note.id !== id) continue;

      if (note.source === "sample") {
        releasedSample = true;
        notes.delete(note);
        continue;
      }

      note.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      note.gain.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.03);
      note.osc.stop(this.ctx.currentTime + 0.2);
      notes.delete(note);
    }

    if (releasedSample && !Array.from(notes).some((note) => note.source === "sample")) {
      this.piano?.keyUp({ midi: midiNote });
    }

    if (notes.size === 0) {
      this.activeNotes.delete(midiNote);
    }
  }
}

let synthInstance: SimpleSynth | null = null;

export function getSynth() {
  if (!synthInstance) {
    try {
      synthInstance = new SimpleSynth();
    } catch (e) {
      console.error("Audio Context not supported or failed", e);
    }
  }
  return synthInstance;
}
