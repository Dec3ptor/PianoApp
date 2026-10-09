/**
 * Versioned export/import for app state stored in localStorage.
 *
 * Format is intentionally extensible:
 *  - Each top-level field other than the metadata block (`app`, `schemaVersion`,
 *    `exportedAt`) is a named "section" with its own shape.
 *  - Adding a new section in the future is non-breaking: older versions of the
 *    app simply ignore sections they don't know about.
 *  - Within a section, fields are read defensively — missing or unknown
 *    sub-fields are skipped, never thrown.
 */

const APP_ID = "pianoapp";
const SCHEMA_VERSION = 1;
const MARKER_PREFIX = "pianoapp.markers:";

// Known setting keys that round-trip through the export. Future settings can
// be added here without changing the schema.
const SETTING_KEYS = ["effectsEnabled", "keyboardDim", "particles"] as const;

export interface ExportFile {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: string;
  settings?: Record<string, unknown>;
  markers?: { byTrack: Record<string, number[]> };
}

export interface ImportResult {
  ok: boolean;
  applied: { settings: number; markerTracks: number };
  errors: string[];
}

export function buildExport(): ExportFile {
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const raw = localStorage.getItem(`pianoapp.${key}`);
    if (raw === null) continue;
    settings[key] = parseSettingValue(raw);
  }

  const byTrack: Record<string, number[]> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(MARKER_PREFIX)) continue;
    const title = k.slice(MARKER_PREFIX.length);
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? "[]");
      if (Array.isArray(v)) {
        byTrack[title] = v.filter((n) => typeof n === "number");
      }
    } catch { /* skip malformed entries */ }
  }

  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    markers: { byTrack },
  };
}

export function applyImport(data: unknown): ImportResult {
  const errors: string[] = [];
  const result: ImportResult = {
    ok: false,
    applied: { settings: 0, markerTracks: 0 },
    errors,
  };

  if (!data || typeof data !== "object") {
    errors.push("File is not a valid JSON object.");
    return result;
  }
  const obj = data as Record<string, unknown>;
  if (obj.app !== APP_ID) {
    errors.push(`Not a ${APP_ID} export file (app: ${String(obj.app)}).`);
    return result;
  }
  // schemaVersion is informational for now — unknown versions are still
  // processed best-effort so older apps can read newer files.

  // ── settings ──
  if (obj.settings && typeof obj.settings === "object") {
    for (const [key, value] of Object.entries(obj.settings as Record<string, unknown>)) {
      try {
        const stored = typeof value === "string" ? value : JSON.stringify(value);
        localStorage.setItem(`pianoapp.${key}`, stored);
        result.applied.settings++;
      } catch (e) {
        errors.push(`settings.${key}: ${(e as Error).message}`);
      }
    }
  }

  // ── markers ──
  if (obj.markers && typeof obj.markers === "object") {
    const byTrack = (obj.markers as Record<string, unknown>).byTrack;
    if (byTrack && typeof byTrack === "object") {
      for (const [title, raw] of Object.entries(byTrack as Record<string, unknown>)) {
        if (!Array.isArray(raw)) continue;
        // Accept either number[] or {beat:number}[] for forward compatibility
        // with future per-marker metadata.
        const beats = (raw as unknown[])
          .map((it) =>
            typeof it === "number"
              ? it
              : it && typeof it === "object" && typeof (it as { beat?: unknown }).beat === "number"
                ? ((it as { beat: number }).beat)
                : null,
          )
          .filter((n): n is number => typeof n === "number");
        try {
          localStorage.setItem(`${MARKER_PREFIX}${title}`, JSON.stringify(beats));
          result.applied.markerTracks++;
        } catch (e) {
          errors.push(`markers.${title}: ${(e as Error).message}`);
        }
      }
    }
  }

  result.ok = result.applied.settings + result.applied.markerTracks > 0 || errors.length === 0;
  return result;
}

export function downloadExport(filename?: string): void {
  const data = buildExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `pianoapp-backup-${dateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseSettingValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (raw.trim() !== "" && !Number.isNaN(n)) return n;
  try { return JSON.parse(raw); } catch { return raw; }
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
