import { isLowPowerDevice } from "./device";

type AudioWindow = typeof window & {
  webkitAudioContext?: typeof AudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type LatencyContext = AudioContext & { outputLatency?: number; baseLatency?: number };

let ctx: AudioContext | null = null;
let ctxFailed = false;
let primed = false;
let decodeCtx: BaseAudioContext | null = null;
let sessionType = "playback";

/**
 * The single AudioContext used for playback and the on-screen keyboard.
 * Created lazily, ideally from inside a user gesture: iOS only lets a context
 * start producing sound from a touch/click handler, and older iOS versions can
 * end up with a mismatched sample rate if the context is created earlier.
 */
export function getAudioContext(): AudioContext | null {
  if (ctx || ctxFailed) return ctx;
  const w = window as AudioWindow;
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) {
    ctxFailed = true;
    return null;
  }
  try {
    // Bigger buffers on phones/tablets cost a few ms of touch latency but
    // avoid crackles when the CPU is busy. Playback is scheduled ahead on the
    // audio clock, so it does not need a small buffer.
    ctx = new Ctor({ latencyHint: isLowPowerDevice() ? "balanced" : "interactive" });
  } catch {
    try {
      ctx = new Ctor();
    } catch (err) {
      console.error("Web Audio is not available", err);
      ctxFailed = true;
    }
  }
  return ctx;
}

/**
 * Context used to decode samples before the user has interacted with the page.
 * Decoding doesn't need a running (or even realtime) context, so this lets the
 * samples download and decode while the page is idle.
 */
export function getDecodeContext(): BaseAudioContext | null {
  if (ctx) return ctx;
  if (decodeCtx) return decodeCtx;
  const w = window as AudioWindow;
  const Offline = w.OfflineAudioContext || w.webkitOfflineAudioContext;
  if (!Offline) return getAudioContext();
  try {
    decodeCtx = new Offline(2, 1, 48000);
  } catch {
    return getAudioContext();
  }
  return decodeCtx;
}

/** decodeAudioData with the callback form, which old Safari requires. */
export function decodeAudio(context: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const ret = context.decodeAudioData(data, resolve, reject) as unknown;
      if (ret && typeof (ret as Promise<AudioBuffer>).then === "function") {
        (ret as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * iOS 16.4+: "playback" makes Web Audio ignore the ring/silent switch (by
 * default the page is muted whenever the switch is on). Capture needs
 * "play-and-record" while the microphone is in use.
 */
export function setAudioSessionType(type: "playback" | "play-and-record") {
  sessionType = type;
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    /* no-op */
  }
}

/**
 * Creates (if needed) and starts the context. Must run inside a user gesture
 * handler to have any effect on iOS/Safari; harmless elsewhere.
 */
export function unlockAudio(): AudioContext | null {
  const c = getAudioContext();
  if (!c) return null;
  setAudioSessionType(sessionType as "playback" | "play-and-record");
  if (c.state !== "running") {
    try {
      const p = c.resume() as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* no-op */
    }
  }
  if (!primed) {
    // iOS 12 and earlier only unlock audio once a source has been started
    // from inside the gesture handler, so play one silent sample.
    primed = true;
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch {
      /* no-op */
    }
  }
  return c;
}

/**
 * Unlocks audio on the first gestures and again after iOS interrupts the
 * context (phone call, Siri, switching apps). touchend/click are what iOS
 * accepts as a gesture; pointerdown/keydown cover desktop browsers.
 */
export function installAudioUnlock(): () => void {
  const events = ["touchend", "click", "pointerdown", "keydown"];
  const handler = () => {
    if (ctx && ctx.state === "running") return;
    unlockAudio();
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  events.forEach((e) => document.addEventListener(e, handler, opts));
  return () => events.forEach((e) => document.removeEventListener(e, handler, opts));
}

// ── Smoothed audio clock ─────────────────────────────────────────────────
// AudioContext.currentTime only advances once per audio callback (anywhere
// from ~3 ms to 40+ ms depending on the device), so animating directly from it
// stutters. Track the offset between the audio clock and performance.now()
// instead: currentTime is never ahead of the true audio time, so the upper
// envelope of (currentTime - perfNow) is a good estimate. A slow decay follows
// real drift between the two hardware clocks.
let clockOffset = 0;
let clockValid = false;
let lastPerf = 0;
const DRIFT_DECAY = 0.005; // seconds per second
const RESET_THRESHOLD = 0.1; // larger drops mean the context was suspended

/** Best estimate of the audio context's current time, in seconds. */
export function audioClockNow(c: AudioContext): number {
  const ct = c.currentTime;
  if (c.state !== "running") {
    clockValid = false;
    return ct;
  }
  const perf = performance.now() / 1000;
  const sample = ct - perf;
  if (!clockValid || sample > clockOffset || clockOffset - sample > RESET_THRESHOLD) {
    clockOffset = sample;
    clockValid = true;
  } else {
    clockOffset -= DRIFT_DECAY * Math.max(0, perf - lastPerf);
  }
  lastPerf = perf;
  return perf + clockOffset;
}

/**
 * Seconds between a sound being scheduled at `currentTime` and it reaching the
 * speakers. Visuals subtract this so the falling notes line up with what is
 * heard (it can be 150 ms+ on Bluetooth headphones).
 */
export function outputLatency(c: AudioContext): number {
  const l = c as LatencyContext;
  const total = (l.baseLatency || 0) + (l.outputLatency || 0);
  return total > 0 && total < 0.5 ? total : 0;
}
