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

const BLACK_BASE =
  "absolute top-0 rounded-b-[3px] border border-black transition-colors duration-75 cursor-pointer touch-none z-10";
const WHITE_BASE =
  "flex-1 rounded-b-[4px] border-x border-b border-black/40 transition-colors duration-75 flex items-end justify-center pb-2 cursor-pointer touch-none relative";

// Realistic keys: white keys shaded like ivory with a darker lip at the front,
// black keys glossy with a lighter front edge. Expected keys light up mint like
// the falling notes, correct ones glow near-white, wrong ones rose. Glow
// shadows are desktop-only (expensive to composite on phones/tablets) and kept
// tight, so the light stays on the key instead of tinting its neighbours.
const BLACK_CORRECT =
  "bg-[linear-gradient(180deg,#58b896_0%,#8fdcc0_72%,#c8f6e5_90%,#6fcaa9_100%)]";
const BLACK_CORRECT_GLOW = "shadow-[0_0_8px_rgba(190,255,230,0.7)]";
const WHITE_CORRECT =
  "bg-[linear-gradient(180deg,#a8e8d0_0%,#e6fff6_18%,#f3fffb_82%,#c4f2e1_100%)]";
const WHITE_CORRECT_GLOW = "shadow-[0_0_8px_rgba(200,255,232,0.75)]";

const KEY_CLASSES: Record<"black" | "white", Record<KeyState, [mobile: string, desktop: string]>> = {
  black: {
    idle: [
      "bg-[linear-gradient(180deg,#1b1b1b_0%,#080808_72%,#303030_90%,#0e0e0e_100%)] shadow-[0_3px_4px_rgba(0,0,0,0.6)]",
      "bg-[linear-gradient(180deg,#1b1b1b_0%,#080808_72%,#303030_90%,#0e0e0e_100%)] shadow-[0_3px_4px_rgba(0,0,0,0.6)]",
    ],
    expected: [
      "bg-[linear-gradient(180deg,#2c6658_0%,#3d8a76_72%,#6db4a0_90%,#2f6d5f_100%)]",
      "bg-[linear-gradient(180deg,#2c6658_0%,#3d8a76_72%,#6db4a0_90%,#2f6d5f_100%)] shadow-[0_0_6px_rgba(124,179,166,0.5)]",
    ],
    correct: [BLACK_CORRECT, `${BLACK_CORRECT} ${BLACK_CORRECT_GLOW}`],
    wrong: [
      "bg-[linear-gradient(180deg,#9b2f45_0%,#c4465f_72%,#ef8a9c_90%,#a83850_100%)]",
      "bg-[linear-gradient(180deg,#9b2f45_0%,#c4465f_72%,#ef8a9c_90%,#a83850_100%)] shadow-[0_0_8px_rgba(251,113,133,0.65)]",
    ],
    active: [BLACK_CORRECT, `${BLACK_CORRECT} ${BLACK_CORRECT_GLOW}`],
  },
  white: {
    idle: [
      "bg-[linear-gradient(180deg,#d5d5d0_0%,#f3f3ef_10%,#fafaf7_82%,#e2e2dc_100%)]",
      "bg-[linear-gradient(180deg,#d5d5d0_0%,#f3f3ef_10%,#fafaf7_82%,#e2e2dc_100%)]",
    ],
    expected: [
      "bg-[linear-gradient(180deg,#8fc7b6_0%,#c5ebde_14%,#d6f3e9_82%,#aedfcf_100%)]",
      "bg-[linear-gradient(180deg,#8fc7b6_0%,#c5ebde_14%,#d6f3e9_82%,#aedfcf_100%)] shadow-[0_0_6px_rgba(124,179,166,0.45)]",
    ],
    correct: [WHITE_CORRECT, `${WHITE_CORRECT} ${WHITE_CORRECT_GLOW}`],
    wrong: [
      "bg-[linear-gradient(180deg,#f19aaa_0%,#ffd2da_18%,#ffdde3_82%,#f5b3bf_100%)]",
      "bg-[linear-gradient(180deg,#f19aaa_0%,#ffd2da_18%,#ffdde3_82%,#f5b3bf_100%)] shadow-[0_0_8px_rgba(253,164,175,0.7)]",
    ],
    active: [WHITE_CORRECT, `${WHITE_CORRECT} ${WHITE_CORRECT_GLOW}`],
  },
};

/**
 * Outline of the part of a white key not covered by black keys (each black key
 * overlaps a third of its neighbours, over the top 60%).
 */
