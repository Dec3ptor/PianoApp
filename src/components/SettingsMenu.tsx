import React, { useEffect, useRef, useState } from "react";
import { Settings, Sparkles, Flame, Download, Upload } from "lucide-react";
import { cn } from "../lib/utils";
import { applyImport, downloadExport } from "../lib/dataExport";

interface SettingsMenuProps {
  effectsEnabled: boolean;
  onEffectsChange: (v: boolean) => void;
  particlesEnabled: boolean;
  onParticlesChange: (v: boolean) => void;
  keyboardDim: number;
  onKeyboardDimChange: (v: number) => void;
}

/**
 * Compact gear-icon dropdown for app-wide preferences. Sits in the header so
 * it never claims space in the main workspace.
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  effectsEnabled, onEffectsChange,
  particlesEnabled, onParticlesChange,
  keyboardDim, onKeyboardDimChange,
}) => {
  const [open, setOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = applyImport(data);
      if (result.ok) {
        setImportMsg({
          kind: "ok",
          text: `Imported ${result.applied.settings} setting(s), ${result.applied.markerTracks} marker set(s). Reloading…`,
        });
        setTimeout(() => window.location.reload(), 700);
      } else {
        setImportMsg({ kind: "err", text: result.errors[0] ?? "Import failed." });
      }
    } catch (err) {
      setImportMsg({ kind: "err", text: `Could not read file: ${(err as Error).message}` });
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        className={cn(
          "w-9 h-9 rounded-full border flex items-center justify-center transition-colors",
          open
            ? "bg-zinc-800 border-zinc-600 text-zinc-100"
            : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100",
        )}
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2 z-50 max-h-[80vh] overflow-y-auto">
          <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 px-2 py-1">
            Settings
          </div>
          <label className="flex items-center justify-between gap-3 p-2 hover:bg-zinc-800/60 rounded-lg cursor-pointer">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="text-sm text-zinc-100 leading-tight">Stage lighting</div>
                <div className="text-[10px] text-zinc-500 leading-tight">
                  Dim keys & spotlight pressed notes
                </div>
              </div>
            </div>
            <Toggle checked={effectsEnabled} onChange={onEffectsChange} />
          </label>

          <label className="flex items-center justify-between gap-3 p-2 hover:bg-zinc-800/60 rounded-lg cursor-pointer">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-emerald-300 shrink-0" />
              <div>
                <div className="text-sm text-zinc-100 leading-tight">Particle effects</div>
                <div className="text-[10px] text-zinc-500 leading-tight">
                  Sparks where notes hit the keys (Flow view)
                </div>
              </div>
            </div>
            <Toggle checked={particlesEnabled} onChange={onParticlesChange} />
          </label>

          {effectsEnabled && (
            <div className="mt-1 px-2 pb-2 pt-1 border-t border-zinc-800/60">
              <Slider
                label="Keyboard brightness"
                value={keyboardDim}
                min={0} max={1} step={0.02}
                onChange={onKeyboardDimChange}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          )}

          <div className="mt-1 px-2 pb-2 pt-2 border-t border-zinc-800/60">
            <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 pb-1.5">
              Backup
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => downloadExport()}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-100 transition-colors"
                title="Download a JSON file with markers & settings"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
              <button
                type="button"
                onClick={handleImportClick}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-100 transition-colors"
                title="Load a previously exported JSON file"
              >
                <Upload className="w-3.5 h-3.5" />
                Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileSelected}
                className="hidden"
              />
            </div>
            {importMsg && (
              <div
                className={cn(
                  "mt-2 text-[10px] leading-snug px-2 py-1 rounded",
                  importMsg.kind === "ok"
                    ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/50"
                    : "bg-rose-900/40 text-rose-300 border border-rose-700/50",
                )}
              >
                {importMsg.text}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Slider helper ────────────────────────────────────────────────────────────
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, onChange, format }) => (
  <div className="mt-2">
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="text-xs font-mono text-cyan-400">{format(value)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1 mt-1 accent-cyan-400"
    />
  </div>
);

// ── Toggle helper ─────────────────────────────────────────────────────────────
interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={(e) => { e.preventDefault(); onChange(!checked); }}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
      checked ? "bg-cyan-500" : "bg-zinc-700",
    )}
  >
    <span
      className={cn(
        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5",
      )}
    />
  </button>
);
