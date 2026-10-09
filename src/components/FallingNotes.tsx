import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Transport } from "../lib/transport";
import { HitEffects, type Emitter } from "../lib/hitEffects";
import { lowerBound, parseKey, soundingKey, type TrackTiming } from "../lib/trackTiming";
import { useTransportValue } from "../hooks/useTransport";

interface FallingNotesProps {
  timing: TrackTiming;
  transport: Transport;
  expectedNotes?: number[];
  playedNotes?: number[];
  startMidi?: number;
  endMidi?: number;
  /** Sparks and flares where notes hit the keyboard. */
  effects?: boolean;
  /** Called in practice mode when the user drags up/down; delta is in beats */
  onNavigate?: (deltaBeat: number) => void;
}

const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);
const BEATS_VISIBLE = 4;
/** Percent of the panel height per beat. */
const PCT_PER_BEAT = 100 / BEATS_VISIBLE;
/**
 * The notes are laid out on a strip relative to a base beat that only moves
 * every few beats; in between, the strip is just translated each frame.
 */
const REBASE_BEATS = 4;
const NO_NOTES: number[] = [];

const baseFor = (beat: number) => Math.floor(beat / REBASE_BEATS) * REBASE_BEATS;

// Mint notes on black, after the "particle" style of piano videos. Notes that
// are sounding brighten; ones played correctly glow near-white. Glows are
// cheap here: notes are only repainted when they change, never per frame.
const NOTE_CLASSES = {
  idleWhite: "bg-[#7cb3a6] shadow-[0_0_10px_rgba(124,179,166,0.3)] z-0",
  idleBlack: "bg-[#5d9688] shadow-[0_0_10px_rgba(93,150,136,0.3)] z-10",
  targetWhite: "bg-[#a9dccb] shadow-[0_0_16px_rgba(160,225,203,0.6)] z-0",
  targetBlack: "bg-[#86c5b1] shadow-[0_0_16px_rgba(134,197,177,0.6)] z-10",
  correctWhite: "bg-[#e0fff3] shadow-[0_0_22px_rgba(200,255,232,0.85),0_0_44px_rgba(124,179,166,0.45)] z-0",
  correctBlack: "bg-[#b8f1dc] shadow-[0_0_22px_rgba(184,241,220,0.85),0_0_44px_rgba(124,179,166,0.45)] z-10",
};

/**
 * Synthesia-style falling notes. During playback the only per-frame work is
 * one CSS transform on the strip holding the notes, which the compositor
 * applies without layout, paint or a React render. The notes themselves are
 * re-rendered only when one starts/stops sounding or the strip is rebased.
 */
