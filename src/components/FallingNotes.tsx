import React, { useLayoutEffect, useMemo, useRef } from "react";
import type { Transport } from "../lib/transport";
import { lowerBound, parseKey, soundingKey, type TrackTiming } from "../lib/trackTiming";
import { useIsMobile } from "../hooks/useDeviceCaps";
import { useTransportValue } from "../hooks/useTransport";

interface FallingNotesProps {
  timing: TrackTiming;
  transport: Transport;
  expectedNotes?: number[];
  playedNotes?: number[];
  startMidi?: number;
  endMidi?: number;
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
  onNavigate,
}) => {
  const isMobile = useIsMobile();
  const stripRef = useRef<HTMLDivElement>(null);
  const base = useTransportValue(transport, (t) => baseFor(t.beat));
  const sounding = useTransportValue(transport, (t) => soundingKey(timing, t.beat));

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

  // Pre-compute key geometry once per midi-range.
  const { whiteKeyWidth, gridLines, midiLayout } = useMemo(() => {
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
        lines.push(precedingWhite * ww);
        precedingWhite++;
      }
    }
    return { whiteKeyWidth: ww, gridLines: lines, midiLayout: layout };
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

  // Slim shadow set on mobile to keep GPU compositing cheap.
  const cls = isMobile
    ? {
        correctBlack: "bg-emerald-400 z-10",
        correctWhite: "bg-emerald-300 z-0",
        targetBlack: "bg-sky-400 z-10",
        targetWhite: "bg-cyan-300 z-0",
        idleBlack: "bg-blue-500 z-10",
        idleWhite: "bg-blue-300 z-0",
      }
    : {
        correctBlack:
          "bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.95),0_0_36px_rgba(16,185,129,0.45)] z-10",
        correctWhite:
          "bg-emerald-300 shadow-[0_0_20px_rgba(110,231,183,1),0_0_42px_rgba(16,185,129,0.5)] z-0",
        targetBlack:
          "bg-sky-400 shadow-[0_0_16px_rgba(56,189,248,0.9),0_0_34px_rgba(59,130,246,0.4)] z-10",
        targetWhite:
          "bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.95),0_0_38px_rgba(59,130,246,0.45)] z-0",
        idleBlack: "bg-blue-500/90 shadow-[0_0_12px_rgba(59,130,246,0.45)] z-10",
        idleWhite: "bg-blue-300/90 shadow-[0_0_14px_rgba(96,165,250,0.4)] z-0",
      };

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-[linear-gradient(180deg,rgba(15,23,42,0.92)_0%,rgba(2,6,23,0.98)_100%)] ${onNavigate ? "cursor-ns-resize touch-none" : "pointer-events-none"}`}
      onPointerDown={onNavigate ? handlePointerDown : undefined}
      onPointerMove={onNavigate ? handlePointerMove : undefined}
      onPointerUp={onNavigate ? handlePointerUp : undefined}
      onPointerCancel={onNavigate ? handlePointerUp : undefined}
    >
      <div className="absolute inset-0">
        {gridLines.map((l, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-r border-zinc-700/30"
            style={{ left: `${l}%`, width: `${whiteKeyWidth}%` }}
          />
        ))}
      </div>

      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-300/10 to-transparent" />

      <div ref={stripRef} className="absolute inset-0 will-change-transform">
        {visible.map((i) => {
          const n = timing.notes[i];
          const geo = midiLayout.get(n.midi)!;
          const isCurrent = soundingSet.has(i);
          const isCorrect = isCurrent && playedSet.has(n.midi);
          const isTarget = isCurrent && expectedSet.has(n.midi);
          const noteClassName = isCorrect
            ? geo.isBlack ? cls.correctBlack : cls.correctWhite
            : isTarget
              ? geo.isBlack ? cls.targetBlack : cls.targetWhite
              : geo.isBlack ? cls.idleBlack : cls.idleWhite;
          return (
            <div
              key={i}
              className={`absolute rounded-t-md ${noteClassName}`}
              style={{
                left: `${geo.left}%`,
                width: `${geo.width}%`,
                bottom: `${(n.startTime - base) * PCT_PER_BEAT}%`,
                height: `${n.duration * PCT_PER_BEAT}%`,
              }}
            />
          );
        })}
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gradient-to-t from-cyan-300 via-sky-400 to-transparent z-20 shadow-[0_0_22px_rgba(56,189,248,0.85)]" />
    </div>
  );
};

export const FallingNotes = React.memo(FallingNotesImpl);
