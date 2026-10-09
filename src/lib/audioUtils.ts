export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

export function midiToNoteName(midi: number): string {
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function freqToNoteName(freq: number): string {
  return midiToNoteName(freqToMidi(freq));
}

// Advanced Polyphonic Pitch Detection using FFT Spectral Peak Picking
export function getPolyphonicNotes(
  analyser: AnalyserNode,
  sampleRate: number,
  // Pass a reused buffer when calling every frame to avoid garbage.
  buffer: Float32Array = new Float32Array(analyser.frequencyBinCount),
): number[] {
  analyser.getFloatFrequencyData(buffer); // dB values (-100 to 0)

  const fftSize = analyser.fftSize;
  const binSize = sampleRate / fftSize;

  const peaks: { midi: number; energy: number; freq: number }[] = [];
  const minDb = -50; // Much lower sensitivity floor (was -80)

  for (let i = 1; i < buffer.length - 1; i++) {
    const val = buffer[i];
    if (val > minDb && val > buffer[i - 1] && val > buffer[i + 1]) {
      // Parabolic interpolation for better frequency estimate
      const alpha = buffer[i - 1];
      const beta = val;
      const gamma = buffer[i + 1];
      let p = 0;
      const denom = alpha - 2 * beta + gamma;
      if (denom !== 0) {
        p = (0.5 * (alpha - gamma)) / denom;
      }
      const exactBin = i + p;
      const freq = exactBin * binSize;

      // Filter reasonable piano range
      if (freq > 25 && freq < 4500) {
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        // linear amplitude from dB
        const energy = Math.pow(10, val / 20);
        peaks.push({ midi, energy, freq });
      }
    }
  }

  // Aggregate energy by MIDI note
  const midiEnergy = new Map<number, number>();
  for (const peak of peaks) {
    midiEnergy.set(peak.midi, (midiEnergy.get(peak.midi) || 0) + peak.energy);
  }

  const activeNotes = Array.from(midiEnergy.entries())
    .map(([midi, energy]) => ({ midi, energy }))
    .sort((a, b) => b.energy - a.energy);
  const byMidi = new Map(activeNotes.map((n) => [n.midi, n]));

  // Harmonic suppression: real piano strings produce strong harmonics at integer multiples
  // We heavily penalize harmonics (octave, octave+fifth, 2 octaves) if their fundamental is playing
  for (let i = 0; i < activeNotes.length; i++) {
    const fundamental = activeNotes[i];
    if (fundamental.energy <= 0) continue;

    // Intervals: 12 (octave), 19 (octave+5th), 24 (2 octaves), 28, 31, 36...
    const harmonics = [12, 19, 24, 28, 31, 36];
    for (const h of harmonics) {
      const harmonic = byMidi.get(fundamental.midi + h);
      if (harmonic) {
        // Suppress harmonic energy less aggressively
        harmonic.energy -= fundamental.energy * 0.4;
      }
    }
  }

  // Determine an adaptive threshold based on the strongest note playing
  const maxEnergy = activeNotes.length > 0 ? activeNotes[0].energy : 0;
  if (maxEnergy < 0.001) return []; // Lower minimum overall energy to hear chords

  // In polyphony with 5-6 notes, energy is distributed and some notes are softer.
  // Using a lower threshold allows identifying more chord notes.
  const threshold = maxEnergy * 0.15; 

  const finalNotes = activeNotes
    .filter((n) => n.energy > threshold)
    .map((n) => n.midi);

  return finalNotes;
}
