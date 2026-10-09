import { isLowPowerDevice } from "./device";
import { getPiano, type PianoSynth } from "./piano";
import { lowerBound, upperBound, type TrackTiming } from "./trackTiming";

/** Seconds of audio handed to Web Audio ahead of time; survives main-thread stalls this long. */
const LOOKAHEAD = isLowPowerDevice() ? 0.3 : 0.15;
/** The scheduler also runs on a timer, so audio keeps flowing when animation frames are throttled. */
const TICK_MS = 25;
/** Gap between pressing play (or seeking) and the first note, so that note can be timed exactly. */
const START_DELAY = 0.05;
/** After a stall longer than this, missed notes are skipped instead of all sounding at once. */
const MAX_LATE = 0.2;
/** How long to wait for the AudioContext to start before animating without sound. */
const AUDIO_START_TIMEOUT = 1.5;

type Listener = () => void;

const perfNow = () => performance.now() / 1000;

/**
 * Owns the playhead. While playing, the position follows the audio clock and
 * notes are handed to Web Audio a little ahead of time with exact start times,
 * so they stay evenly spaced however busy the main thread is. Components read
 * `beat` when notified instead of the whole app re-rendering every frame.
 *
 * Internally the position is an unwrapped "raw" beat that keeps increasing
 * across loops; `beat` is that wrapped into [loopStart, loopEnd).
 */
export class Transport {
  /** Current playhead in beats. Updated every animation frame while playing. */
  beat: number;
  playing = false;

  private speed = 1;
  private anchorBeat: number;
  private anchorTime = 0;
  private useAudioClock = false;
  private waitingForAudio = false;
  private playRequestedAt = 0;
  private piano: PianoSynth | null = null;
  // Next note to hand to the audio graph: loop iteration + index into notes.
  private iter = 0;
  private index = 0;
  private rafId = 0;
  private timerId: number | undefined;
  private listeners = new Set<Listener>();

  constructor(
    private timing: TrackTiming,
    private bpm: number,
    private loopStart: number,
    private loopEnd: number,
  ) {
    this.anchorBeat = this.beat = loopStart;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Must be called from a user gesture the first time, so audio can start. */
  play(): void {
    if (this.playing) return;
    if (this.anchorBeat < this.loopStart || this.anchorBeat >= this.loopEnd) this.anchorBeat = this.loopStart;
    this.piano = getPiano();
    this.playing = true;
    this.waitingForAudio = true;
    this.playRequestedAt = perfNow();
    this.service();
    this.rafId = requestAnimationFrame(this.frame);
    this.timerId = window.setInterval(this.timerTick, TICK_MS);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.updateBeat();
    this.playing = false;
    this.waitingForAudio = false;
    this.anchorBeat = this.beat;
    this.piano?.stopSequenced();
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    window.clearInterval(this.timerId);
    this.timerId = undefined;
    this.emit();
  }

  seek(beat: number): void {
    if (!isFinite(beat)) return;
    this.anchorBeat = this.beat = beat;
    if (this.playing && !this.waitingForAudio) {
      this.piano?.stopSequenced();
      this.anchorTime = this.clockNow() + (this.useAudioClock ? START_DELAY : 0);
      this.resetCursor(beat, false);
    }
    this.emit();
  }

  setSpeed(speed: number): void {
    if (speed === this.speed || !(speed > 0)) return;
    if (this.playing && !this.waitingForAudio) {
      // Re-anchor at the current position so the tempo change is seamless.
      const t = Math.max(this.clockNow(), this.anchorTime);
      const raw = this.anchorBeat + (t - this.anchorTime) * this.beatsPerSecond();
      this.anchorBeat = raw;
      this.anchorTime = t;
      this.speed = speed;
      if (this.useAudioClock) {
        // Notes already queued but not yet sounding were timed for the old tempo.
        this.piano?.cancelSequencedAfter(t);
        this.resetCursor(raw, true);
      }
    } else {
      this.speed = speed;
    }
  }

  private beatsPerSecond(): number {
    return (this.bpm * this.speed) / 60;
  }

  private clockNow(): number {
    return this.useAudioClock && this.piano ? this.piano.now() : perfNow();
  }

  private wrap(raw: number): number {
    const period = this.loopEnd - this.loopStart;
    if (raw < this.loopEnd || period <= 0) return raw;
    return this.loopStart + ((raw - this.loopStart) % period);
  }

  /** Point the scheduler at the first note at (or, if strict, after) raw beat `raw`. */
  private resetCursor(raw: number, strict: boolean) {
    const period = this.loopEnd - this.loopStart;
    let iter = period > 0 && raw >= this.loopEnd ? Math.floor((raw - this.loopStart) / period) : 0;
    const pos = raw - iter * period;
    let index = strict ? upperBound(this.timing.starts, pos) : lowerBound(this.timing.starts, pos);
    if (index >= this.timing.notes.length) {
      iter++;
      index = 0;
    }
    this.iter = iter;
    this.index = index;
  }

  private frame = () => {
    this.rafId = 0;
    if (!this.playing) return;
    this.service();
    if (!this.playing) return;
    this.updateBeat();
    this.emit();
    this.rafId = requestAnimationFrame(this.frame);
  };

  private timerTick = () => {
    if (this.playing) this.service();
  };

  /** Starts the clock once audio is running, watches for interruptions, schedules notes. */
  private service() {
    const piano = this.piano;
    if (this.waitingForAudio) {
      if (piano && !piano.isRunning() && perfNow() - this.playRequestedAt < AUDIO_START_TIMEOUT) return;
      // Audio running (or never going to start: then animate silently).
      this.useAudioClock = !!piano && piano.isRunning();
      this.waitingForAudio = false;
      this.anchorTime = this.clockNow() + (this.useAudioClock ? START_DELAY : 0);
      this.resetCursor(this.anchorBeat, false);
    }
    if (!piano) return;
    if (this.useAudioClock) {
      if (!piano.isRunning()) {
        // The OS took the audio away (phone call, Siri, another app).
        this.pause();
        return;
      }
      this.schedule(piano);
    } else if (piano.isRunning()) {
      // Audio came up after we gave up waiting: switch over to it.
      const raw = this.anchorBeat + Math.max(0, perfNow() - this.anchorTime) * this.beatsPerSecond();
      this.useAudioClock = true;
      this.anchorBeat = raw;
      this.anchorTime = piano.now() + START_DELAY;
      this.resetCursor(raw, false);
    }
  }

  private schedule(piano: PianoSynth) {
    const notes = this.timing.notes;
    const period = this.loopEnd - this.loopStart;
    if (notes.length === 0 || period <= 0) return;
    const now = piano.now();
    const horizon = now + LOOKAHEAD;
    const spb = 1 / this.beatsPerSecond();
    for (;;) {
      if (this.index >= notes.length) {
        this.iter++;
        this.index = 0;
      }
      const n = notes[this.index];
      const t = this.anchorTime + (n.startTime + this.iter * period - this.anchorBeat) * spb;
      if (t >= horizon) break;
      if (t >= now - MAX_LATE) piano.schedule(n.midi, t, n.duration * spb);
      this.index++;
    }
  }

  private updateBeat() {
    if (this.waitingForAudio) {
      this.beat = this.anchorBeat;
      return;
    }
    let t = this.clockNow();
    // Show what is being heard right now, not what was just handed to the hardware.
    if (this.useAudioClock && this.piano) t -= this.piano.outputLatency();
    const raw = t <= this.anchorTime ? this.anchorBeat : this.anchorBeat + (t - this.anchorTime) * this.beatsPerSecond();
    this.beat = this.wrap(raw);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}