function whiteKeyClip(midi: number, startMidi: number, endMidi: number): string | undefined {
  const left = midi - 1 >= startMidi && BLACK_CLASSES.has((midi + 11) % 12);
  const right = midi + 1 <= endMidi && BLACK_CLASSES.has((midi + 1) % 12);
  const a = "33.34%";
  const b = "66.66%";
  const h = "60%";
  if (left && right) return `polygon(${a} 0, ${b} 0, ${b} ${h}, 100% ${h}, 100% 100%, 0 100%, 0 ${h}, ${a} ${h})`;
  if (left) return `polygon(${a} 0, 100% 0, 100% 100%, 0 100%, 0 ${h}, ${a} ${h})`;
  if (right) return `polygon(0 0, ${b} 0, ${b} ${h}, 100% ${h}, 100% 100%, 0 100%)`;
  return undefined;
}

const RAIL_GLOW_GRADIENT =
  "radial-gradient(ellipse at center, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.18) 40%, transparent 70%)";

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

  const stateOf = (midi: number): KeyState => {
    const isActive = activeNotes.has(midi);
    const isExpected = expectedSet.has(midi);
    const isPlayed = playedSet.has(midi);
    // Green when correctly pressed OR actively held during an expected window.
    return (isPlayed || isActive) && isExpected
      ? "correct"
      : isPlayed
        ? "wrong"
        : isActive
          ? "active"
          : isExpected
            ? "expected"
            : "idle";
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full h-full flex rounded-b-md relative touch-none select-none bg-black",
        // Allow surround glow to spill above the keyboard when stage lighting is on.
        topLight ? "" : "overflow-hidden",
        variant === "flow" ? "min-h-[180px]" : "min-h-[150px] max-h-[300px]",
      )}
    >
      {keys.map((key) => {
        const state = stateOf(key.midi);
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
          <Key
            key={key.midi}
            midi={key.midi}
            className={`${WHITE_BASE} ${state === "idle" ? "z-0" : "z-[5]"} ${KEY_CLASSES.white[state][variantIndex]}`}
          />
        );
      })}

      {/* Dim layer — darkens all keys uniformly. Sits above key bodies, below spotlights. */}
      {dim < 1 && (
        <div
          className="absolute inset-0 pointer-events-none z-20 rounded-b-md"
          style={{ background: `rgba(0,0,0,${(1 - dim).toFixed(3)})` }}
        />
      )}

      {/* Lit keys stay bright above the dim layer, like keys under a spotlight. White
          keys are clipped around their black-key notches so they don't cover them. */}
      {dim < 1 && keys.map((key) => {
        const state = stateOf(key.midi);
        if (state === "idle") return null;
        const leftPct = key.precedingWhite * whiteKeyWidth;
        if (key.isBlack) {
          return (
            <div
              key={`lit-${key.midi}`}
              className={`absolute top-0 rounded-b-[3px] border border-black pointer-events-none z-[25] ${KEY_CLASSES.black[state][variantIndex]}`}
              style={{ left: `calc(${leftPct}% - ${whiteKeyWidth / 3}%)`, width: `${whiteKeyWidth / 1.5}%`, height: "60%" }}
            />
          );
        }
        const clip = whiteKeyClip(key.midi, startMidi, endMidi);
        return (
          <div
            key={`lit-${key.midi}`}
            className={`absolute top-0 bottom-0 rounded-b-[4px] border-x border-b border-black/40 pointer-events-none z-[25] ${KEY_CLASSES.white[state][0]}`}
            style={{ left: `${leftPct}%`, width: `${whiteKeyWidth}%`, clipPath: clip, WebkitClipPath: clip }}
          />
        );
      })}

      {/* Pressed keys under stage lighting: a top-down highlight clipped to the key's
          visible shape, so the neighbouring black keys stay black, and a soft glow
          where the key meets the rail. */}
      {topLight && keys.map((key) => {
        if (!activeNotes.has(key.midi)) return null;
        const leftPct = key.precedingWhite * whiteKeyWidth;
        const clip = key.isBlack ? undefined : whiteKeyClip(key.midi, startMidi, endMidi);
        const centerPct = key.isBlack ? leftPct : leftPct + whiteKeyWidth / 2;
        return (
          <React.Fragment key={`spot-${key.midi}`}>
            <div
              className={cn(
                "absolute top-0 pointer-events-none z-30",
                key.isBlack ? "rounded-b-[3px]" : "rounded-b-[4px]",
              )}
              style={{
                left: key.isBlack ? `calc(${leftPct}% - ${whiteKeyWidth / 3}%)` : `${leftPct}%`,
                width: key.isBlack ? `${whiteKeyWidth / 1.5}%` : `${whiteKeyWidth}%`,
                height: key.isBlack ? "60%" : "100%",
                background: SPOTLIGHT_GRADIENT,
                clipPath: clip,
                WebkitClipPath: clip,
              }}
            />
            <div
              className="absolute -top-2.5 h-5 pointer-events-none z-30"
              style={{
                left: `${centerPct - whiteKeyWidth * 0.8}%`,
                width: `${whiteKeyWidth * 1.6}%`,
                background: RAIL_GLOW_GRADIENT,
              }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const PianoKeyboard = React.memo(PianoKeyboardImpl);
