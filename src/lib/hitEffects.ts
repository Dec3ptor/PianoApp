import { isLowPowerDevice } from "./device";

/** A key currently lighting up at the hit line. */
export interface Emitter {
  /** Stable id; a new id (a re-struck key) restarts the attack burst. */
  id: string;
  /** Centre and width of the key as fractions of the canvas width. */
  x: number;
  w: number;
  /** 0 = note sounding, 1 = played correctly, 2 = wrong key. */
  tone: 0 | 1 | 2;
}

// Colours per tone: mint like the falling notes, near-white for a correct
// press, rose for a wrong one. [spark core, flare core]
const TONE_RGB: [number, number, number][][] = [
  [[170, 226, 207], [222, 240, 233]],
  [[232, 255, 246], [246, 255, 251]],
  [[255, 166, 180], [255, 212, 219]],
];

const LOW_POWER = isLowPowerDevice();
const MAX_PARTICLES = LOW_POWER ? 260 : 900;
const SPARKS_PER_SEC = LOW_POWER ? 34 : 85;
// Haze puffs are large sprites, so they are the expensive part: keep them few.
const HAZE_PER_SEC = LOW_POWER ? 3 : 6;
const BURST = LOW_POWER ? 14 : 34;
// If the device can't keep up (average frame interval above this), the
// effects thin out and redraw at half rate so the falling notes stay smooth.
const SLOW_FRAME_MS = 22;
/** Fraction of the canvas height particles may rise through before fading out. */
const RISE = 0.9;

type Sprite = HTMLCanvasElement | ImageBitmap;

function makeSprite(rgb: [number, number, number], size: number, falloff: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gr, b] = rgb;
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(falloff * 0.35, `rgba(${r},${gr},${b},0.9)`);
  grad.addColorStop(falloff, `rgba(${r},${gr},${b},0.25)`);
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

interface ActiveEmitter extends Emitter {
  born: number;
  /** Fractional particles carried over between frames. */
  sparkDebt: number;
  hazeDebt: number;
  /** 0..1, fades out after the key is released. */
  fade: number;
  released: boolean;
  seed: number;
}

/**
 * Flares and rising sparks where notes meet the keyboard, drawn on a canvas
 * whose bottom edge is the hit line. Particles live in preallocated typed
 * arrays, so the animation allocates nothing per frame (garbage-collection
 * pauses make animations stutter on phones). The loop only runs while
 * something is glowing.
 */
