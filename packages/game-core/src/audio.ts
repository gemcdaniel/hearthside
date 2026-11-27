export type AudioCue =
  'tap' | 'place' | 'note' | 'erase' | 'conflict' | 'hint' | 'unitComplete' | 'win';

export const AUDIO_CUES: readonly AudioCue[] = [
  'tap',
  'place',
  'note',
  'erase',
  'conflict',
  'hint',
  'unitComplete',
  'win',
];

export function isAudioCue(value: unknown): value is AudioCue {
  return typeof value === 'string' && (AUDIO_CUES as readonly string[]).includes(value);
}

export interface AudioService {
  unlock(): Promise<void>;
  playSfx(cue: AudioCue): void;
  setSfxEnabled(enabled: boolean): void;
  setSfxVolume(volume: number): void;
  setMusicEnabled(enabled: boolean): void;
  setMusicVolume(volume: number): void;
  playMusicTrack(trackId: string): void;
  stopMusic(): void;
}
