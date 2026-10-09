import React, { useEffect, useMemo, useRef } from "react";
import { cn } from "../lib/utils";
import { getPiano } from "../lib/piano";
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
  /** Notes currently held on the on-screen keyboard (any number of fingers). */
  onTouchNotesChange?: (midis: number[]) => void;
}

const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);
const NO_NOTES: number[] = [];

type KeyState = "idle" | "expected" | "correct" | "wrong" | "active";

const BLACK_BASE = "absolute top-0 rounded-b-lg transition-colors duration-75 cursor-pointer touch-none z-10";
const WHITE_BASE =
  "flex-1 rounded-b-2xl transition-all duration-75 flex items-end justify-center pb-2 cursor-pointer touch-none relative z-0";

// Key colours per state. Glow shadows are desktop-only: they are expensive to
// composite on phones and tablets.
const KEY_CLASSES: Record<"black" | "white", Record<KeyState, [mobile: string, desktop: string]>> = {
  black: {
    idle: ["bg-zinc-950 border border-zinc-800", "bg-zinc-950 border border-zinc-800"],
    expected: [
      "bg-sky-500 border border-sky-300/60",
      "bg-sky-500 border border-sky-300/60 shadow-[0_0_16px_rgba(56,189,248,0.6),0_0_28px_rgba(59,130,246,0.28)]",
    ],
    correct: [
      "bg-emerald-400 border border-emerald-200/70",
      "bg-emerald-400 border border-emerald-200/70 shadow-[0_0_24px_rgba(74,222,128,0.95),0_0_54px_rgba(16,185,129,0.42)]",
    ],
    wrong: [
      "bg-rose-400 border border-rose-200/70",
      "bg-rose-400 border border-rose-200/70 shadow-[0_0_24px_rgba(251,113,133,0.95),0_0_54px_rgba(244,63,94,0.38)]",
    ],
    active: [
      "bg-emerald-500 border border-emerald-200/70",
      "bg-emerald-500 border border-emerald-200/70 shadow-[0_0_24px_rgba(16,185,129,0.85),0_0_44px_rgba(16,185,129,0.32)]",
    ],
  },
  white: {
    idle: [
      "bg-zinc-100 border-x border-b border-zinc-300/80",
      "bg-zinc-100 border-x border-b border-zinc-300/80",
    ],
    expected: [
      "bg-sky-300 border-x border-b border-sky-200",
      "bg-sky-300 border-x border-b border-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.55),inset_0_0_18px_rgba(255,255,255,0.35)]",
    ],
    correct: [
      "bg-emerald-300 border-x border-b border-emerald-100",
      "bg-emerald-300 border-x border-b border-emerald-100 shadow-[0_0_26px_rgba(110,231,183,1),0_0_60px_rgba(16,185,129,0.45),inset_0_0_22px_rgba(255,255,255,0.4)]",
    ],
    wrong: [
      "bg-rose-300 border-x border-b border-rose-100",
      "bg-rose-300 border-x border-b border-rose-100 shadow-[0_0_26px_rgba(253,164,175,0.95),0_0_60px_rgba(244,63,94,0.4),inset_0_0_22px_rgba(255,255,255,0.35)]",
    ],
    active: [
      "bg-emerald-400 border-x border-b border-emerald-100",
      "bg-emerald-400 border-x border-b border-emerald-100 shadow-[0_0_24px_rgba(16,185,129,0.8),0_0_54px_rgba(16,185,129,0.32),inset_0_0_22px_rgba(255,255,255,0.3)]",
    ],
  },
};

const SPOTLIGHT_GRADIENT =
  "linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.45) 18%, rgba(255,255,255,0.12) 45%, transparent 78%)";

interface KeyProps {
  midi: number;
  className: string;
  /** Black keys only: absolute position as CSS lengths. */
  left?: string;
  width?: string;
}

// Memoised so a state change re-renders only the keys whose colour changed.
const Key = React.memo(function Key({ midi, className, left, width }: KeyProps) {
  if (left !== undefined) {
    return <div data-midi={midi} className={className} style={{ left, width, height: "60%" }} />;
  }
  return (
    <div data-midi={midi} className={className}>
      {midi % 12 === 0 && (
        <span className="absolute bottom-4 left-0 right-0 text-center text-[10px] font-mono text-zinc-500 pointer-events-none">
          C{midi / 12 - 1}
        </span>
      )}
    </div>
  );
});

