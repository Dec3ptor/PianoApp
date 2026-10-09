import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  BookmarkPlus,
  X,
} from "lucide-react";
import { PianoKeyboard } from "./components/PianoKeyboard";
import { FallingNotes } from "./components/FallingNotes";
import { MarkerPin } from "./components/MarkerPin";
import { SettingsMenu } from "./components/SettingsMenu";
import { MOONLIGHT_SONATA } from "./lib/trackData";
import { usePitchDetector } from "./hooks/usePitchDetector";
import { useMidiInput, type MidiStatus } from "./hooks/useMidiInput";
import { useIsMobile, useWakeLock } from "./hooks/useDeviceCaps";
import { useTransportValue } from "./hooks/useTransport";
import { cn } from "./lib/utils";
import { installAudioUnlock } from "./lib/audioContext";
import { preloadPianoSamples } from "./lib/piano";
import { Transport } from "./lib/transport";
import { buildTrackTiming, chordIndexAt, parseKey, soundingKey } from "./lib/trackTiming";

// VexFlow is large and only needed by the sheet view, so it loads on demand.
const SheetMusic = lazy(() => import("./components/SheetMusic"));

const SPEED_MIN = 0.25;
const SPEED_MAX = 1.5;
const SPEED_STEP = 0.05;
const LEAD_IN_BEATS = 4;

type ViewMode = "both" | "sheet" | "keyboard" | "synthesia";

