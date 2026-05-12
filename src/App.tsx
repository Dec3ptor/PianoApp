import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Square,
  Settings,
  Mic,
  MicOff,
  Music,
  Keyboard,
} from "lucide-react";
import { SheetMusic } from "./components/SheetMusic";
import { PianoKeyboard } from "./components/PianoKeyboard";
import { FallingNotes } from "./components/FallingNotes";
import { MOONLIGHT_SONATA } from "./lib/trackData";
import { usePitchDetector } from "./hooks/usePitchDetector";
import { cn } from "./lib/utils";
import { getSynth } from "./lib/synth";

type ViewMode = "both" | "sheet" | "keyboard" | "synthesia";

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentBeat, setCurrentBeat] = useState(0);

  const { midiNotes, isListening, startListening, stopListening, error } =
    usePitchDetector();
  const [synthesizedNote, setSynthesizedNote] = useState<number | null>(null);

  const playedNotesFinal = [...midiNotes];
  if (synthesizedNote !== null && !playedNotesFinal.includes(synthesizedNote)) {
    playedNotesFinal.push(synthesizedNote);
  }
  const activeNotes = new Set(playedNotesFinal);

  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const track = MOONLIGHT_SONATA;

  // Determine expected notes
  const expectedNotes = track.notes
    .filter(n => currentBeat >= n.startTime && currentBeat < n.startTime + n.duration)
    .map(n => n.midi);

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    } else {
      setIsPlaying(true);
      isPlayingRef.current = true;
      lastTimeRef.current = performance.now();
      requestRef.current = requestAnimationFrame(playLoop);
    }
  };

  const playLoop = (time: number) => {
    if (!isPlayingRef.current) return;

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;

    // BPM to beats per second
    const bps = track.bpm / 60;
    // Delta time in seconds * beats per second
    const deltaBeats = (deltaTime / 1000) * bps;

    setCurrentBeat((prev) => {
      const nextBeat = prev + deltaBeats;
      
      // Look for notes starting between prev and nextBeat
      const synth = getSynth();
      if (synth) {
        track.notes.forEach(n => {
          if (n.startTime >= prev && n.startTime < nextBeat) {
            const noteId = synth.playNote(n.midi);
            // Quick and dirty schedule stop
            setTimeout(() => {
              synth.stopNote(n.midi, noteId);
            }, (n.duration / bps) * 1000);
          }
        });
      }

      // loop around loosely
      if (nextBeat > track.notes[track.notes.length - 1].startTime + 4) {
        return 0;
      }
      return nextBeat;
    });

    requestRef.current = requestAnimationFrame(playLoop);
  };

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col font-sans select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-8">
          <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">
            Play Along <span className="text-zinc-500">Piano</span>
          </h1>
          <div className="flex gap-2 items-center px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                isListening
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                  : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]",
              )}
            ></div>
            <span
              className={cn(
                "text-[10px] font-mono tracking-widest uppercase",
                isListening ? "text-emerald-400" : "text-red-400",
              )}
            >
              Mic {isListening ? "Active" : "Off"}
            </span>
          </div>
        </div>

        <div className="flex gap-6 items-center">
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase text-zinc-500 tracking-widest">
              Tempo
            </div>
            <div className="text-xl font-bold font-mono text-zinc-200 tracking-tighter">
              {track.bpm}{" "}
              <span className="text-xs text-zinc-600 font-sans">BPM</span>
            </div>
          </div>
          <button
            onClick={isListening ? stopListening : startListening}
            className="px-6 py-2 bg-zinc-100 text-zinc-950 rounded-full font-bold text-sm uppercase hover:bg-white transition-colors"
          >
            {isListening ? "Stop Mic" : "Start Mic"}
          </button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 p-6 flex flex-col gap-6 overflow-hidden">
        {error && (
          <div className="bg-red-500/20 text-red-400 p-4 rounded-lg border border-red-500/30 flex items-center justify-between">
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-6 relative">
          {(viewMode === "both" || viewMode === "sheet") && (
            <div
              className={cn(
                "transition-all duration-500 flex-1 relative rounded-2xl overflow-hidden shadow-inner border border-zinc-800 bg-[#F9F7F2]",
                viewMode === "sheet" ? "basis-full" : "basis-1/2",
              )}
            >
              <div className="absolute top-4 right-4 flex gap-2 bg-white/80 backdrop-blur border border-zinc-200 rounded-lg p-1 z-20">
                <button
                  onClick={() => setViewMode("sheet")}
                  className={cn(
                    "px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors",
                    viewMode === "sheet"
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:text-zinc-900",
                  )}
                >
                  Sheet
                </button>
                <button
                  onClick={() => setViewMode("keyboard")}
                  className={cn(
                    "px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors",
                    viewMode === "keyboard"
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:text-zinc-900",
                  )}
                >
                  Keys
                </button>
                <button
                  onClick={() => setViewMode("synthesia")}
                  className={cn(
                    "px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors",
                    viewMode === "synthesia"
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:text-zinc-900",
                  )}
                >
                  Flow
                </button>
                <button
                  onClick={() => setViewMode("both")}
                  className={cn(
                    "px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors",
                    viewMode === "both"
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:text-zinc-900",
                  )}
                >
                  Split
                </button>
              </div>

              <SheetMusic
                track={track}
                currentBeat={currentBeat}
                expectedNotes={expectedNotes}
                playedNotes={playedNotesFinal}
              />
            </div>
          )}

          {(viewMode === "both" || viewMode === "keyboard" || viewMode === "synthesia") && (
            <div
              className={cn(
                "transition-all duration-500 flex-1 relative rounded-t-xl overflow-hidden shadow-2xl p-1 flex flex-col",
                viewMode === "keyboard" || viewMode === "synthesia" ? "basis-full" : "basis-1/2",
                viewMode === "synthesia" ? "bg-black" : "bg-zinc-800"
              )}
            >
              <div className="absolute top-4 right-4 text-[10px] font-mono tracking-widest uppercase text-zinc-500 bg-black/50 px-3 py-1 rounded-full z-20">
                MIDI:{" "}
                {playedNotesFinal.length > 0
                  ? playedNotesFinal.join(", ")
                  : "--"}
              </div>
              
              {viewMode === "synthesia" && (
                <FallingNotes track={track} currentBeat={currentBeat} startMidi={21} endMidi={108} />
              )}
              
              <PianoKeyboard
                startMidi={21}
                endMidi={108}
                activeNotes={activeNotes}
                expectedNotes={expectedNotes}
                playedNotes={playedNotesFinal}
                onSynthesizedNoteChanged={setSynthesizedNote}
              />
            </div>
          )}
        </div>
      </main>

      {/* Bottom Control Bar */}
      <footer className="h-24 bg-zinc-900 border-t border-zinc-800 px-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-10">
          <div className="flex gap-4">
            <button
              onClick={() => {
                setCurrentBeat(0);
                setIsPlaying(false);
              }}
              className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={togglePlayback}
              className="w-12 h-12 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center hover:bg-emerald-400 transition-colors"
            >
              {isPlaying ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-1" />
              )}
            </button>
          </div>
          <div className="w-96 h-1.5 bg-zinc-800 rounded-full overflow-hidden relative">
            <div
              className="absolute h-full w-1/3 bg-zinc-100 transition-all duration-100"
              style={{
                width: `${Math.min(100, (currentBeat / (track.notes[track.notes.length - 1].startTime + 4)) * 100)}%`,
              }}
            ></div>
          </div>
          <div className="font-mono text-sm tracking-tighter text-zinc-400">
            {Math.floor(currentBeat).toString().padStart(3, "0")} bts
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[9px] font-mono uppercase text-zinc-500 tracking-widest mb-1">
              Signal
            </span>
            <div className="flex gap-1">
              <div
                className={cn(
                  "w-1 h-3",
                  isListening ? "bg-emerald-500" : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  isListening ? "bg-emerald-500" : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  isListening ? "bg-emerald-500" : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  isListening && playedNotesFinal.length > 0
                    ? "bg-emerald-500"
                    : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  isListening && playedNotesFinal.length > 0
                    ? "bg-emerald-500"
                    : "bg-zinc-700",
                )}
              ></div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
