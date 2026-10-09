let lowPower: boolean | null = null;

/**
 * Phones and tablets: decode fewer samples, skip expensive glow effects and
 * use larger audio buffers. Based on the kind of device rather than the window
 * width, because a narrow desktop window still has a fast CPU.
 */
export function isLowPowerDevice(): boolean {
  if (lowPower !== null) return lowPower;
  lowPower = false;
  if (typeof navigator === "undefined") return lowPower;
  try {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod|Android/.test(ua)) lowPower = true;
    // iPadOS 13+ reports a desktop Mac user agent.
    else if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) lowPower = true;
    else lowPower = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    /* no-op */
  }
  return lowPower;
}
