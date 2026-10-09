import { audioClockNow, decodeAudio, getDecodeContext, outputLatency, unlockAudio } from "./audioContext";
import { isLowPowerDevice } from "./device";

/**
 * Salamander Grand Piano samples (Alexander Holm, CC-BY 3.0) - the same files
 * @tonejs/piano loads. There is one recording every minor third from A0 to C8,
 * so any key is at most one semitone away from a sample.
 */
const SAMPLE_BASE_URL = "https://tambien.github.io/Piano/audio/";
const SAMPLE_MIDIS: number[] = [];
for (let m = 21; m <= 108; m += 3) SAMPLE_MIDIS.push(m);
const FILE_NOTE_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"];
const CACHE_NAME = "piano-samples-v1";

const LOW_POWER = isLowPowerDevice();

// Playback and the on-screen keys always use the same velocity, so only one
// recorded velocity layer is ever heard; loading more just costs memory
// (~5 MB per decoded sample). These are the layer and gain @tonejs/piano
// picked for velocity 0.82 with the app's old settings, so each platform
// keeps its familiar tone.
const LAYER = LOW_POWER ? 8 : 15;
const LAYER_GAIN = LOW_POWER ? 0.82 : 0.77;
const DEFAULT_VELOCITY = 0.82;
// @tonejs/piano: sampler +3 dB, strings -1 dB.
const MASTER_GAIN = Math.pow(10, 2 / 20);

// Release envelope matching @tonejs/piano's 0.4 s exponential fade.
const RELEASE_TAU = Math.log(1.4) / Math.log(200);
const RELEASE_TAIL = 0.5;
const MAX_VOICES = LOW_POWER ? 32 : 64;
// While samples are still loading, borrow a neighbouring one up to this many
// semitones away before falling back to the oscillator.
const MAX_BORROW = 7;
const LOAD_CONCURRENCY = LOW_POWER ? 2 : 4;

function sampleUrl(midi: number): string {
  return `${SAMPLE_BASE_URL}${FILE_NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}v${LAYER}.mp3`;
}

function nearestSampleMidi(midi: number): number {
  const clamped = Math.min(108, Math.max(21, midi));
  return SAMPLE_MIDIS[Math.round((clamped - 21) / 3)];
}

/** Fetch with a Cache Storage layer so repeat visits (and offline use) skip the network. */
async function fetchSample(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    if (typeof caches !== "undefined") cache = await caches.open(CACHE_NAME);
  } catch {
    cache = null;
  }
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return await hit.arrayBuffer();
    } catch {
      /* fall through to the network */
    }
  }
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  if (cache) cache.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

/** Drops a cached file that turned out to be unusable, so the next attempt refetches it. */
function evictSample(url: string) {
  if (typeof caches === "undefined") return;
  caches.open(CACHE_NAME).then((c) => c.delete(url)).catch(() => {});
}

/** Downloads and decodes samples, a few at a time, in the order requested. */
class SampleBank {
  private buffers = new Map<number, AudioBuffer>();
  private requested = new Set<number>();
  private failedAt = new Map<number, number>();
  private queue: number[] = [];
  private active = 0;

  /** Queue the samples covering `midis`, in that order of priority. */
  preload(midis: Iterable<number>): void {
    for (const m of midis) this.request(nearestSampleMidi(m));
  }

  /** A sample to play `midi` with, and the playback rate that pitches it correctly. */
  get(midi: number): { buffer: AudioBuffer; rate: number } | null {
    const exact = nearestSampleMidi(midi);
    let src = this.buffers.has(exact) ? exact : -1;
    if (src < 0) {
      this.request(exact);
      for (let d = 3; d <= MAX_BORROW + 1 && src < 0; d += 3) {
        if (this.buffers.has(exact - d) && Math.abs(midi - (exact - d)) <= MAX_BORROW) src = exact - d;
        else if (this.buffers.has(exact + d) && Math.abs(midi - (exact + d)) <= MAX_BORROW) src = exact + d;
      }
      if (src < 0) return null;
    }
    return { buffer: this.buffers.get(src)!, rate: Math.pow(2, (midi - src) / 12) };
  }

  private request(sampleMidi: number) {
    if (this.requested.has(sampleMidi)) return;
    // Don't hammer the network while offline: retry a failed file at most every 10 s.
    const failed = this.failedAt.get(sampleMidi);
    if (failed !== undefined && Date.now() - failed < 10000) return;
    this.requested.add(sampleMidi);
    this.queue.push(sampleMidi);
    this.pump();
  }

