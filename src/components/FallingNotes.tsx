import React from "react";
import { Track } from "../lib/trackData";

interface FallingNotesProps {
  track: Track;
  currentBeat: number;
  startMidi?: number;
  endMidi?: number;
}

export const FallingNotes: React.FC<FallingNotesProps> = ({
  track,
  currentBeat,
  startMidi = 21,
  endMidi = 108,
}) => {
  const keys = [];
  for (let midi = startMidi; midi <= endMidi; midi++) {
    const noteClass = midi % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(noteClass);
    keys.push({ midi, isBlack });
  }

  const whiteKeysCount = keys.filter((k) => !k.isBlack).length;
  const whiteKeyWidth = 100 / whiteKeysCount;

  // Configuration for timing/speed
  const beatsVisible = 4; // How many beats ahead to show
  
  return (
    <div className="w-full flex-1 relative overflow-hidden pointer-events-none">
      {/* Background grid lines for white keys */}
      <div className="absolute inset-0 flex">
        {keys.filter(k => !k.isBlack).map(k => (
          <div key={k.midi} className="h-full border-r border-zinc-700/30" style={{ width: `${whiteKeyWidth}%` }} />
        ))}
      </div>

      {/* Falling notes */}
      {track.notes.map((note, index) => {
        // Only render notes that are coming up or recently finished
        if (note.startTime > currentBeat + beatsVisible) return null;
        if (note.startTime + note.duration < currentBeat) return null;

        const isBlack = [1, 3, 6, 8, 10].includes(note.midi % 12);
        
        const noteIndex = keys.findIndex(k => k.midi === note.midi);
        if (noteIndex === -1) return null; // out of range

        const precedingWhiteKeys = keys
          .slice(0, noteIndex)
          .filter((k) => !k.isBlack).length;
          
        let leftStyle = "";
        let widthStyle = "";
        
        if (isBlack) {
           leftStyle = `calc(${precedingWhiteKeys * whiteKeyWidth}% - ${whiteKeyWidth / 3}%)`;
           widthStyle = `${whiteKeyWidth / 1.5}%`;
        } else {
           leftStyle = `${precedingWhiteKeys * whiteKeyWidth}%`;
           widthStyle = `${whiteKeyWidth}%`;
        }
        
        // Calculate vertical position (0 is bottom, 100% is top)
        // bottom position = how far ahead the note starts
        const beatsAheadStart = note.startTime - currentBeat;
        const bottomPercent = (beatsAheadStart / beatsVisible) * 100;
        const heightPercent = (note.duration / beatsVisible) * 100;

        return (
          <div
            key={index}
            className={`absolute rounded-sm ${isBlack ? "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] z-10" : "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)] z-0"}`}
            style={{
              left: leftStyle,
              width: widthStyle,
              bottom: `${bottomPercent}%`,
              height: `${heightPercent}%`,
            }}
          />
        );
      })}
      
      {/* Playhead line at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-t from-blue-400 to-transparent z-20 shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
    </div>
  );
};