const FallingNotesImpl: React.FC<FallingNotesProps> = ({
  timing,
  transport,
  expectedNotes = NO_NOTES,
  playedNotes = NO_NOTES,
  startMidi = 21,
  endMidi = 108,
  effects = true,
  onNavigate,
}) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HitEffects | null>(null);
  const base = useTransportValue(transport, (t) => baseFor(t.beat));
  const sounding = useTransportValue(transport, (t) => soundingKey(timing, t.beat));
  const isPlaying = useTransportValue(transport, (t) => t.playing);

  // Vertical drag tracking for practice mode navigation.
  // Dragging down moves forward in time, up moves back — matches the natural
  // direction the notes are falling.
  const dragStartY = useRef<number | null>(null);
  const PIXELS_PER_BEAT = 160;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!onNavigate) return;
    dragStartY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!onNavigate || dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current; // positive = dragged down = forward
    dragStartY.current = e.clientY;
    onNavigate(dy / PIXELS_PER_BEAT);
  };
  const handlePointerUp = () => {
    dragStartY.current = null;
  };

  // Pre-compute key geometry once per midi-range, plus a faint line at each C.
  const { octaveLines, midiLayout } = useMemo(() => {
    const layout = new Map<number, { left: number; width: number; isBlack: boolean }>();
    const lines: number[] = [];
    let whiteCount = 0;
    for (let midi = startMidi; midi <= endMidi; midi++) {
      if (!BLACK_KEY_CLASSES.has(midi % 12)) whiteCount++;
    }
    const ww = 100 / whiteCount;
    let precedingWhite = 0;
    for (let midi = startMidi; midi <= endMidi; midi++) {
      const isBlack = BLACK_KEY_CLASSES.has(midi % 12);
      if (isBlack) {
        layout.set(midi, {
          left: precedingWhite * ww - ww / 3,
          width: ww / 1.5,
          isBlack: true,
        });
      } else {
        layout.set(midi, {
          left: precedingWhite * ww,
          width: ww,
          isBlack: false,
        });
        if (midi % 12 === 0 && precedingWhite > 0) lines.push(precedingWhite * ww);
        precedingWhite++;
      }
    }
    return { octaveLines: lines, midiLayout: layout };
  }, [startMidi, endMidi]);

  // Notes that can be on screen while the playhead is in [base, base + REBASE_BEATS).
  const visible = useMemo(() => {
    const out: number[] = [];
    const last = lowerBound(timing.starts, base + REBASE_BEATS + BEATS_VISIBLE);
    for (let i = lowerBound(timing.starts, base - timing.maxDuration); i < last; i++) {
      const n = timing.notes[i];
      if (n.startTime + n.duration > base && midiLayout.has(n.midi)) out.push(i);
    }
    return out;
  }, [timing, base, midiLayout]);

  // Move the strip every frame, straight from the transport.
  useLayoutEffect(() => {
    const update = () => {
      const strip = stripRef.current;
      if (!strip) return;
      const beat = transport.beat;
      strip.style.transform = `translate3d(0, ${(beat - baseFor(beat)) * PCT_PER_BEAT}%, 0)`;
    };
    update();
    return transport.subscribe(update);
  }, [transport]);

  const soundingSet = useMemo(() => new Set(parseKey(sounding)), [sounding]);
  const expectedSet = useMemo(() => new Set(expectedNotes), [expectedNotes]);
  const playedSet = useMemo(() => new Set(playedNotes), [playedNotes]);

  // Keys that flare and spark at the hit line: notes sounding during playback,
  // and whatever the player presses (white when right, rose when wrong).
  const emitters = useMemo(() => {
    const list: Emitter[] = [];
    const lit = new Set<number>();
    const at = (midi: number) => {
      const geo = midiLayout.get(midi);
      return geo ? { x: (geo.left + geo.width / 2) / 100, w: geo.width / 100 } : null;
    };
    if (isPlaying) {
      soundingSet.forEach((i) => {
        const midi = timing.notes[i].midi;
        const pos = at(midi);
        if (!pos || lit.has(midi)) return;
        lit.add(midi);
        list.push({ id: `n${i}`, ...pos, tone: playedSet.has(midi) ? 1 : 0 });
      });
    }
    playedSet.forEach((midi) => {
      const pos = at(midi);
      if (!pos || lit.has(midi)) return;
      list.push({ id: `p${midi}`, ...pos, tone: expectedSet.has(midi) ? 1 : 2 });
    });
    return list;
  }, [isPlaying, soundingSet, playedSet, expectedSet, timing, midiLayout]);

  useEffect(() => {
    const canvas = fxCanvasRef.current;
    if (!effects || !canvas) return;
    const fx = new HitEffects(canvas);
    fxRef.current = fx;
    const onResize = () => fx.resize();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", onResize);
    }
    return () => {
      fx.dispose();
      fxRef.current = null;
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", onResize);
    };
  }, [effects]);

  useEffect(() => {
    fxRef.current?.setEmitters(emitters);
  }, [emitters, effects]);

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-black ${onNavigate ? "cursor-ns-resize touch-none" : "pointer-events-none"}`}
      onPointerDown={onNavigate ? handlePointerDown : undefined}
      onPointerMove={onNavigate ? handlePointerMove : undefined}
      onPointerUp={onNavigate ? handlePointerUp : undefined}
      onPointerCancel={onNavigate ? handlePointerUp : undefined}
    >
      {octaveLines.map((l, i) => (
        <div key={i} className="absolute top-0 bottom-0 w-px bg-white/[0.06]" style={{ left: `${l}%` }} />
      ))}

      <div ref={stripRef} className="absolute inset-0 will-change-transform">
        {visible.map((i) => {
          const n = timing.notes[i];
          const geo = midiLayout.get(n.midi)!;
          const isCurrent = soundingSet.has(i);
          const isCorrect = isCurrent && playedSet.has(n.midi);
          const isTarget = isCurrent && expectedSet.has(n.midi);
          const noteClassName = isCorrect
            ? geo.isBlack ? NOTE_CLASSES.correctBlack : NOTE_CLASSES.correctWhite
            : isTarget
              ? geo.isBlack ? NOTE_CLASSES.targetBlack : NOTE_CLASSES.targetWhite
              : geo.isBlack ? NOTE_CLASSES.idleBlack : NOTE_CLASSES.idleWhite;
          return (
            <div
              key={i}
              className={`absolute rounded-[5px] ${noteClassName}`}
              style={{
                left: `calc(${geo.left}% + 1px)`,
                width: `calc(${geo.width}% - 2px)`,
                bottom: `${(n.startTime - base) * PCT_PER_BEAT}%`,
                height: `${n.duration * PCT_PER_BEAT}%`,
              }}
            />
          );
        })}
      </div>

      {/* Notes fade in out of the dark at the top. */}
      <div className="absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-black/45 to-transparent pointer-events-none z-[15]" />

      {/* Hit line */}
      <div className="absolute bottom-0 inset-x-0 h-px bg-[#d4e6e0]/50 shadow-[0_0_10px_2px_rgba(124,179,166,0.35)] z-20" />

      {effects && (
        <canvas ref={fxCanvasRef} className="absolute inset-x-0 bottom-0 w-full h-2/5 pointer-events-none z-30" />
      )}
    </div>
  );
};

export const FallingNotes = React.memo(FallingNotesImpl);
