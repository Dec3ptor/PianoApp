import { freqToMidi } from "./audioUtils";

export class SimpleSynth {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private compressor: DynamicsCompressorNode;
  private activeNotes: Map<number, Set<{ osc: OscillatorNode; gain: GainNode; id: number }>> = new Map();
  private instanceIdCount = 0;

  constructor() {
    this.ctx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
    
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8; // We'll lower individual note gains instead

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.1;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
  }

  public playNote(midiNote: number): number {
    const id = ++this.instanceIdCount;

    // Midi to freq
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle"; // piano-ish mellow tone placeholder
    osc.frequency.value = freq;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    // Lower individual note volume to prevent summing distortion
    gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.03);
    gain.gain.setTargetAtTime(0.001, this.ctx.currentTime + 0.03, 1.0);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();

    if (!this.activeNotes.has(midiNote)) {
      this.activeNotes.set(midiNote, new Set());
    }
    this.activeNotes.get(midiNote)!.add({ osc, gain, id });
    
    return id;
  }

  public stopNote(midiNote: number, id?: number) {
    const notes = this.activeNotes.get(midiNote);
    if (!notes) return;

    for (const note of notes) {
      if (id === undefined || note.id === id) {
        note.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        // setTargetAtTime avoids click sounds from reading an incorrect value property during ramp
        note.gain.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.03);

        note.osc.stop(this.ctx.currentTime + 0.2);

        notes.delete(note);
      }
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
