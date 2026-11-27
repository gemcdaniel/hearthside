import type { AudioCue, AudioService } from '@hearthside/game-core';
import type { MusicChannel } from './musicChannel';
import { ProceduralAmbientMusicChannel } from './proceduralMusic';

interface WebkitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface ToneSegment {
  readonly frequencyHz: number;
  readonly startOffsetSec: number;
  readonly durationSec: number;
  readonly type: OscillatorType;
  readonly gainMultiplier: number;
  readonly filterHz?: number;
}

const CUE_SEQUENCES: Record<AudioCue, readonly ToneSegment[]> = {
  tap: [
    {
      frequencyHz: 560,
      startOffsetSec: 0,
      durationSec: 0.036,
      type: 'sine',
      gainMultiplier: 0.28,
    },
  ],
  place: [
    {
      frequencyHz: 440,
      startOffsetSec: 0,
      durationSec: 0.055,
      type: 'triangle',
      gainMultiplier: 0.42,
      filterHz: 2600,
    },
    {
      frequencyHz: 659.25,
      startOffsetSec: 0.042,
      durationSec: 0.085,
      type: 'triangle',
      gainMultiplier: 0.38,
      filterHz: 2600,
    },
  ],
  note: [
    {
      frequencyHz: 784,
      startOffsetSec: 0,
      durationSec: 0.038,
      type: 'sine',
      gainMultiplier: 0.24,
    },
  ],
  erase: [
    {
      frequencyHz: 340,
      startOffsetSec: 0,
      durationSec: 0.05,
      type: 'sine',
      gainMultiplier: 0.3,
    },
    {
      frequencyHz: 240,
      startOffsetSec: 0.038,
      durationSec: 0.06,
      type: 'sine',
      gainMultiplier: 0.22,
    },
  ],
  conflict: [
    {
      frequencyHz: 220,
      startOffsetSec: 0,
      durationSec: 0.085,
      type: 'triangle',
      gainMultiplier: 0.34,
      filterHz: 650,
    },
    {
      frequencyHz: 196,
      startOffsetSec: 0.075,
      durationSec: 0.115,
      type: 'triangle',
      gainMultiplier: 0.3,
      filterHz: 620,
    },
  ],
  hint: [
    {
      frequencyHz: 587.33,
      startOffsetSec: 0,
      durationSec: 0.08,
      type: 'triangle',
      gainMultiplier: 0.38,
      filterHz: 2800,
    },
    {
      frequencyHz: 880,
      startOffsetSec: 0.072,
      durationSec: 0.145,
      type: 'triangle',
      gainMultiplier: 0.42,
      filterHz: 2800,
    },
  ],
  unitComplete: [
    {
      frequencyHz: 523.25,
      startOffsetSec: 0,
      durationSec: 0.085,
      type: 'triangle',
      gainMultiplier: 0.4,
      filterHz: 2600,
    },
    {
      frequencyHz: 659.25,
      startOffsetSec: 0.07,
      durationSec: 0.095,
      type: 'triangle',
      gainMultiplier: 0.42,
      filterHz: 2600,
    },
    {
      frequencyHz: 783.99,
      startOffsetSec: 0.14,
      durationSec: 0.16,
      type: 'sine',
      gainMultiplier: 0.48,
    },
  ],
  win: [
    {
      frequencyHz: 523.25,
      startOffsetSec: 0,
      durationSec: 0.11,
      type: 'triangle',
      gainMultiplier: 0.46,
      filterHz: 2800,
    },
    {
      frequencyHz: 659.25,
      startOffsetSec: 0.085,
      durationSec: 0.11,
      type: 'triangle',
      gainMultiplier: 0.46,
      filterHz: 2800,
    },
    {
      frequencyHz: 783.99,
      startOffsetSec: 0.17,
      durationSec: 0.12,
      type: 'triangle',
      gainMultiplier: 0.48,
      filterHz: 3000,
    },
    {
      frequencyHz: 1046.5,
      startOffsetSec: 0.255,
      durationSec: 0.28,
      type: 'sine',
      gainMultiplier: 0.54,
    },
  ],
};

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function resolveAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  if (typeof window.AudioContext === 'function') {
    return window.AudioContext;
  }
  return (window as WebkitAudioWindow).webkitAudioContext;
}

export interface AudioChannelSnapshot {
  readonly sfxEnabled: boolean;
  readonly sfxVolume: number;
  readonly musicEnabled: boolean;
  readonly musicVolume: number;
  readonly activeMusicTrack: string | null;
  readonly musicPlaying: boolean;
}

export class WebAudioService implements AudioService {
  private ctx: AudioContext | null = null;
  private sfxOutputNode: AudioNode | null = null;
  private sfxEnabled = true;
  private sfxVolume = 0.7;
  private musicEnabled = false;
  private musicVolume = 0.4;
  private gestureUnlocked = false;
  private pageHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;
  private readonly musicChannel: MusicChannel;

  constructor(musicChannel: MusicChannel = new ProceduralAmbientMusicChannel()) {
    this.musicChannel = musicChannel;
    this.musicChannel.setVolume(this.musicVolume);
  }