export class HitEffects {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private scale = 1;
  private emitters = new Map<string, ActiveEmitter>();
  private raf = 0;
  private last = 0;
  private disposed = false;
  private readonly reducedMotion: boolean;
  // Frame-rate watch for the adaptive quality drop.
  private lastTs = 0;
  private avgFrameMs = 16.7;
  private frames = 0;
  private reduced = false;
  // Particle pool (structure of arrays).
  private n = 0;
  private px = new Float32Array(MAX_PARTICLES);
  private py = new Float32Array(MAX_PARTICLES);
  private vx = new Float32Array(MAX_PARTICLES);
  private vy = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private seed = new Float32Array(MAX_PARTICLES);
  private tone = new Uint8Array(MAX_PARTICLES);
  private haze = new Uint8Array(MAX_PARTICLES);
  private sparkSprites: Sprite[];
  private glowSprites: Sprite[];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.reducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sparkSprites = TONE_RGB.map(([spark]) => makeSprite(spark, 32, 0.5));
    this.glowSprites = TONE_RGB.map(([, flare]) => makeSprite(flare, 128, 0.6));
    // Bitmaps draw faster than canvases, which get snapshotted on every use.
    if (typeof createImageBitmap === "function") {
      for (const list of [this.sparkSprites, this.glowSprites]) {
        list.forEach((sprite, i) => {
          createImageBitmap(sprite).then(
            (bitmap) => {
              if (!this.disposed) list[i] = bitmap;
            },
            () => {},
          );
        });
      }
    }
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    // Soft glows don't need full retina resolution; fewer pixels keeps it cheap.
    this.scale = LOW_POWER ? 0.75 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(this.width * this.scale));
    this.canvas.height = Math.max(1, Math.round(this.height * this.scale));
    this.draw(0);
  }

  /** Replace the set of glowing keys (diffed by id). */
  setEmitters(list: Emitter[]): void {
    const now = performance.now() / 1000;
    const keep = new Set<string>();
    for (const e of list) {
      keep.add(e.id);
      const existing = this.emitters.get(e.id);
      if (existing && !existing.released) {
        // A correct press on a note that is already sounding gets its own burst.
        if (e.tone === 1 && existing.tone !== 1) this.burst(existing, BURST);
        existing.tone = e.tone;
        existing.x = e.x;
        existing.w = e.w;
        continue;
      }
      const active: ActiveEmitter = {
        ...e,
        born: now,
        sparkDebt: 0,
        hazeDebt: 0,
        fade: 1,
        released: false,
        seed: Math.random() * 100,
      };
      this.emitters.set(e.id, active);
      this.burst(active, BURST);
    }
    this.emitters.forEach((e, id) => {
      if (!keep.has(id)) e.released = true;
    });
    this.start();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.emitters.clear();
    this.n = 0;
  }

  private start() {
    if (this.raf) return;
    this.last = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (ts: number) => {
    this.raf = 0;
    this.watchFrameRate(ts);
    // Reduced quality: redraw every other frame (physics still uses the full dt).
    if (!this.reduced || this.frames % 2 === 0) {
      const now = performance.now() / 1000;
      // Clamp so a stall (or a background tab) doesn't teleport particles.
      const dt = Math.min(0.05, Math.max(0, now - this.last));
      this.last = now;
      this.update(now, dt);
      this.draw(now);
    }
    if (this.emitters.size > 0 || this.n > 0) this.raf = requestAnimationFrame(this.frame);
    else this.lastTs = 0;
  };

  /** Drops to reduced quality for good once frames are consistently slow. */
  private watchFrameRate(ts: number) {
    this.frames++;
    if (this.lastTs) {
      const interval = Math.min(50, ts - this.lastTs);
      this.avgFrameMs += (interval - this.avgFrameMs) * 0.05;
      // Ignore the first second of each run (startup work, sample decoding).
      if (!this.reduced && this.frames > 60 && this.avgFrameMs > SLOW_FRAME_MS) this.reduced = true;
    }
    this.lastTs = ts;
  }

  private spawn(e: ActiveEmitter, haze: boolean) {
    if (this.reducedMotion || this.n >= MAX_PARTICLES || this.width <= 0) return;
    const i = this.n++;
    const keyW = e.w * this.width;
    this.px[i] = (e.x + (Math.random() - 0.5) * e.w * 1.2) * this.width;
    this.py[i] = this.height - Math.random() * 3;
    this.tone[i] = e.tone;
    this.haze[i] = haze ? 1 : 0;
    this.seed[i] = Math.random() * 1000;
    if (haze) {
      this.vx[i] = (Math.random() - 0.5) * 18;
      this.vy[i] = -(18 + Math.random() * 30);
      this.maxLife[i] = this.life[i] = 1.2 + Math.random() * 1.3;
      this.size[i] = keyW * (1.2 + Math.random() * 1.4) + 10;
    } else {
      this.vx[i] = (Math.random() - 0.5) * 90;
      this.vy[i] = -(50 + Math.random() * 160);
      this.maxLife[i] = this.life[i] = 0.5 + Math.random() * 1.2;
      this.size[i] = 4 + Math.random() * 8;
    }
  }

  private burst(e: ActiveEmitter, count: number) {
    for (let k = 0; k < count; k++) this.spawn(e, false);
    this.spawn(e, true);
  }

  private update(now: number, dt: number) {
    // Emit: a burst on the attack, then a trickle while the key is held.
    this.emitters.forEach((e, id) => {
      if (e.released) {
        e.fade -= dt / 0.18;
        if (e.fade <= 0) this.emitters.delete(id);
        return;
      }
      const age = now - e.born;
      const intensity = (0.3 + 0.7 * Math.exp(-age / 0.5)) * (this.reduced ? 0.5 : 1);
      e.sparkDebt += SPARKS_PER_SEC * intensity * dt;
      e.hazeDebt += HAZE_PER_SEC * (this.reduced ? 0.5 : 1) * dt;
      for (; e.sparkDebt >= 1; e.sparkDebt--) this.spawn(e, false);
      for (; e.hazeDebt >= 1; e.hazeDebt--) this.spawn(e, true);
    });

    // Move: sparks drift up, slow down and flutter; haze rises slowly and spreads.
    const drag = Math.exp(-1.6 * dt);
    const top = this.height * (1 - RISE);
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0 || this.py[i] < top) {
        // Swap-remove keeps the live particles packed at the front.
        const last = --this.n;
        if (i !== last) {
          this.px[i] = this.px[last];
          this.py[i] = this.py[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
          this.seed[i] = this.seed[last];
          this.tone[i] = this.tone[last];
          this.haze[i] = this.haze[last];
        }
        i--;
        continue;
      }
      if (this.haze[i]) {
        this.vx[i] += Math.sin(now * 0.9 + this.seed[i]) * 6 * dt;
      } else {
        this.vx[i] = this.vx[i] * drag + Math.sin(now * 2.7 + this.seed[i]) * 40 * dt;
        this.vy[i] = this.vy[i] * drag - 25 * dt;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
    }
  }

  private draw(now: number) {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.emitters.size === 0 && this.n === 0) return;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.globalCompositeOperation = "lighter";

    // Haze first (behind), then sparks.
    for (let pass = 1; pass >= 0; pass--) {
      for (let i = 0; i < this.n; i++) {
        if (this.haze[i] !== pass) continue;
        const t = this.life[i] / this.maxLife[i]; // 1 -> 0
        let size = this.size[i];
        let alpha: number;
        if (pass === 1) {
          size *= 1.6 - 0.6 * t; // spreads as it rises
          alpha = 0.14 * Math.sin(Math.PI * t);
        } else {
          // Twinkle like glitter, fading out with age.
          alpha = t * t * (0.55 + 0.45 * Math.sin(now * 23 + this.seed[i]));
        }
        if (alpha <= 0.004) continue;
        ctx.globalAlpha = alpha;
        const sprite = pass === 1 ? this.glowSprites[this.tone[i]] : this.sparkSprites[this.tone[i]];
        ctx.drawImage(sprite, this.px[i] - size / 2, this.py[i] - size / 2, size, size);
      }
    }

    // Flares where the keys meet the hit line, brightest on the attack.
    this.emitters.forEach((e) => {
      const keyW = e.w * this.width;
      const x = e.x * this.width;
      const age = now - e.born;
      const flicker = this.reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(now * 31 + e.seed);
      const intensity = (0.55 + 0.45 * Math.exp(-age / 0.35)) * flicker * Math.max(0, e.fade);
      const glow = this.glowSprites[e.tone];
      const r = 16 + keyW * 1.1;
      ctx.globalAlpha = 0.95 * intensity;
      ctx.drawImage(glow, x - r, this.height - r, r * 2, r * 2);
      // A taller, fainter plume above the key.
      ctx.globalAlpha = 0.35 * intensity;
      ctx.drawImage(glow, x - keyW * 0.9, this.height - r * 2.6, keyW * 1.8, r * 3);
    });

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
