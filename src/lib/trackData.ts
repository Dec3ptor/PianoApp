import data from "./trackData.json";

export interface TrackNote {
  midi: number;
  duration: number; // in beats
  startTime: number; // in beats
}

export interface Track {
  title: string;
  bpm: number;
  notes: TrackNote[];
}

export const MOONLIGHT_SONATA: Track = data as Track;