  private ensureContext(): AudioContext | null {
    const AudioCtx = resolveAudioContextConstructor();
    if (!AudioCtx) {
      return null;
    }
    if (!this.ctx || this.ctx.state === 'closed') {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const sfxMaster = ctx.createGain();
      sfxMaster.gain.setValueAtTime(1, ctx.currentTime);
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-12, ctx.currentTime);
        compressor.ratio.setValueAtTime(4, ctx.currentTime);
        sfxMaster.connect(compressor);
        compressor.connect(ctx.destination);
      } else {
        sfxMaster.connect(ctx.destination);
      }
      this.sfxOutputNode = sfxMaster;
    }
    return this.ctx;
  }

  private syncMusicPlayback(): void {
    if (!this.musicEnabled || !this.gestureUnlocked || this.pageHidden) {
      this.musicChannel.pause();
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    if (this.musicChannel.getTrackId() === null) {
      this.musicChannel.setTrack('clean-minimal');
    }
    this.musicChannel.setVolume(this.musicVolume);
    this.musicChannel.start(ctx);
  }

  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) {
      this.gestureUnlocked = true;
      return;
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore gesture-policy resume rejection prior to user interaction.
      }
    }
    this.gestureUnlocked = true;
    this.syncMusicPlayback();
  }

  playSfx(cue: AudioCue): void {
    if (!this.sfxEnabled || this.sfxVolume <= 0) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const baseGain = 0.22 * this.sfxVolume;
    const now = ctx.currentTime;
    const segments = CUE_SEQUENCES[cue];
    const output = this.sfxOutputNode ?? ctx.destination;

    for (const seg of segments) {
      const start = now + seg.startOffsetSec;
      const end = start + seg.durationSec;
      const attackEnd = start + Math.min(0.012, seg.durationSec * 0.35);
      const peakGain = Math.max(0.0005, baseGain * seg.gainMultiplier);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, start);
      if (typeof gainNode.gain.linearRampToValueAtTime === 'function') {
        gainNode.gain.linearRampToValueAtTime(peakGain, attackEnd);
        gainNode.gain.linearRampToValueAtTime(0, end);
      } else {
        gainNode.gain.setValueAtTime(peakGain, attackEnd);
        gainNode.gain.setValueAtTime(0, end);
      }

      if (seg.filterHz !== undefined && typeof ctx.createBiquadFilter === 'function') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(seg.filterHz, start);
        gainNode.connect(filter);
        filter.connect(output);
      } else {
        gainNode.connect(output);
      }

      const osc = ctx.createOscillator();
      osc.type = seg.type;
      osc.frequency.setValueAtTime(seg.frequencyHz, start);
      osc.connect(gainNode);

      osc.start(start);
      osc.stop(end + 0.01);
    }
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = clampVolume(volume);
  }

  setMusicEnabled(enabled: boolean): void {
    if (this.musicEnabled === enabled) {
      return;
    }
    this.musicEnabled = enabled;
    this.syncMusicPlayback();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);
    this.musicChannel.setVolume(this.musicVolume);
  }

  playMusicTrack(trackId: string): void {
    const normalized = trackId.trim() || null;
    this.musicChannel.setTrack(normalized);
    if (this.musicEnabled && this.gestureUnlocked && !this.pageHidden && normalized !== null) {
      this.syncMusicPlayback();
    }
  }

  stopMusic(): void {
    this.musicChannel.stop();
    this.musicChannel.setTrack(null);
  }

  setPageHidden(hidden: boolean): void {
    this.pageHidden = hidden;
    if (hidden) {
      this.musicChannel.pause();
    } else {
      this.syncMusicPlayback();
    }
  }

  getSnapshot(): AudioChannelSnapshot {
    return {
      sfxEnabled: this.sfxEnabled,
      sfxVolume: this.sfxVolume,
      musicEnabled: this.musicEnabled,
      musicVolume: this.musicVolume,
      activeMusicTrack: this.musicChannel.getTrackId(),
      musicPlaying: this.musicChannel.isPlaying(),
    };
  }

  resetForTests(): void {
    this.musicChannel.stop();
    this.musicChannel.setTrack(null);
    this.ctx = null;
    this.sfxOutputNode = null;
    this.sfxEnabled = true;
    this.sfxVolume = 0.7;
    this.musicEnabled = false;
    this.musicVolume = 0.4;
    this.musicChannel.setVolume(0.4);
    this.gestureUnlocked = false;
    this.pageHidden = false;
  }
}

export function createWebAudioService(musicChannel?: MusicChannel): WebAudioService {
  return new WebAudioService(musicChannel);
}

export const audioService = createWebAudioService();

export function attachAudioUnlockListeners(service: AudioService = audioService): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleFirstGesture = () => {
    window.removeEventListener('pointerdown', handleFirstGesture);
    window.removeEventListener('keydown', handleFirstGesture);
    void service.unlock();
  };

  const handleVisibilityChange = () => {
    if (service instanceof WebAudioService) {
      service.setPageHidden(document.hidden);
    }
  };

  window.addEventListener('pointerdown', handleFirstGesture, { once: true, passive: true });
  window.addEventListener('keydown', handleFirstGesture, { once: true, passive: true });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return () => {
    window.removeEventListener('pointerdown', handleFirstGesture);
    window.removeEventListener('keydown', handleFirstGesture);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
