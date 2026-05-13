import React, { useCallback, useMemo } from "react";
import { cn } from "../lib/utils";
import { getSynth } from "../lib/synth";
import { useIsMobile } from "../hooks/useDeviceCaps";

interface PianoKeyboardProps {
  activeNotes: Set<number>;
  expectedNotes?: number[];
  playedNotes?: number[];
  startMidi?: number;
  endMidi?: number;
  variant?: "default" | "flow";
  /** 0..1 brightness multiplier. 1 = full bright (no dim). */
  dim?: number;
  /** When true, pressed keys get a top-down white highlight + soft surround glow. */
  topLight?: boolean;
  onSynthesizedNoteChanged?: (midi: number | null) => void;
}

const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);

const PianoKeyboardImpl: React.FC<PianoKeyboardProps> = ({
  activeNotes,
  expectedNotes = [],
  playedNotes = [],
  startMidi = 48,
  endMidi = 84,
  variant = "default",
  dim = 1,
  topLight = false,
  onSynthesizedNoteChanged,
}) => {
  const isMobile = useIsMobile();

  // Pre-compute key geometry once per midi-range.
  const { keys, whiteKeyWidth } = useMemo(() => {
    const arr: { midi: number; isBlack: boolean; precedingWhite: number }[] = [];
    let precedingWhite = 0;
    for (let midi = startMidi; midi <= endMidi; midi++) {
      const isBlack = BLACK_CLASSES.has(midi % 12);
      arr.push({ midi, isBlack, precedingWhite });
      if (!isBlack) precedingWhite++;
    }
    return { keys: arr, whiteKeyWidth: 100 / precedingWhite };
  }, [startMidi, endMidi]);

  const expectedSet = useMemo(() => new Set(expectedNotes), [expectedNotes]);
  const playedSet = useMemo(() => new Set(playedNotes), [playedNotes]);

  const handlePointerDown = useCallback(
    (midi: number) => {
      const synth = getSynth();
      if (synth) {
        synth.playNote(midi);
      }
      if (onSynthesizedNoteChanged) {
        onSynthesizedNoteChanged(midi);
      }
    },
    [onSynthesizedNoteChanged],
  );

  const handlePointerUp = useCallback(
    (midi: number) => {
      const synth = getSynth();
      if (synth) {
        synth.stopNote(midi);
      }
      if (onSynthesizedNoteChanged) {
        onSynthesizedNoteChanged(null);
      }
    },
    [onSynthesizedNoteChanged],
  );

  return (
    <div
      className={cn(
        "w-full h-full flex rounded-b-2xl relative touch-none select-none bg-transparent",
        // Allow surround glow to spill above the keyboard when stage lighting is on.
        topLight ? "" : "overflow-hidden",
        variant === "flow" ? "min-h-[180px]" : "min-h-[150px] max-h-[300px]",
      )}
    >
      {keys.map((key, i) => {
        const isActive = activeNotes.has(key.midi);
        const isExpected = expectedSet.has(key.midi);
        const isPlayed = playedSet.has(key.midi);

        let bgColor = key.isBlack
          ? "bg-zinc-950 border border-zinc-800"
          : "bg-zinc-100 border-x border-b border-zinc-300/80";
        const zIndex = key.isBlack ? "z-10" : "z-0";

        if (isExpected) {
          bgColor = key.isBlack
            ? isMobile
              ? "bg-sky-500 border border-sky-300/60"
              : "bg-sky-500 border border-sky-300/60 shadow-[0_0_16px_rgba(56,189,248,0.6),0_0_28px_rgba(59,130,246,0.28)]"
            : isMobile
              ? "bg-sky-300 border-x border-b border-sky-200"
              : "bg-sky-300 border-x border-b border-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.55),inset_0_0_18px_rgba(255,255,255,0.35)]";
        }
        // Green when correctly pressed OR actively held during an expected window.
        if ((isPlayed || isActive) && isExpected) {
          bgColor = key.isBlack
            ? isMobile
              ? "bg-emerald-400 border border-emerald-200/70"
              : "bg-emerald-400 border border-emerald-200/70 shadow-[0_0_24px_rgba(74,222,128,0.95),0_0_54px_rgba(16,185,129,0.42)]"
            : isMobile
              ? "bg-emerald-300 border-x border-b border-emerald-100"
              : "bg-emerald-300 border-x border-b border-emerald-100 shadow-[0_0_26px_rgba(110,231,183,1),0_0_60px_rgba(16,185,129,0.45),inset_0_0_22px_rgba(255,255,255,0.4)]";
        } else if (isPlayed && !isExpected) {
          bgColor = key.isBlack
            ? isMobile
              ? "bg-rose-400 border border-rose-200/70"
              : "bg-rose-400 border border-rose-200/70 shadow-[0_0_24px_rgba(251,113,133,0.95),0_0_54px_rgba(244,63,94,0.38)]"
            : isMobile
              ? "bg-rose-300 border-x border-b border-rose-100"
              : "bg-rose-300 border-x border-b border-rose-100 shadow-[0_0_26px_rgba(253,164,175,0.95),0_0_60px_rgba(244,63,94,0.4),inset_0_0_22px_rgba(255,255,255,0.35)]";
        } else if (isActive && !isExpected && !isPlayed) {
          bgColor = key.isBlack
            ? isMobile
              ? "bg-emerald-500 border border-emerald-200/70"
              : "bg-emerald-500 border border-emerald-200/70 shadow-[0_0_24px_rgba(16,185,129,0.85),0_0_44px_rgba(16,185,129,0.32)]"
            : isMobile
              ? "bg-emerald-400 border-x border-b border-emerald-100"
              : "bg-emerald-400 border-x border-b border-emerald-100 shadow-[0_0_24px_rgba(16,185,129,0.8),0_0_54px_rgba(16,185,129,0.32),inset_0_0_22px_rgba(255,255,255,0.3)]";
        }

        if (key.isBlack) {
          const leftPos = key.precedingWhite * whiteKeyWidth;

          return (
            <div
              key={key.midi}
              onPointerDown={(e) => {
                e.preventDefault();
                handlePointerDown(key.midi);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                handlePointerUp(key.midi);
              }}
              onPointerLeave={(e) => {
                e.preventDefault();
                handlePointerUp(key.midi);
              }}
              className={cn(
                "absolute top-0 rounded-b-lg transition-colors duration-75 cursor-pointer touch-none",
                bgColor,
                zIndex,
              )}
              style={{
                left: `calc(${leftPos}% - ${whiteKeyWidth / 3}%)`,
                width: `${whiteKeyWidth / 1.5}%`,
                height: "60%",
              }}
            />
          );
        } else {
          return (
            <div
              key={key.midi}
              onPointerDown={(e) => {
                e.preventDefault();
                handlePointerDown(key.midi);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                handlePointerUp(key.midi);
              }}
              onPointerLeave={(e) => {
                e.preventDefault();
                handlePointerUp(key.midi);
              }}
              className={cn(
                "flex-1 rounded-b-2xl transition-all duration-75 flex items-end justify-center pb-2 cursor-pointer touch-none relative",
                bgColor,
                zIndex,
              )}
            >
              {key.midi % 12 === 0 && (
                <span className="absolute bottom-4 left-0 right-0 text-center text-[10px] font-mono text-zinc-500 pointer-events-none">
                  C{key.midi / 12 - 1}
                </span>
              )}
            </div>
          );
        }
      })}

      {/* Dim layer — darkens all keys uniformly. Sits above key bodies, below spotlights. */}
      {dim < 1 && (
        <div
          className="absolute inset-0 pointer-events-none z-20 rounded-b-2xl"
          style={{ background: `rgba(0,0,0,${(1 - dim).toFixed(3)})` }}
        />
      )}

      {/* Per-pressed-key spotlight: top-down white highlight + soft surround glow. */}
      {topLight && keys.map((key) => {
        if (!activeNotes.has(key.midi)) return null;
        const leftPct = key.precedingWhite * whiteKeyWidth;
        const left = key.isBlack
          ? `calc(${leftPct}% - ${whiteKeyWidth / 3}%)`
          : `${leftPct}%`;
        const width = key.isBlack ? `${whiteKeyWidth / 1.5}%` : `${whiteKeyWidth}%`;
        const height = key.isBlack ? "60%" : "100%";
        return (
          <div
            key={`spot-${key.midi}`}
            className={cn(
              "absolute top-0 pointer-events-none z-30",
              key.isBlack ? "rounded-b-lg" : "rounded-b-2xl",
            )}
            style={{
              left,
              width,
              height,
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.45) 18%, rgba(255,255,255,0.12) 45%, transparent 78%)",
              boxShadow: isMobile
                ? "0 0 18px 4px rgba(255,255,255,0.45)"
                : "0 0 28px 6px rgba(255,255,255,0.55), 0 -10px 36px 8px rgba(255,255,255,0.32)",
            }}
          />
        );
      })}
    </div>
  );
};

export const PianoKeyboard = React.memo(PianoKeyboardImpl);