const PianoKeyboardImpl: React.FC<PianoKeyboardProps> = ({
  activeNotes,
  expectedNotes = NO_NOTES,
  playedNotes = NO_NOTES,
  startMidi = 48,
  endMidi = 84,
  variant = "default",
  dim = 1,
  topLight = false,
  onTouchNotesChange,
}) => {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const onTouchNotesChangeRef = useRef(onTouchNotesChange);
  onTouchNotesChangeRef.current = onTouchNotesChange;

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

  // ── On-screen key presses ───────────────────────────────────────────────
  // Handled on the container: every finger is tracked separately (chords),
  // sliding across keys plays each one (glissando), and old iOS without
  // Pointer Events falls back to touch events.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const byPointer = new Map<number, number>();
    const holdCount = new Map<number, number>();

    const notify = () =>
      onTouchNotesChangeRef.current?.(Array.from(holdCount.keys()).sort((a, b) => a - b));
    const keyAt = (x: number, y: number): number | null => {
      const hit = document.elementFromPoint(x, y);
      const keyEl = hit && hit.closest ? hit.closest("[data-midi]") : null;
      return keyEl && el.contains(keyEl) ? Number(keyEl.getAttribute("data-midi")) : null;
    };
    const press = (midi: number) => {
      const n = holdCount.get(midi) || 0;
      holdCount.set(midi, n + 1);
      if (n === 0) {
        getPiano()?.noteOn(midi);
        notify();
      }
    };
    const release = (midi: number) => {
      const n = holdCount.get(midi) || 0;
      if (n > 1) {
        holdCount.set(midi, n - 1);
        return;
      }
      holdCount.delete(midi);
      getPiano()?.noteOff(midi);
      notify();
    };
    const down = (id: number, x: number, y: number): boolean => {
      const midi = keyAt(x, y);
      if (midi === null) return false;
      up(id);
      byPointer.set(id, midi);
      press(midi);
      return true;
    };
    const move = (id: number, x: number, y: number) => {
      const current = byPointer.get(id);
      if (current === undefined) return;
      const midi = keyAt(x, y);
      if (midi === null || midi === current) return;
      byPointer.set(id, midi);
      press(midi);
      release(current);
    };
    const up = (id: number) => {
      const current = byPointer.get(id);
      if (current === undefined) return;
      byPointer.delete(id);
      release(current);
    };

    const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
    const on = <E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      listeners.push([target, type, fn as EventListener, opts]);
    };

    if (typeof window.PointerEvent === "function") {
      on<PointerEvent>(el, "pointerdown", (e) => {
        if (e.button !== 0 || !down(e.pointerId, e.clientX, e.clientY)) return;
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* no-op */
        }
      });
      on<PointerEvent>(el, "pointermove", (e) => move(e.pointerId, e.clientX, e.clientY));
      on<PointerEvent>(el, "pointerup", (e) => up(e.pointerId));
      on<PointerEvent>(el, "pointercancel", (e) => up(e.pointerId));
    } else {
      const each = (e: TouchEvent, fn: (t: Touch) => void) => {
        for (let i = 0; i < e.changedTouches.length; i++) fn(e.changedTouches[i]);
      };
      const nonPassive = { passive: false };
      on<TouchEvent>(el, "touchstart", (e) => {
        e.preventDefault();
        each(e, (t) => down(t.identifier, t.clientX, t.clientY));
      }, nonPassive);
      on<TouchEvent>(el, "touchmove", (e) => {
        e.preventDefault();
        each(e, (t) => move(t.identifier, t.clientX, t.clientY));
      }, nonPassive);
      on<TouchEvent>(el, "touchend", (e) => each(e, (t) => up(t.identifier)));
      on<TouchEvent>(el, "touchcancel", (e) => each(e, (t) => up(t.identifier)));
      const MOUSE = -1;
      on<MouseEvent>(el, "mousedown", (e) => {
        if (e.button === 0 && down(MOUSE, e.clientX, e.clientY)) e.preventDefault();
      });
      on<MouseEvent>(window, "mousemove", (e) => move(MOUSE, e.clientX, e.clientY));
      on<MouseEvent>(window, "mouseup", () => up(MOUSE));
    }

    return () => {
      listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
      Array.from(byPointer.keys()).forEach(up);
    };
  }, []);

  const variantIndex = isMobile ? 0 : 1;

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full h-full flex rounded-b-2xl relative touch-none select-none bg-transparent",
        // Allow surround glow to spill above the keyboard when stage lighting is on.
        topLight ? "" : "overflow-hidden",
        variant === "flow" ? "min-h-[180px]" : "min-h-[150px] max-h-[300px]",
      )}
    >
      {keys.map((key) => {
        const isActive = activeNotes.has(key.midi);
        const isExpected = expectedSet.has(key.midi);
        const isPlayed = playedSet.has(key.midi);
        // Green when correctly pressed OR actively held during an expected window.
        const state: KeyState =
          (isPlayed || isActive) && isExpected
            ? "correct"
            : isPlayed
              ? "wrong"
              : isActive
                ? "active"
                : isExpected
                  ? "expected"
                  : "idle";
        if (key.isBlack) {
          const leftPos = key.precedingWhite * whiteKeyWidth;
          return (
            <Key
              key={key.midi}
              midi={key.midi}
              className={`${BLACK_BASE} ${KEY_CLASSES.black[state][variantIndex]}`}
              left={`calc(${leftPos}% - ${whiteKeyWidth / 3}%)`}
              width={`${whiteKeyWidth / 1.5}%`}
            />
          );
        }
        return (
          <Key key={key.midi} midi={key.midi} className={`${WHITE_BASE} ${KEY_CLASSES.white[state][variantIndex]}`} />
        );
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
              background: SPOTLIGHT_GRADIENT,
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
