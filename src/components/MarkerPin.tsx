import React, { useRef, useState } from "react";

interface MarkerPinProps {
  /** 0–100 horizontal position on the parent progress bar */
  position: number;
  /** Number shown inside the chip (1-based) */
  index: number;
  onJump: () => void;
  onRemove: () => void;
}

/**
 * Small numbered chip sitting just above the progress bar.
 *   • Tap        → jump to that beat
 *   • Long-press → remove (visual cue: chip turns red before delete)
 * Positioned absolutely so it never claims layout space.
 */
const MarkerPinImpl: React.FC<MarkerPinProps> = ({ position, index, onJump, onRemove }) => {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const [warning, setWarning] = useState(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    longPressedRef.current = false;
    setWarning(false);
    // 550 ms hold = delete; long enough to avoid accidental removes on tap.
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setWarning(true);
      // brief red flash before actually deleting
      window.setTimeout(() => {
        onRemove();
      }, 120);
    }, 550);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    clearTimer();
    if (!longPressedRef.current) onJump();
  };

  const handlePointerLeave = () => {
    clearTimer();
    setWarning(false);
  };

  return (
    <button
      type="button"
      title="Tap to jump • Hold to remove"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      onContextMenu={(e) => {
        e.preventDefault();
        onRemove();
      }}
      className={
        "absolute -top-3 -translate-x-1/2 px-1.5 h-4 rounded-sm text-[9px] font-mono font-bold leading-none flex items-center justify-center transition-colors " +
        (warning
          ? "bg-red-500 text-white"
          : "bg-amber-400 text-zinc-950 hover:bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.6)]")
      }
      style={{ left: `${position}%` }}
    >
      {index}
    </button>
  );
};

export const MarkerPin = React.memo(MarkerPinImpl);
