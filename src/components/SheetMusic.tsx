import React, { useEffect, useRef, useState } from "react";
// The default "vexflow" entry embeds six music fonts (~1 MB); only Bravura is used.
import { Accidental, Formatter, Renderer, Stave, StaveNote, TickContext } from "vexflow/bravura";
import type { Transport } from "../lib/transport";
import { lowerBound, parseKey, soundingKey, type TrackTiming } from "../lib/trackTiming";
import { useTransportValue } from "../hooks/useTransport";

interface SheetMusicProps {
  timing: TrackTiming;
  transport: Transport;
  playedNotes?: number[];
}

const NOTE_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
const MEASURE_LENGTH = 4;
const NO_NOTES: number[] = [];

interface RenderedGroup {
  /** Indexes into timing.notes that this StaveNote shows. */
  indexes: number[];
  el: SVGElement | null;
}

function setClass(el: SVGElement, cls: string, on: boolean) {
  if (on) el.classList.add(cls);
  else el.classList.remove(cls);
}

/**
 * VexFlow is comparatively slow, so the stave is only re-rendered when the
 * visible measures change. The highlight on the notes that are sounding is
 * updated by toggling CSS classes on the existing SVG.
 */
const SheetMusicImpl: React.FC<SheetMusicProps> = ({ timing, transport, playedNotes = NO_NOTES }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const measureIndex = useTransportValue(transport, (t) => Math.floor(t.beat / MEASURE_LENGTH));
  const sounding = useTransportValue(transport, (t) => soundingKey(timing, t.beat));
  const renderedRef = useRef<RenderedGroup[]>([]);
  const highlightRef = useRef({ sounding, playedNotes });
  highlightRef.current = { sounding, playedNotes };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (width: number) => {
      if (width > 0) setContainerWidth(width);
    };
    update(el.getBoundingClientRect().width);
    // ResizeObserver is missing before iOS 13.4; fall back to window resizes there.
    if (typeof ResizeObserver === "undefined") {
      const onResize = () => update(el.getBoundingClientRect().width);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const observer = new ResizeObserver((entries) => update(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const applyHighlights = () => {
    const { sounding, playedNotes } = highlightRef.current;
    const soundingSet = new Set(parseKey(sounding));
    const played = new Set(playedNotes);
    for (const group of renderedRef.current) {
      if (!group.el) continue;
      let isCurrent = false;
      let anyPlayed = false;
      for (const i of group.indexes) {
        if (!soundingSet.has(i)) continue;
        isCurrent = true;
        if (played.has(timing.notes[i].midi)) anyPlayed = true;
      }
      setClass(group.el, "sheet-note-current", isCurrent && !anyPlayed);
      setClass(group.el, "sheet-note-played", isCurrent && anyPlayed);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || containerWidth === 0) return;

    container.innerHTML = "";
    renderedRef.current = [];

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    const height = 200;
    renderer.resize(containerWidth, height);

    const context = renderer.getContext();
    context.setFont("Arial", 10, "").setBackgroundFillStyle("#F9F7F2");

    const stave = new Stave(10, 40, containerWidth - 20);
    stave.addClef("treble").addTimeSignature("4/4");
    stave.setContext(context).draw();

    const maxVisibleMeasures = Math.max(1, Math.floor((containerWidth - 100) / 150));
    const from = measureIndex * MEASURE_LENGTH;
    const to = (measureIndex + maxVisibleMeasures) * MEASURE_LENGTH;

    // Group the visible notes into chords, quantized slightly.
    const groups = new Map<number, number[]>();
    for (let i = lowerBound(timing.starts, from); i < timing.notes.length && timing.starts[i] < to; i++) {
      const quantTime = Math.round(timing.starts[i] * 16) / 16;
      const group = groups.get(quantTime);
      if (group) group.push(i);
      else groups.set(quantTime, [i]);
    }
    if (groups.size === 0) return;

    const vexNotes: StaveNote[] = [];
    const rendered: RenderedGroup[] = [];

    Array.from(groups.keys())
      .sort((a, b) => a - b)
      .forEach((time) => {
        const indexes = groups.get(time)!;
        const notes = indexes.map((i) => timing.notes[i]);
        const maxDuration = Math.max(...notes.map((n) => n.duration));

        let duration = "q";
        if (maxDuration <= 0.25) duration = "16";
        else if (maxDuration <= 0.5) duration = "8";
        else if (maxDuration <= 1) duration = "q";
        else if (maxDuration <= 2) duration = "h";
        else duration = "w";

        // VexFlow rejects duplicate keys in a chord; sort by pitch.
        const midis = Array.from(new Set(notes.map((n) => n.midi))).sort((a, b) => a - b);
        const keys = midis.map((m) => `${NOTE_NAMES[m % 12].replace("#", "")}/${Math.max(0, Math.floor(m / 12) - 1)}`);

        try {
          const staveNote = new StaveNote({ keys, duration });
          midis.forEach((m, index) => {
            if (NOTE_NAMES[m % 12].includes("#")) staveNote.addModifier(new Accidental("#"), index);
          });
          vexNotes.push(staveNote);
          rendered.push({ indexes, el: null });
        } catch (err) {
          console.warn("Failed to create StaveNote", keys, err);
        }
      });

    if (vexNotes.length === 0) return;

    try {
      Formatter.FormatAndDraw(context, stave, vexNotes);
    } catch (e) {
      console.warn("VexFlow formatting error:", e);
      // Rough fallback just in case
      let startX = stave.getNoteStartX();
      vexNotes.forEach((note) => {
        try {
          note.setStave(stave);
          note.setContext(context);
          const tickContext = new TickContext();
          tickContext.addTickable(note);
          tickContext.preFormat().setX(startX);
          note.draw();
          startX += 60;
        } catch (noteErr) {
          console.error("VexFlow failed to draw note:", noteErr);
        }
      });
    }

    vexNotes.forEach((note, i) => {
      rendered[i].el = (note.getSVGElement() as SVGElement | undefined) ?? null;
    });
    renderedRef.current = rendered;
    applyHighlights();
  }, [timing, measureIndex, containerWidth]);

  // applyHighlights reads the latest values from highlightRef.
  useEffect(() => {
    applyHighlights();
  }, [sounding, playedNotes]);

  return (
    <div className="w-full h-full min-h-[200px] bg-transparent rounded-md flex items-center justify-center p-4">
      <div ref={containerRef} className="w-full max-w-5xl h-full" />
    </div>
  );
};

const SheetMusic = React.memo(SheetMusicImpl);
export default SheetMusic;
