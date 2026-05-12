import React, { useCallback } from "react";
import { cn } from "../lib/utils";
import { getSynth } from "../lib/synth";

interface PianoKeyboardProps {
  activeNotes: Set<number>;
  expectedNotes?: number[];
  playedNotes?: number[];
  startMidi?: number;
  endMidi?: number;
  onSynthesizedNoteChanged?: (midi: number | null) => void;
}

export const PianoKeyboard: React.FC<PianoKeyboardProps> = ({
  activeNotes,
  expectedNotes = [],
  playedNotes = [],
  startMidi = 48, // C3
  endMidi = 84, // C6
  onSynthesizedNoteChanged,
}) => {
  const keys = [];

  for (let midi = startMidi; midi <= endMidi; midi++) {
    const noteClass = midi % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(noteClass);
    keys.push({ midi, isBlack });
  }

  // Count white keys to calculate widths
  const whiteKeysCount = keys.filter((k) => !k.isBlack).length;
  const whiteKeyWidth = 100 / whiteKeysCount;

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
    <div className="w-full h-full min-h-[150px] max-h-[300px] flex gap-[2px] rounded-t-xl relative touch-none select-none bg-transparent">
      {keys.map((key, i) => {
        const isActive = activeNotes.has(key.midi);
        const isExpected = expectedNotes.includes(key.midi);
        const isPlayed = playedNotes.includes(key.midi);

        let bgColor = key.isBlack ? "bg-zinc-900" : "bg-zinc-100";
        let zIndex = key.isBlack ? "z-10" : "z-0";

        if (isExpected) {
          bgColor = "bg-blue-400";
        }
        if (isPlayed && isExpected) {
          bgColor = "bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]";
        } else if (isPlayed && !isExpected) {
          bgColor = "bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]";
        } else if (isActive && !isExpected && !isPlayed) {
          bgColor = "bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]";
        }

        if (key.isBlack) {
          const precedingWhiteKeys = keys
            .slice(0, i)
            .filter((k) => !k.isBlack).length;
          const leftPos = precedingWhiteKeys * whiteKeyWidth;

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
                "absolute top-0 rounded-b transition-colors duration-75 cursor-pointer touch-none shadow-xl",
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
                "flex-1 rounded-b transition-all duration-75 flex items-end justify-center pb-2 cursor-pointer touch-none relative",
                bgColor,
                zIndex,
              )}
            >
              {key.midi % 12 === 0 && (
                <span className="absolute bottom-4 left-0 right-0 text-center text-[10px] font-mono text-zinc-400 pointer-events-none">
                  C{key.midi / 12 - 1}
                </span>
              )}
            </div>
          );
        }
      })}
    </div>
  );
};
