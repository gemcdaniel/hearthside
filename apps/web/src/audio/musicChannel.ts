export interface MusicChannel {
  setTrack(trackId: string | null): void;
  setVolume(volume: number): void;
  start(ctx: AudioContext): void;
  pause(): void;
  stop(): void;
  isPlaying(): boolean;
  getTrackId(): string | null;
}
