import React, { useEffect, useRef } from "react";
import Vex, {
  Renderer,
  Stave,
  StaveNote,
  Accidental,
  Voice,
  Formatter,
} from "vexflow";
import { Track, TrackNote } from "../lib/trackData";

interface SheetMusicProps {
  track: Track;
  currentBeat: number;
  expectedNotes?: number[];
  playedNotes?: number[];
}

export const SheetMusic: React.FC<SheetMusicProps> = ({
  track,
  currentBeat,
  expectedNotes = [],
  playedNotes = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      if (width > 0 && width !== containerWidth) {
        setContainerWidth(width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerWidth]);

  useEffect(() => {
    if (!containerRef.current || containerWidth === 0) return;

    containerRef.current.innerHTML = "";

    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    const height = 200;
    renderer.resize(containerWidth, height);

    const context = renderer.getContext();
    context.setFont("Arial", 10, "").setBackgroundFillStyle("#F9F7F2");

    const stave = new Stave(10, 40, containerWidth - 20);
    stave.addClef("treble").addTimeSignature("4/4");
    stave.setContext(context).draw();

    const measureLength = 4;
    const maxVisibleMeasures = Math.max(1, Math.floor((containerWidth - 100) / 150));

    const currentMeasureIndex = Math.floor(currentBeat / measureLength);

    const visibleNotes = track.notes.filter(
      (n) =>
        n.startTime >= currentMeasureIndex * measureLength &&
        n.startTime <
          (currentMeasureIndex + maxVisibleMeasures) * measureLength,
    );

    if (visibleNotes.length === 0) return;

    const groupedNotes = new Map<number, TrackNote[]>();
    visibleNotes.forEach(n => {
      // Quantize slightly to group chords
      const quantTime = Math.round(n.startTime * 16) / 16;
      if (!groupedNotes.has(quantTime)) {
        groupedNotes.set(quantTime, []);
      }
      groupedNotes.get(quantTime)!.push(n);
    });

    const vexNotes: StaveNote[] = [];

    const sortedTimes = Array.from(groupedNotes.keys()).sort((a,b) => a - b);

    sortedTimes.forEach((time) => {
      const group = groupedNotes.get(time)!;
      // Get max duration in group
      const maxDuration = Math.max(...group.map(n => n.duration));
      
      const keys: string[] = [];
      const accidentalsList: string[] = [];
      
      group.forEach((n) => {
        const noteClass = n.midi % 12;
        const octave = Math.floor(n.midi / 12) - 1;
        const noteNames = ["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"];
        let keyStr = noteNames[noteClass];
        const accidentals = keyStr.includes("#") ? "#" : "";
        keyStr = keyStr.replace("#", "");
        const vfKey = `${keyStr}/${octave}`;
        keys.push(vfKey);
        accidentalsList.push(accidentals);
      });

      let duration = "q";
      if (maxDuration <= 0.25) duration = "16";
      else if (maxDuration <= 0.5) duration = "8";
      else if (maxDuration <= 1) duration = "q";
      else if (maxDuration <= 2) duration = "h";
      else duration = "w";

      // VexFlow requires unique un-sorted keys? Actually sorting them by pitch is safest.
      // E.g. c/4, e/4, g/4. We will sort them by midi value just in case.
      
      // Filter out duplicate MIDI notes to prevent VexFlow duplicate key error
      const uniqueGroup: typeof group = [];
      const seenMidi = new Set<number>();
      group.forEach(n => {
        if (!seenMidi.has(n.midi)) {
          seenMidi.add(n.midi);
          uniqueGroup.push(n);
        }
      });
      uniqueGroup.sort((a,b) => a.midi - b.midi);

      const sortedKeys = uniqueGroup.map(n => {
        const nc = n.midi % 12;
        const oct = Math.max(0, Math.floor(n.midi / 12) - 1);
        const nn = ["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"];
        return `${nn[nc].replace("#","")}/${oct}`;
      });
      const sortedAccids = uniqueGroup.map(n => {
        const nc = n.midi % 12;
        const nn = ["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"];
        return nn[nc].includes("#") ? "#" : "";
      });

      let staveNote: StaveNote;
      try {
        staveNote = new StaveNote({ keys: sortedKeys, duration });
        sortedAccids.forEach((acc, index) => {
          if (acc) staveNote.addModifier(new Accidental(acc), index);
        });

        // Highlight logic
        let anyPlayed = false;
        let allPlayed = true;
        group.forEach(n => {
          if (n.startTime <= currentBeat && (n.startTime + n.duration) > currentBeat) {
            if (playedNotes.includes(n.midi)) {
              anyPlayed = true;
            } else {
              allPlayed = false;
            }
          } else {
            allPlayed = false;
          }
        });
        
        const isCurrent = group.some(n => n.startTime <= currentBeat && (n.startTime + n.duration) > currentBeat);
        if (isCurrent) {
          if (anyPlayed) {
            staveNote.setStyle({ fillStyle: "#22c55e", strokeStyle: "#22c55e" });
          } else {
            staveNote.setStyle({ fillStyle: "#60a5fa", strokeStyle: "#60a5fa" });
          }
        }

        vexNotes.push(staveNote);
      } catch (err) {
        console.warn("Failed to create StaveNote", sortedKeys, err);
        return;
      }
    });

    if (vexNotes.length === 0) return;

    try {
      Formatter.FormatAndDraw(context, stave, vexNotes);
    } catch (e) {
      console.warn("VexFlow formatting error:", e);
      // Rough fallback just in case
      let startX = stave.getNoteStartX();
      vexNotes.forEach((note, idx) => {
        try {
          note.setStave(stave);
          note.setContext(context);
          const tickContext = new Vex.TickContext();
          tickContext.addTickable(note);
          tickContext.preFormat().setX(startX);
          note.draw();
          startX += 60;
        } catch(noteErr) {
          console.error("VexFlow failed to draw note:", noteErr);
        }
      });
    }
  }, [track, currentBeat, expectedNotes, playedNotes, containerWidth]);

  return (
    <div className="w-full h-full min-h-[200px] bg-transparent rounded-md flex items-center justify-center p-4">
      <div ref={containerRef} className="w-full max-w-5xl h-full" />
    </div>
  );
};