  private pump() {
    while (this.active < LOAD_CONCURRENCY && this.queue.length > 0) {
      const sampleMidi = this.queue.shift()!;
      this.active++;
      fetchSample(sampleUrl(sampleMidi))
        .then((data) => {
          const decoder = getDecodeContext();
          if (!decoder) throw new Error("No audio context to decode with");
          return decodeAudio(decoder, data);
        })
        .then((buffer) => {
          this.buffers.set(sampleMidi, buffer);
          this.failedAt.delete(sampleMidi);
        })
        .catch((err) => {
          console.warn(`Piano sample ${sampleUrl(sampleMidi)} failed to load`, err);
          evictSample(sampleUrl(sampleMidi));
          this.requested.delete(sampleMidi);
          this.failedAt.set(sampleMidi, Date.now());
        })
        .then(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

interface Voice {
  midi: number;
  start: number;
  /** When the release begins; Infinity while a key is held. */
  end: number;
  sequenced: boolean;
  src: AudioScheduledSourceNode;
  gain: GainNode;
  released: boolean;
}

/**
 * A small sampler that plays the Salamander samples directly with Web Audio:
 * one buffer source and one gain node per note, all on a single context.
 * Notes can be scheduled ahead on the audio clock and cancelled again.
 */
export class PianoSynth {
  readonly ctx: AudioContext;
  private out: GainNode;
  private voices: Voice[] = [];
  private held = new Map<number, Voice[]>();

  constructor(ctx: AudioContext, private bank: SampleBank) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = MASTER_GAIN;
    this.out.connect(ctx.destination);
  }

  isRunning(): boolean {
    return this.ctx.state === "running";
  }

  /** Smoothed audio-clock time in seconds. */
  now(): number {
    return audioClockNow(this.ctx);
  }

  outputLatency(): number {
    return outputLatency(this.ctx);
  }

  /** Plays `midi` at audio time `when` for `duration` seconds (sequenced playback). */
  schedule(midi: number, when: number, duration: number, velocity = DEFAULT_VELOCITY): void {
    // Re-striking a key cuts off the previous note on that key, like a real piano
    // (and a duplicate note at the same time replaces the first instead of doubling it).
    for (const v of this.voices) {
      if (v.midi === midi && v.start <= when && v.end > when) this.release(v, when);
    }
    this.startVoice(midi, when, when + Math.max(duration, 0.05), velocity, true);
  }

  /** Starts a held note (on-screen keyboard). */
  noteOn(midi: number, velocity = DEFAULT_VELOCITY): void {
    unlockAudio();
    const when = this.ctx.currentTime;
    this.noteOff(midi, when);
    const v = this.startVoice(midi, when, Infinity, velocity, false);
    if (v) {
      const list = this.held.get(midi);
      if (list) list.push(v);
      else this.held.set(midi, [v]);
    }
  }

  noteOff(midi: number, when = this.ctx.currentTime): void {
    const list = this.held.get(midi);
    if (!list) return;
    this.held.delete(midi);
    for (const v of list) this.release(v, when);
  }

  /** Quickly silences sequenced notes, including ones scheduled in the future. */
  stopSequenced(): void {
    const when = this.ctx.currentTime;
    for (const v of this.voices) if (v.sequenced) this.release(v, when, 0.02);
  }

  /** Cancels sequenced notes that have not started by `when` (used when the tempo changes). */
  cancelSequencedAfter(when: number): void {
    for (const v of this.voices) if (v.sequenced && v.start > when) this.release(v, this.ctx.currentTime, 0.005);
  }

  private startVoice(midi: number, when: number, end: number, velocity: number, sequenced: boolean): Voice | null {
    const ctx = this.ctx;
    this.enforceVoiceLimit(when);
    const gain = ctx.createGain();
    // Silent until `when`, so a voice cancelled before it starts never sounds.
    gain.gain.value = 0;
    let src: AudioScheduledSourceNode;
    const sample = this.bank.get(midi);
    if (sample) {
      const level = (velocity / DEFAULT_VELOCITY) * LAYER_GAIN;
      const buf = ctx.createBufferSource();
      buf.buffer = sample.buffer;
      buf.playbackRate.value = sample.rate;
      gain.gain.setValueAtTime(level, when);
      src = buf;
    } else {
      // No sample loaded nearby yet: a soft triangle wave keeps playback audible.
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      const peak = 0.05 * (velocity / DEFAULT_VELOCITY);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + 0.03);
      gain.gain.setTargetAtTime(peak * 0.02, when + 0.03, 1.0);
      src = osc;
    }
    src.connect(gain);
    gain.connect(this.out);
    const voice: Voice = { midi, start: when, end: Infinity, sequenced, src, gain, released: false };
    src.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      try {
        gain.disconnect();
      } catch {
        /* no-op */
      }
    };
    try {
      src.start(when);
    } catch {
      gain.disconnect();
      return null;
    }
    this.voices.push(voice);
    if (end !== Infinity) this.release(voice, end);
    return voice;
  }

  private release(v: Voice, when: number, tau = RELEASE_TAU) {
    if (v.released && v.end <= when) return;
    v.released = true;
    v.end = when;
    const g = v.gain.gain;
    try {
      g.cancelScheduledValues(when);
      g.setTargetAtTime(0, when, tau);
    } catch {
      /* no-op */
    }
    try {
      // Calling stop() twice throws in some older Safari versions; the gain
      // ramp above silences the voice either way.
      v.src.stop(Math.max(when, v.start) + Math.max(RELEASE_TAIL, tau * 8));
    } catch {
      /* no-op */
    }
  }

  /** Releases the oldest voices if too many would overlap at `when`. */
  private enforceVoiceLimit(when: number) {
    let sounding = 0;
    for (const v of this.voices) if (v.end + RELEASE_TAIL > when) sounding++;
    for (let i = 0; i < this.voices.length && sounding >= MAX_VOICES; i++) {
      const v = this.voices[i];
      if (v.end + RELEASE_TAIL > when && v.start <= when) {
        this.release(v, when, 0.03);
        sounding--;
      }
    }
  }
}

const bank = new SampleBank();
let synth: PianoSynth | null = null;

/** Starts downloading/decoding the samples needed for these notes (no gesture needed). */
export function preloadPianoSamples(midis: Iterable<number>): void {
  bank.preload(midis);
}

/**
 * The shared piano. Creates and unlocks the AudioContext, so call it from a
 * user gesture (play button, key press). Returns null without Web Audio.
 */
export function getPiano(): PianoSynth | null {
  const ctx = unlockAudio();
  if (!ctx) return null;
  if (!synth) synth = new PianoSynth(ctx, bank);
  return synth;
}
