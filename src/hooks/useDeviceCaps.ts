import { useEffect, useState } from "react";
import NoSleep from "nosleep.js";

/**
 * Detects "low-power" devices (phones, tablets, low-DPR laptops) so the app
 * can degrade gracefully: smaller sample sets, simpler shadows, single-view
 * default layouts, etc.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => detect());

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1024px), (pointer: coarse)");
    const handler = () => setIsMobile(detect());
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, []);

  return isMobile;
}

function detect(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  if (isIOS || isAndroid) return true;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = window.matchMedia("(max-width: 1024px)").matches;
  return coarse || small;
}

// Module-level singletons so the silent-video fallback persists across
// component re-renders and is only ever attached to the DOM once.
let noSleepInstance: NoSleep | null = null;
let noSleepEnabled = false;
let gestureListenerAttached = false;

function getNoSleep(): NoSleep {
  if (!noSleepInstance) noSleepInstance = new NoSleep();
  return noSleepInstance;
}

/**
 * Keeps the screen awake while `enabled` is true. Two strategies:
 *   1. Screen Wake Lock API – Safari 16.4+, Chrome 84+. Best when available.
 *   2. NoSleep.js fallback – silent muted looping video that iOS treats as
 *      active media, preventing the auto-lock. Required for older iPads
 *      whose Safari/WKWebView (e.g. iOS 12-15) lacks Wake Lock. Must be
 *      started from a user gesture, so we lazily attach `click`/`touchend`
 *      listeners until the first real interaction enables it.
 *
 * Re-requests the native lock whenever the page becomes visible again, because
 * the browser releases it automatically when the tab is hidden.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    // ── Strategy 1: native Screen Wake Lock API ──────────────────────────
    const anyNav = navigator as unknown as {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    const requestNative = () => {
      if (!anyNav.wakeLock || typeof anyNav.wakeLock.request !== "function") return;
      anyNav.wakeLock
        .request("screen")
        .then((s) => {
          if (cancelled) s.release?.().catch(() => {});
          else sentinel = s;
        })
        .catch(() => {});
    };
    requestNative();

    // ── Strategy 2: NoSleep.js silent-video fallback (older iOS) ─────────
    const enableNoSleep = () => {
      if (noSleepEnabled || cancelled) return;
      try {
        const ns = getNoSleep();
        const ret = ns.enable();
        // ns.enable() returns a Promise on modern browsers.
        if (ret && typeof (ret as Promise<void>).then === "function") {
          (ret as Promise<void>).then(() => {
            noSleepEnabled = true;
          }).catch(() => {});
        } else {
          noSleepEnabled = true;
        }
      } catch {
        /* no-op */
      }
    };
    if (!noSleepEnabled && !gestureListenerAttached) {
      gestureListenerAttached = true;
      const opts: AddEventListenerOptions = { once: true, capture: true };
      // iOS Safari requires a real user gesture; both `touchend` and `click`
      // qualify. Attach to whichever fires first.
      document.addEventListener("touchend", enableNoSleep, opts);
      document.addEventListener("click", enableNoSleep, opts);
      document.addEventListener("keydown", enableNoSleep, opts);
    }

    // ── Re-acquire native lock when tab becomes visible again ───────────
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel) requestNative();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinel?.release?.().catch(() => {});
      sentinel = null;
      // Leave NoSleep enabled across hook re-runs to avoid the user having
      // to gesture again. It is fully disabled only when the page unloads.
    };
  }, [enabled]);
}

type WakeLockSentinelLike = {
  release?: () => Promise<void>;
};