export default function App() {
  const isMobile = useIsMobile();
  // On mobile, default to a single view (Flow) instead of "both" which
  // renders the sheet music + keyboard simultaneously and is much heavier.
  const [viewMode, setViewMode] = useState<ViewMode>(isMobile ? "synthesia" : "both");

  const { midiNotes, isListening, startListening, stopListening, error } =
    usePitchDetector();
  const {
    midiNotes: keyboardMidiNotes,
    isConnected: midiConnected,
    deviceNames: midiDeviceNames,
    error: midiError,
    supported: midiSupported,
    status: midiStatus,
    connect: connectMidi,
    dismissError: dismissMidiError,
  } = useMidiInput();
  const [touchNotes, setTouchNotes] = useState<number[]>([]);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const track = MOONLIGHT_SONATA;
  const timing = useMemo(() => buildTrackTiming(track), [track]);

  // ── Playback ─────────────────────────────────────────────────────────────
  // The transport owns the playhead and schedules the audio. App only
  // re-renders when something derived from the playhead changes (a note
  // starts or ends, a new chord in practice mode), not on every frame.
  const transport = useMemo(
    () => new Transport(timing, track.bpm, -LEAD_IN_BEATS, timing.lastStart + 4),
    [timing, track.bpm],
  );
  const isPlaying = useTransportValue(transport, (t) => t.playing);
  useEffect(() => {
    transport.setSpeed(playbackSpeed);
  }, [transport, playbackSpeed]);
  useEffect(() => () => transport.pause(), [transport]);

  // Unlock audio on the first tap and fetch/decode this piece's samples while
  // the page is idle, so the first press of Play doesn't wait on (or stutter
  // through) sample loading.
  useEffect(() => {
    const removeUnlock = installAudioUnlock();
    const id = window.setTimeout(() => preloadPianoSamples(timing.midisByFirstUse), 300);
    return () => {
      removeUnlock();
      window.clearTimeout(id);
    };
  }, [timing]);

  // A hidden tab gets no animation frames and iOS suspends its audio, so
  // pause rather than drift out of sync.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) transport.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [transport]);

  // ── Practice mode ────────────────────────────────────────────────────────
  const [practiceMode, setPracticeMode] = useState(false);
  const chords = timing.chords;

  // Total beats including a tail so the progress bar / marker positions stay
  // anchored relative to the whole track regardless of mode.
  const totalBeats = timing.endBeat + LEAD_IN_BEATS;

  // ── Markers ──────────────────────────────────────────────────────────────
  // User-defined jump points (beat positions). Persisted per-track so each
  // song keeps its own set of bookmarks.
  const markerStorageKey = `pianoapp.markers:${track.title}`;
  const [markers, setMarkers] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(markerStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.filter((n) => typeof n === "number");
      }
    } catch { /* no-op */ }
    return [];
  });
  useEffect(() => {
    try {
      localStorage.setItem(markerStorageKey, JSON.stringify(markers));
    } catch { /* no-op */ }
  }, [markers, markerStorageKey]);

  const addMarker = () => {
    const beat = Math.max(0, transport.beat);
    setMarkers((prev) => {
      // Avoid duplicates within a quarter beat of an existing marker.
      if (prev.some((m) => Math.abs(m - beat) < 0.25)) return prev;
      return [...prev, beat].sort((a, b) => a - b);
    });
  };
  const removeMarker = (beat: number) => {
    setMarkers((prev) => prev.filter((m) => m !== beat));
  };
  const jumpToBeat = (beat: number) => transport.seek(beat);

  // ── Settings: persisted preferences ──────────────────────────────────────
  const [effectsEnabled, setEffectsEnabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("pianoapp.effectsEnabled");
      // Default OFF on low-power devices, ON elsewhere.
      if (v === null) return !isMobile;
      return v === "true";
    } catch { return !isMobile; }
  });
  useEffect(() => {
    try { localStorage.setItem("pianoapp.effectsEnabled", String(effectsEnabled)); }
    catch { /* no-op */ }
  }, [effectsEnabled]);

  const [keyboardDim, setKeyboardDim] = useState<number>(() => {
    try { const v = localStorage.getItem("pianoapp.keyboardDim"); return v ? Number(v) : 0.55; }
    catch { return 0.55; }
  });
  useEffect(() => {
    try { localStorage.setItem("pianoapp.keyboardDim", String(keyboardDim)); }
    catch { /* no-op */ }
  }, [keyboardDim]);

  // ── Memoize the union of all "currently pressed" notes ───────────────────
  const { activeNotes, playedNotesFinal } = useMemo(() => {
    const set = new Set<number>();
    midiNotes.forEach((n) => set.add(n));
    keyboardMidiNotes.forEach((n) => set.add(n));
    touchNotes.forEach((n) => set.add(n));
    return {
      activeNotes: set,
      playedNotesFinal: Array.from(set).sort((a, b) => a - b),
    };
  }, [midiNotes, keyboardMidiNotes, touchNotes]);

  // In practice mode the user scrolls the playhead freely; the "expected"
  // chord is whichever chord sits closest to (and at or after) the playhead.
  // This decouples the visual scroll position from the integer chord index,
  // so dragging feels like a normal page scroll rather than a snap-step.
  const expectedChordIndex = useTransportValue(transport, (t) =>
    practiceMode ? chordIndexAt(timing, t.beat) : -1,
  );
  // Notes sounding at the playhead, as a string key so this only re-renders
  // when a note starts or stops.
  const sounding = useTransportValue(transport, (t) => soundingKey(timing, t.beat));

  // ── Expected notes depend on mode ────────────────────────────────────────
  const expectedNotes = useMemo(() => {
    // Notes still inside their own sustain window at the current beat.
    const sustained = parseKey(sounding).map((i) => timing.notes[i].midi);
    if (practiceMode) {
      // Union of (current chord target) + (still-sustaining notes) so a held
      // bass/long note stays "expected" — and therefore green — after the
      // chord index has auto-advanced past its start.
      const chordMidis = expectedChordIndex >= 0 ? chords[expectedChordIndex].midis : [];
      return Array.from(new Set<number>([...chordMidis, ...sustained]));
    }
    return sustained;
  }, [practiceMode, chords, expectedChordIndex, timing, sounding]);

  // Keep the screen awake for the entire app session so the iPad doesn't
  // auto-lock while reading sheet music or practicing. Falls back to a silent
  // looping video on older iOS where the Wake Lock API is missing.
  useWakeLock(true);

  // ── Practice mode: rising-edge press detection ───────────────────────────
  // Track which expected notes have been freshly pressed (key-down rising edge)
  // since this chord became active. We advance the moment every expected note
  // has been pressed at least once — they don't have to be held simultaneously,
  // and there is no debounce/delay so fast playing isn't capped.
  const pressedThisChordRef = useRef<Set<number>>(new Set());
  const prevActiveRef = useRef<Set<number>>(new Set());

  // Reset the rising-edge tracker whenever the target chord changes.
  const lastChordIndexRef = useRef(-1);
  useEffect(() => {
    if (expectedChordIndex !== lastChordIndexRef.current) {
      pressedThisChordRef.current = new Set();
      lastChordIndexRef.current = expectedChordIndex;
    }
  }, [expectedChordIndex]);

  const goToChord = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), chords.length - 1);
      if (clamped >= 0) transport.seek(chords[clamped].beat);
    },
    [chords, transport],
  );

  useEffect(() => {
    if (!practiceMode) {
      prevActiveRef.current = activeNotes;
      return;
    }
    const expected = expectedChordIndex >= 0 ? chords[expectedChordIndex]?.midis : undefined;
    if (!expected || expected.length === 0) {
      prevActiveRef.current = activeNotes;
      return;
    }
    // For every expected note, record a hit when it transitions from
    // not-active → active (a real keystroke rather than a held key).
    const prev = prevActiveRef.current;
    const pressed = pressedThisChordRef.current;
    for (let i = 0; i < expected.length; i++) {
      const n = expected[i];
      if (activeNotes.has(n) && !prev.has(n)) pressed.add(n);
    }
    prevActiveRef.current = activeNotes;
    // Advance immediately once every expected note has been pressed.
    let allPressed = true;
    for (let i = 0; i < expected.length; i++) {
      if (!pressed.has(expected[i])) { allPressed = false; break; }
    }
    if (allPressed) goToChord(expectedChordIndex + 1);
  }, [practiceMode, activeNotes, expectedChordIndex, chords, goToChord]);

  // ── Practice mode: stop time-based playback when entering ─────────────────
  useEffect(() => {
    if (practiceMode) transport.pause();
  }, [practiceMode, transport]);

  // ── Keyboard navigation for practice mode ────────────────────────────────
  useEffect(() => {
    if (!practiceMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goToChord(expectedChordIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToChord(expectedChordIndex - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [practiceMode, expectedChordIndex, goToChord]);

  // Dragging the falling notes in practice mode scrubs through the piece.
  const navigateByDrag = useCallback(
    (deltaBeat: number) => transport.seek(Math.max(0, transport.beat + deltaBeat)),
    [transport],
  );

  const togglePlayback = () => {
    if (transport.playing) transport.pause();
    else transport.play();
  };

  const stopPlayback = () => {
    transport.pause();
    transport.seek(-LEAD_IN_BEATS);
  };

  return (
    <div className="app-root bg-zinc-950 text-white flex flex-col font-sans select-none">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 md:px-8 md:py-6 border-b border-zinc-800 bg-zinc-950">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <h1 className="text-2xl md:text-4xl font-black tracking-tighter uppercase leading-none">
            Play Along <span className="text-zinc-500">Piano</span>
          </h1>
          <div className="flex flex-wrap gap-2">
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
            <MidiStatusPill
              supported={midiSupported}
              status={midiStatus}
              connected={midiConnected}
              deviceNames={midiDeviceNames}
              onConnect={connectMidi}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1 items-center bg-zinc-900 border border-zinc-800 rounded-full p-1">
            {(["sheet", "keyboard", "synthesia", "both"] as const).map((m) => {
              const label =
                m === "sheet"
                  ? "Sheet"
                  : m === "keyboard"
                    ? "Keys"
                    : m === "synthesia"
                      ? "Flow"
                      : "Split";
              return (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors",
                    viewMode === m && !practiceMode
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {/* Practice mode toggle */}
          <button
            onClick={() => setPracticeMode((p) => !p)}
            title="Practice mode – play each chord at your own pace"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors border",
              practiceMode
                ? "bg-violet-600 border-violet-400 text-white shadow-[0_0_12px_rgba(139,92,246,0.5)]"
                : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-100",
            )}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            Practice
          </button>
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase text-zinc-500 tracking-widest">
              Tempo
            </div>
            <div className="text-xl font-bold font-mono text-zinc-200 tracking-tighter">
              {Math.round(track.bpm * playbackSpeed)}{" "}
              <span className="text-xs text-zinc-600 font-sans">BPM</span>
              {playbackSpeed !== 1 && (
                <span className="text-[10px] text-zinc-500 font-sans ml-2">
                  ({track.bpm} &times; {playbackSpeed.toFixed(2)})
                </span>
              )}
            </div>
          </div>
          <button
            onClick={isListening ? stopListening : startListening}
            className="px-4 md:px-6 py-2 bg-zinc-100 text-zinc-950 rounded-full font-bold text-sm uppercase hover:bg-white transition-colors"
          >
            {isListening ? "Stop Mic" : "Start Mic"}
          </button>
          <SettingsMenu
            effectsEnabled={effectsEnabled}
            onEffectsChange={setEffectsEnabled}
            keyboardDim={keyboardDim}
            onKeyboardDimChange={setKeyboardDim}
          />
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 p-2 sm:p-4 md:p-6 flex flex-col gap-3 md:gap-6 overflow-hidden">
        {error && (
          <div className="bg-red-500/20 text-red-400 p-4 rounded-lg border border-red-500/30 flex items-center justify-between">
            <span>{error}</span>
          </div>
        )}
        {midiError && midiSupported && (
          <div
            role="status"
            className="bg-amber-500/10 text-amber-200 p-3 md:p-4 rounded-lg border border-amber-500/30 flex items-start justify-between gap-3"
          >
            <span className="text-sm leading-relaxed">{midiError}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={connectMidi}
                className="px-3 py-1 rounded-full border border-amber-500/50 text-[10px] font-bold uppercase tracking-widest text-amber-200 hover:bg-amber-500/20 transition-colors"
              >
                Connect MIDI
              </button>
              <button
                type="button"
                onClick={dismissMidiError}
                aria-label="Dismiss"
                className="w-7 h-7 rounded-full flex items-center justify-center text-amber-300/80 hover:bg-amber-500/20 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-3 md:gap-6 relative">
          {(viewMode === "both" || viewMode === "sheet") && (
            <div
              className={cn(
                "transition-all duration-500 flex-1 relative rounded-2xl overflow-hidden shadow-inner border border-zinc-800 bg-[#F9F7F2]",
                viewMode === "sheet" ? "basis-full" : "basis-1/2",
              )}
            >
              <Suspense
                fallback={
                  <div className="w-full h-full min-h-[200px] flex items-center justify-center text-xs font-mono uppercase tracking-widest text-zinc-400">
                    Loading sheet music…
                  </div>
                }
              >
                <SheetMusic timing={timing} transport={transport} playedNotes={playedNotesFinal} />
              </Suspense>
            </div>
          )}

          {(viewMode === "both" || viewMode === "keyboard" || viewMode === "synthesia") && (
            <div
              className={cn(
                "transition-all duration-500 flex-1 relative overflow-hidden shadow-2xl flex flex-col",
                viewMode === "keyboard" || viewMode === "synthesia" ? "basis-full" : "basis-1/2",
                viewMode === "synthesia"
                  ? "rounded-2xl border border-zinc-800 bg-black"
                  : "rounded-t-xl p-1 bg-zinc-800"
              )}
            >
              <div className="absolute top-4 right-4 text-[10px] font-mono tracking-widest uppercase text-zinc-500 bg-black/50 px-3 py-1 rounded-full z-20">
                MIDI:{" "}
                {playedNotesFinal.length > 0
                  ? playedNotesFinal.join(", ")
                  : "--"}
              </div>

              {viewMode === "synthesia" ? (
                <>
                  <div className="flex-1 min-h-0 flex px-2 pt-2 pb-0">
                    <div className="flex-1 min-h-[260px] rounded-t-2xl overflow-hidden border border-zinc-800/80 bg-black relative">
                      <FallingNotes
                        timing={timing}
                        transport={transport}
                        expectedNotes={expectedNotes}
                        playedNotes={playedNotesFinal}
                        startMidi={21}
                        endMidi={108}
                        onNavigate={practiceMode ? navigateByDrag : undefined}
                      />
                    </div>
                  </div>

                  <div className="h-[190px] shrink-0 px-2 pb-2 pt-3 border-t border-zinc-800 bg-gradient-to-b from-zinc-950 to-black">
                    <PianoKeyboard
                      startMidi={21}
                      endMidi={108}
                      activeNotes={activeNotes}
                      expectedNotes={expectedNotes}
                      playedNotes={playedNotesFinal}
                      variant="flow"
                      dim={effectsEnabled ? keyboardDim : 1}
                      topLight={effectsEnabled}
                      onTouchNotesChange={setTouchNotes}
                    />
                  </div>
                </>
              ) : (
                <PianoKeyboard
                  startMidi={21}
                  endMidi={108}
                  activeNotes={activeNotes}
                  expectedNotes={expectedNotes}
                  playedNotes={playedNotesFinal}
                  onTouchNotesChange={setTouchNotes}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom Control Bar */}
      <footer className="min-h-24 bg-zinc-900 border-t border-zinc-800 px-4 py-3 md:px-8 flex flex-wrap items-center justify-between gap-x-10 gap-y-3 z-10">
        <div className="flex flex-wrap items-center gap-x-4 md:gap-x-10 gap-y-3">
          {practiceMode ? (
            /* ── Practice mode controls ───────────────────────────── */
            <div className="flex items-center gap-3">
              <button
                onClick={() => goToChord(expectedChordIndex - 1)}
                disabled={expectedChordIndex <= 0}
                className="w-12 h-12 rounded-full border border-violet-700 flex items-center justify-center text-violet-300 hover:bg-violet-900/50 disabled:opacity-30 transition-colors"
                title="Previous chord (←)"
                aria-label="Previous chord"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex flex-col items-center min-w-[80px]">
                <span className="text-[9px] font-mono uppercase text-violet-400 tracking-widest">Chord</span>
                <span className="text-xl font-bold font-mono text-violet-200">
                  {expectedChordIndex + 1}
                  <span className="text-xs text-zinc-500 font-sans"> / {chords.length}</span>
                </span>
              </div>
              <button
                onClick={() => goToChord(expectedChordIndex + 1)}
                disabled={expectedChordIndex >= chords.length - 1}
                className="w-12 h-12 rounded-full border border-violet-700 flex items-center justify-center text-violet-300 hover:bg-violet-900/50 disabled:opacity-30 transition-colors"
                title="Next chord (→)"
                aria-label="Next chord"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => transport.seek(0)}
                className="ml-2 px-3 py-1 rounded-full border border-zinc-700 text-[10px] font-mono uppercase text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
                title="Restart from beginning"
              >
                Restart
              </button>
            </div>
          ) : (
            /* ── Normal play controls ─────────────────────────────── */
            <div className="flex gap-4">
              <button
                onClick={stopPlayback}
                aria-label="Stop"
                title="Stop and rewind"
                className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:bg-zinc-800 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
              <button
                onClick={togglePlayback}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="w-12 h-12 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center hover:bg-emerald-400 transition-colors"
              >
                {isPlaying ? (
                  <Square className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-1" />
                )}
              </button>
            </div>
          )}
          {/* Progress bar with marker pins overlaid above (no extra layout
              space taken — pins are absolutely positioned). */}
          <div className="relative w-40 sm:w-64 xl:w-96">
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden relative">
              <ProgressFill
                transport={transport}
                totalBeats={totalBeats}
                className={practiceMode ? "bg-violet-400" : "bg-zinc-100"}
              />
            </div>
            {markers.map((beat, i) => (
              <MarkerPin
                key={`${beat}-${i}`}
                index={i + 1}
                position={Math.min(100, Math.max(0, (beat / totalBeats) * 100))}
                onJump={() => jumpToBeat(beat)}
                onRemove={() => removeMarker(beat)}
              />
            ))}
          </div>
          <button
            onClick={addMarker}
            title="Add marker at current position"
            aria-label="Add marker"
            className="w-8 h-8 rounded-full border border-amber-600/60 flex items-center justify-center text-amber-400 hover:bg-amber-900/30 transition-colors"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>
          <BeatCounter transport={transport} />
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] font-mono uppercase text-zinc-500 tracking-widest">
                Speed
              </span>
              <span className="text-[11px] font-mono tabular-nums text-zinc-200">
                {playbackSpeed.toFixed(2)}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlaybackSpeed(1)}
                className="text-[9px] font-mono uppercase text-zinc-500 hover:text-zinc-200 tracking-widest px-1"
                title="Reset to 1.00x"
              >
                1x
              </button>
              <input
                type="range"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                aria-label="Playback speed"
                className="w-32 sm:w-48 accent-emerald-500 cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-[8px] font-mono text-zinc-600 tracking-widest">
              <span>{SPEED_MIN.toFixed(2)}x</span>
              <span>{SPEED_MAX.toFixed(2)}x</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] font-mono uppercase text-zinc-500 tracking-widest mb-1">
              Signal
            </span>
            <div className="flex gap-1">
              <div
                className={cn(
                  "w-1 h-3",
                  isListening || midiConnected ? "bg-emerald-500" : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  isListening || midiConnected ? "bg-emerald-500" : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  isListening || midiConnected ? "bg-emerald-500" : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  (isListening || midiConnected) && playedNotesFinal.length > 0
                    ? "bg-emerald-500"
                    : "bg-zinc-700",
                )}
              ></div>
              <div
                className={cn(
                  "w-1 h-3",
                  (isListening || midiConnected) && playedNotesFinal.length > 0
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

/** Progress fill, moved directly from the transport (no React render per frame). */
function ProgressFill({
  transport,
  totalBeats,
  className,
}: {
  transport: Transport;
  totalBeats: number;
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const update = () => {
      const p = Math.min(1, Math.max(0, transport.beat / totalBeats));
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
    };
    update();
    return transport.subscribe(update);
  }, [transport, totalBeats]);
  return <div ref={ref} className={cn("absolute inset-0 origin-left", className)} />;
}

/** Whole-beat counter; re-renders once per beat. */
function BeatCounter({ transport }: { transport: Transport }) {
  const beat = useTransportValue(transport, (t) => Math.floor(t.beat));
  const digits = Math.abs(beat).toString().padStart(3, "0");
  return (
    <div className="font-mono text-sm tracking-tighter text-zinc-400 tabular-nums">
      {`${beat < 0 ? "-" : ""}${digits} bts`}
    </div>
  );
}

/**
 * Header MIDI status. While MIDI still has to be connected it is a button:
 * access is requested from a click unless it was already granted (Firefox
 * requires that, and it avoids prompting everyone on page load).
 */
function MidiStatusPill({
  supported,
  status,
  connected,
  deviceNames,
  onConnect,
}: {
  supported: boolean;
  status: MidiStatus;
  connected: boolean;
  deviceNames: string[];
  onConnect: () => void;
}) {
  const canConnect = status === "idle" || status === "blocked";
  const pillClass = "flex gap-2 items-center px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full";
  const content = (
    <>
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          !supported
            ? "bg-zinc-600"
            : connected
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
              : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]",
        )}
      ></div>
      <span
        className={cn(
          "text-[10px] font-mono tracking-widest uppercase truncate max-w-[200px]",
          !supported ? "text-zinc-500" : connected ? "text-emerald-400" : "text-amber-400",
        )}
      >
        {!supported
          ? "MIDI N/A"
          : status === "connecting"
            ? "MIDI: Connecting…"
            : canConnect
              ? "MIDI: Connect"
              : connected
                ? `MIDI: ${deviceNames[0]}`
                : "MIDI: No Device"}
      </span>
    </>
  );
  if (canConnect) {
    return (
      <button
        type="button"
        onClick={onConnect}
        title="Connect a MIDI keyboard"
        className={cn(pillClass, "cursor-pointer transition-colors hover:border-amber-500/60 hover:bg-zinc-800")}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className={pillClass}
      title={
        !supported
          ? "Web MIDI not supported in this browser"
          : connected
            ? `Connected: ${deviceNames.join(", ")}`
            : "No MIDI device detected"
      }
    >
      {content}
    </div>
  );
}
