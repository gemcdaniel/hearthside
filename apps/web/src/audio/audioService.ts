import type { AudioCue, AudioService } from '@hearthside/game-core';

interface WebkitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface ToneSegment {
  readonly frequencyHz: number;
  readonly startOffsetSec: number;
  readonly durationSec: number;
  readonly type: OscillatorType;
  readonly gainMultiplier: number;
}

const CUE_SEQUENCES: Record<AudioCue, readonly ToneSegment[]> = {
  tap: [
    { frequencyHz: 520, startOffsetSec: 0, durationSec: 0.045, type: 'sine', gainMultiplier: 0.35 },
  ],
  place: [
    {
      frequencyHz: 440,
      startOffsetSec: 0,
      durationSec: 0.06,
      type: 'triangle',
      gainMultiplier: 0.5,
    },
    {
      frequencyHz: 587.33,
      startOffsetSec: 0.045,
      durationSec: 0.08,
      type: 'triangle',
      gainMultiplier: 0.45,
    },
  ],
  note: [
    { frequencyHz: 740, startOffsetSec: 0, durationSec: 0.04, type: 'sine', gainMultiplier: 0.3 },
  ],
  erase: [
    { frequencyHz: 330, startOffsetSec: 0, durationSec: 0.055, type: 'sine', gainMultiplier: 0.35 },
    {
      frequencyHz: 247,
      startOffsetSec: 0.04,
      durationSec: 0.06,
      type: 'sine',
      gainMultiplier: 0.25,
    },
  ],
  conflict: [
    {
      frequencyHz: 220,
      startOffsetSec: 0,
      durationSec: 0.09,
      type: 'sawtooth',
      gainMultiplier: 0.3,
    },
    {
      frequencyHz: 185,
      startOffsetSec: 0.08,
      durationSec: 0.12,
      type: 'sawtooth',
      gainMultiplier: 0.28,
    },
  ],
  hint: [
    {
      frequencyHz: 587.33,
      startOffsetSec: 0,
      durationSec: 0.08,
      type: 'triangle',
      gainMultiplier: 0.45,
    },
    {
      frequencyHz: 880,
      startOffsetSec: 0.075,
      durationSec: 0.14,
      type: 'triangle',
      gainMultiplier: 0.5,
    },
  ],
  win: [
    {
      frequencyHz: 523.25,
      startOffsetSec: 0,
      durationSec: 0.11,
      type: 'triangle',
      gainMultiplier: 0.55,
    },
    {
      frequencyHz: 659.25,
      startOffsetSec: 0.09,
      durationSec: 0.11,
      type: 'triangle',
      gainMultiplier: 0.55,
    },
    {
      frequencyHz: 783.99,
      startOffsetSec: 0.18,
      durationSec: 0.12,
      type: 'triangle',
      gainMultiplier: 0.55,
    },
    {
      frequencyHz: 1046.5,
      startOffsetSec: 0.27,
      durationSec: 0.26,
      type: 'triangle',
      gainMultiplier: 0.6,
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
}

export class WebAudioService implements AudioService {
  private ctx: AudioContext | null = null;
  private sfxEnabled = true;
  private sfxVolume = 0.7;
  private musicEnabled = false;
  private musicVolume = 0.4;
  private activeMusicTrack: string | null = null;

  private ensureContext(): AudioContext | null {
    const AudioCtx = resolveAudioContextConstructor();
    if (!AudioCtx) {
      return null;
    }
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore gesture-policy resume rejection prior to user interaction.
      }
    }
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

    const baseGain = 0.24 * this.sfxVolume;
    const now = ctx.currentTime;
    const segments = CUE_SEQUENCES[cue];

    for (const seg of segments) {
      const start = now + seg.startOffsetSec;
      const end = start + seg.durationSec;
      const peakGain = Math.max(0.0002, baseGain * seg.gainMultiplier);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(
        peakGain,
        start + Math.min(0.015, seg.durationSec * 0.4),
      );
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);
      gainNode.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = seg.type;
      osc.frequency.setValueAtTime(seg.frequencyHz, start);
      osc.connect(gainNode);

      osc.start(start);
      osc.stop(end + 0.005);
    }
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = clampVolume(volume);
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);
  }

  playMusicTrack(trackId: string): void {
    // Phase 3 will connect bundled music buffers/streams; keep active track state ready now (D24).
    this.activeMusicTrack = trackId.trim() || null;
  }

  stopMusic(): void {
    this.activeMusicTrack = null;
  }

  getSnapshot(): AudioChannelSnapshot {
    return {
      sfxEnabled: this.sfxEnabled,
      sfxVolume: this.sfxVolume,
      musicEnabled: this.musicEnabled,
      musicVolume: this.musicVolume,
      activeMusicTrack: this.activeMusicTrack,
    };
  }

  resetForTests(): void {
    this.ctx = null;
    this.sfxEnabled = true;
    this.sfxVolume = 0.7;
    this.musicEnabled = false;
    this.musicVolume = 0.4;
    this.activeMusicTrack = null;
  }
}

export function createWebAudioService(): WebAudioService {
  return new WebAudioService();
}

export const audioService = createWebAudioService();

export function attachAudioUnlockListeners(service: AudioService = audioService): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleFirstGesture = () => {
    void service.unlock();
  };

  window.addEventListener('pointerdown', handleFirstGesture, { once: true, passive: true });
  window.addEventListener('keydown', handleFirstGesture, { once: true, passive: true });

  return () => {
    window.removeEventListener('pointerdown', handleFirstGesture);
    window.removeEventListener('keydown', handleFirstGesture);
  };
}
