import type { Track, TrackNote } from "./trackData";

export interface Chord {
  beat: number;
  midis: number[];
}

/**
 * Lookups precomputed once per track so the per-frame queries (which notes
 * are sounding, which chord is next) are binary searches instead of scans
 * over every note.
 */
export interface TrackTiming {
  /** Notes sorted by start time. */
  notes: TrackNote[];
  starts: number[];
  maxDuration: number;
  /** Groups of notes sharing a start beat, ascending. */
  chords: Chord[];
  chordBeats: number[];
  /** Beat of the last note's start. */
  lastStart: number;
  /** Beat where the last note ends. */
  endBeat: number;
  /** Each MIDI note once, in order of first use - the order to load samples in. */
  midisByFirstUse: number[];
}

export function buildTrackTiming(track: Track): TrackTiming {
  const notes = track.notes.slice().sort((a, b) => a.startTime - b.startTime);
  const starts = notes.map((n) => n.startTime);
  let maxDuration = 0;
  let endBeat = 0;
  const chords: Chord[] = [];
  const firstUse = new Set<number>();
  for (const n of notes) {
    maxDuration = Math.max(maxDuration, n.duration);
    endBeat = Math.max(endBeat, n.startTime + n.duration);
    const last = chords[chords.length - 1];
    if (last && last.beat === n.startTime) last.midis.push(n.midi);
    else chords.push({ beat: n.startTime, midis: [n.midi] });
    firstUse.add(n.midi);
  }
  return {
    notes,
    starts,
    maxDuration,
    chords,
    chordBeats: chords.map((c) => c.beat),
    lastStart: starts.length ? starts[starts.length - 1] : 0,
    endBeat,
    midisByFirstUse: Array.from(firstUse),
  };
}

/** First index with arr[i] >= x. */
export function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with arr[i] > x. */
export function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Indexes (ascending) of the notes sounding at `beat`: start <= beat < end. */
export function soundingNotes(t: TrackTiming, beat: number): number[] {
  const out: number[] = [];
  const minStart = beat - t.maxDuration;
  for (let i = upperBound(t.starts, beat) - 1; i >= 0 && t.starts[i] >= minStart; i--) {
    const n = t.notes[i];
    if (n.startTime + n.duration > beat) out.push(i);
  }
  return out.reverse();
}

let keyCache: { t: TrackTiming; beat: number; key: string } | null = null;

/**
 * soundingNotes() as a string, so React can compare it cheaply. Several
 * subscribers ask for the same beat each frame, hence the one-entry cache.
 */
export function soundingKey(t: TrackTiming, beat: number): string {
  if (keyCache && keyCache.t === t && keyCache.beat === beat) return keyCache.key;
  const key = soundingNotes(t, beat).join(",");
  keyCache = { t, beat, key };
  return key;
}

export function parseKey(key: string): number[] {
  return key ? key.split(",").map(Number) : [];
}

/**
 * Practice mode target: the chord at or just after the playhead. A small
 * backward tolerance keeps a slight overshoot on the chord.
 */
export function chordIndexAt(t: TrackTiming, beat: number): number {
  if (t.chords.length === 0) return -1;
  return Math.min(lowerBound(t.chordBeats, beat - 0.05), t.chords.length - 1);
}
