import type { MusicChannel } from './musicChannel';

export const AMBIENT_TRACK_IDS = ['clean-minimal', 'warm-hearthside'] as const;
export type AmbientSoundscapeId = (typeof AMBIENT_TRACK_IDS)[number];

interface AmbientPreset {
  readonly id: AmbientSoundscapeId;
  readonly filterHz: number;
  readonly filterQ: number;
  readonly primaryType: OscillatorType;
  readonly shimmerType: OscillatorType;
  readonly shimmerRatio: number;
  readonly attackSec: number;
  readonly sustainSec: number;
  readonly releaseSec: number;
  readonly phraseIntervalMs: number;
  readonly baseVoiceGain: number;
  readonly chordsHz: readonly (readonly number[])[];
  readonly pans: readonly number[];
  readonly detunesCents: readonly number[];
}

const CLEAN_MINIMAL_PRESET: AmbientPreset = {
  id: 'clean-minimal',
  filterHz: 1850,
  filterQ: 0.7,
  primaryType: 'sine',
  shimmerType: 'triangle',
  shimmerRatio: 0.22,
  attackSec: 0.8,
  sustainSec: 0.5,
  releaseSec: 2.5,
  phraseIntervalMs: 4200,
  baseVoiceGain: 0.22,
  // Airy Cmaj7 -> Am9 -> Fmaj7 -> G6/9 voicings
  chordsHz: [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 329.63, 392.0, 493.88],
    [174.61, 261.63, 329.63, 440.0],
    [196.0, 293.66, 329.63, 493.88],
  ],
  pans: [-0.26, 0.22, -0.14, 0.28],
  detunesCents: [-4, 3, -2, 5],
};

const WARM_HEARTHSIDE_PRESET: AmbientPreset = {
  id: 'warm-hearthside',
  filterHz: 780,
  filterQ: 0.6,
  primaryType: 'triangle',
  shimmerType: 'sine',
  shimmerRatio: 0.45,
  attackSec: 0.34,
  sustainSec: 0.65,
  releaseSec: 3.0,
  phraseIntervalMs: 4500,
  baseVoiceGain: 0.24,
  // Cozy felt-piano Fmaj7 -> Dm9 -> Bbmaj7 -> C6/9 progression
  chordsHz: [
    [174.61, 220.0, 261.63, 329.63],
    [146.83, 220.0, 261.63, 329.63],
    [116.54, 174.61, 220.0, 293.66],
    [130.81, 196.0, 220.0, 293.66],
  ],
  pans: [-0.22, 0.18, -0.12, 0.24],
  detunesCents: [-6, 5, -3, 6],
};

const MUSIC_MAX_GAIN = 0.16;
const RAMP_VOLUME_SEC = 0.18;
const RAMP_FADE_IN_SEC = 0.26;
const RAMP_PAUSE_SEC = 0.22;
const RAMP_CROSSFADE_SEC = 0.28;
const LAYER_CLEANUP_DELAY_MS = 340;

function resolvePreset(trackId: string | null): AmbientPreset {
  if (trackId === 'clean-minimal') {
    return CLEAN_MINIMAL_PRESET;
  }
  return WARM_HEARTHSIDE_PRESET;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }
  return Math.max(0, Math.min(1, volume));
}

function rampGainLinear(
  param: AudioParam,
  targetValue: number,
  now: number,
  durationSec: number,
  fallbackStart?: number,
): void {
  const safeTarget = Math.max(0, targetValue);
  if (typeof param.cancelScheduledValues === 'function') {
    param.cancelScheduledValues(now);
  }
  const current =
    typeof param.value === 'number' && Number.isFinite(param.value)
      ? param.value
      : (fallbackStart ?? safeTarget);
  param.setValueAtTime(Math.max(0, current), now);
  if (typeof param.linearRampToValueAtTime === 'function') {
    param.linearRampToValueAtTime(safeTarget, now + durationSec);
  } else {
    param.setValueAtTime(safeTarget, now + durationSec);
  }
}

interface SoundscapeLayer {
  readonly trackId: string;
  readonly preset: AmbientPreset;
  readonly busGain: GainNode;
  readonly filter: BiquadFilterNode | null;
  chordIndex: number;
  timerId: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
}

export class ProceduralAmbientMusicChannel implements MusicChannel {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeLayer: SoundscapeLayer | null = null;
  private trackId: string | null = 'clean-minimal';
  private volume = 0.4;
  private playing = false;
  private currentMasterLevel = 0;
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();

  setTrack(trackId: string | null): void {
    const normalized = trackId?.trim() || null;
    if (normalized === this.trackId) {
      return;
    }
    this.trackId = normalized;

    if (!this.playing || !this.ctx || !this.masterGain) {
      return;
    }

    const previous = this.activeLayer;
    if (previous) {
      this.fadeOutAndDisposeLayer(previous, RAMP_CROSSFADE_SEC);
      this.activeLayer = null;
    }

    if (normalized) {
      this.startLayer(this.ctx, this.masterGain, normalized, true);
    }
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    if (!this.ctx || !this.masterGain || !this.playing) {
      return;
    }
    const now = this.ctx.currentTime;
    const target = MUSIC_MAX_GAIN * this.volume;
    rampGainLinear(this.masterGain.gain, target, now, RAMP_VOLUME_SEC, this.currentMasterLevel);
    this.currentMasterLevel = target;
  }

  start(ctx: AudioContext): void {
    if (!this.trackId) {
      return;
    }

    if (this.ctx !== ctx || !this.masterGain) {
      this.clearAllTimers();
      this.disposeLayerSync(this.activeLayer);
      this.activeLayer = null;
      this.ctx = ctx;
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(0, ctx.currentTime);
      this.masterGain.connect(ctx.destination);
      this.currentMasterLevel = 0;
    }

    this.playing = true;
    const now = ctx.currentTime;
    const targetGain = MUSIC_MAX_GAIN * this.volume;
    rampGainLinear(
      this.masterGain.gain,
      targetGain,
      now,
      RAMP_FADE_IN_SEC,
      this.currentMasterLevel,
    );
    this.currentMasterLevel = targetGain;

    if (!this.activeLayer || this.activeLayer.trackId !== this.trackId) {
      if (this.activeLayer) {
        this.fadeOutAndDisposeLayer(this.activeLayer, RAMP_CROSSFADE_SEC);
      }
      this.startLayer(ctx, this.masterGain, this.trackId, false);
    } else if (this.activeLayer.timerId === null && !this.activeLayer.disposed) {
      this.triggerPhrase(ctx, this.activeLayer);
      this.scheduleNextPhrase(ctx, this.activeLayer);
    }
  }

  pause(): void {
    if (!this.playing) {
      return;
    }
    this.playing = false;
    if (this.activeLayer?.timerId !== null && this.activeLayer) {
      clearTimeout(this.activeLayer.timerId);
      this.activeLayer.timerId = null;
    }
    if (this.ctx && this.masterGain) {
      rampGainLinear(
        this.masterGain.gain,
        0,
        this.ctx.currentTime,
        RAMP_PAUSE_SEC,
        this.currentMasterLevel,
      );
      this.currentMasterLevel = 0;
    }
  }

  stop(): void {
    this.playing = false;
    this.clearAllTimers();

    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      rampGainLinear(this.masterGain.gain, 0, now, RAMP_PAUSE_SEC, this.currentMasterLevel);
      this.currentMasterLevel = 0;
    }

    const layer = this.activeLayer;
    this.activeLayer = null;
    this.disposeLayerSync(layer);
    this.ctx = null;
    this.masterGain = null;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getTrackId(): string | null {
    return this.trackId;
  }

  private startLayer(
    ctx: AudioContext,
    destination: GainNode,
    trackId: string,
    crossfadeIn: boolean,
  ): void {
    const preset = resolvePreset(trackId);
    const busGain = ctx.createGain();
    const now = ctx.currentTime;

    if (crossfadeIn) {
      busGain.gain.setValueAtTime(0, now);
      rampGainLinear(busGain.gain, 1, now, RAMP_CROSSFADE_SEC, 0);
    } else {
      busGain.gain.setValueAtTime(1, now);
    }
    busGain.connect(destination);

    let filter: BiquadFilterNode | null = null;
    if (typeof ctx.createBiquadFilter === 'function') {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(preset.filterHz, now);
      filter.Q.setValueAtTime(preset.filterQ, now);
      filter.connect(busGain);
    }

    const layer: SoundscapeLayer = {
      trackId,
      preset,
      busGain,
      filter,
      chordIndex: 0,
      timerId: null,
      disposed: false,
    };
    this.activeLayer = layer;
    this.triggerPhrase(ctx, layer);
    this.scheduleNextPhrase(ctx, layer);
  }

  private scheduleNextPhrase(ctx: AudioContext, layer: SoundscapeLayer): void {
    if (!this.playing || layer.disposed) {
      return;
    }
    layer.timerId = setTimeout(() => {
      layer.timerId = null;
      if (!this.playing || layer.disposed || this.activeLayer !== layer) {
        return;
      }
      this.triggerPhrase(ctx, layer);
      this.scheduleNextPhrase(ctx, layer);
    }, layer.preset.phraseIntervalMs);
  }

  private triggerPhrase(ctx: AudioContext, layer: SoundscapeLayer): void {
    const { preset } = layer;
    const chord = preset.chordsHz[layer.chordIndex % preset.chordsHz.length] ?? preset.chordsHz[0];
    layer.chordIndex = (layer.chordIndex + 1) % preset.chordsHz.length;
    if (!chord) {
      return;
    }

    const baseTime = ctx.currentTime + 0.02;
    const targetOutput: AudioNode = layer.filter ?? layer.busGain;
    const voiceSpreadSec = preset.id === 'clean-minimal' ? 0.14 : 0.08;

    for (let i = 0; i < chord.length; i += 1) {
      const freq = chord[i];
      if (!freq) {
        continue;
      }
      const start = baseTime + i * voiceSpreadSec;
      const peakAt = start + preset.attackSec;
      const holdUntil = peakAt + preset.sustainSec;
      const end = holdUntil + preset.releaseSec;

      const pan = preset.pans[i] ?? 0;
      const detune = preset.detunesCents[i] ?? 0;

      let voiceTarget: AudioNode = targetOutput;
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, start);
        panner.connect(targetOutput);
        voiceTarget = panner;
      }

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      if (typeof env.gain.linearRampToValueAtTime === 'function') {
        env.gain.linearRampToValueAtTime(preset.baseVoiceGain, peakAt);
        env.gain.setValueAtTime(preset.baseVoiceGain, holdUntil);
        env.gain.linearRampToValueAtTime(0, end);
      } else {
        env.gain.setValueAtTime(preset.baseVoiceGain, peakAt);
        env.gain.setValueAtTime(0, end);
      }
      env.connect(voiceTarget);

      const primaryOsc = ctx.createOscillator();
      primaryOsc.type = preset.primaryType;
      primaryOsc.frequency.setValueAtTime(freq, start);
      if (primaryOsc.detune && typeof primaryOsc.detune.setValueAtTime === 'function') {
        primaryOsc.detune.setValueAtTime(detune, start);
      }
      primaryOsc.connect(env);
      primaryOsc.start(start);
      primaryOsc.stop(end + 0.03);

      // Subtle harmonic shimmer voice for acoustic warmth / airiness
      const shimmerEnv = ctx.createGain();
      const shimmerPeak = preset.baseVoiceGain * preset.shimmerRatio;
      shimmerEnv.gain.setValueAtTime(0, start);
      if (typeof shimmerEnv.gain.linearRampToValueAtTime === 'function') {
        shimmerEnv.gain.linearRampToValueAtTime(shimmerPeak, peakAt + 0.08);
        shimmerEnv.gain.linearRampToValueAtTime(0, end - 0.15);
      } else {
        shimmerEnv.gain.setValueAtTime(shimmerPeak, peakAt);
        shimmerEnv.gain.setValueAtTime(0, end - 0.15);
      }
      shimmerEnv.connect(voiceTarget);

      const shimmerOsc = ctx.createOscillator();
      shimmerOsc.type = preset.shimmerType;
      const shimmerFreq = preset.id === 'clean-minimal' && i === chord.length - 1 ? freq * 2 : freq;
      shimmerOsc.frequency.setValueAtTime(shimmerFreq, start);
      if (shimmerOsc.detune && typeof shimmerOsc.detune.setValueAtTime === 'function') {
        shimmerOsc.detune.setValueAtTime(-detune, start);
      }
      shimmerOsc.connect(shimmerEnv);
      shimmerOsc.start(start);
      shimmerOsc.stop(end + 0.03);
    }
  }

  private fadeOutAndDisposeLayer(layer: SoundscapeLayer, durationSec: number): void {
    layer.disposed = true;
    if (layer.timerId !== null) {
      clearTimeout(layer.timerId);
      layer.timerId = null;
    }
    if (this.ctx) {
      rampGainLinear(layer.busGain.gain, 0, this.ctx.currentTime, durationSec, 1);
    }
    const cleanupTimer = setTimeout(() => {
      this.cleanupTimers.delete(cleanupTimer);
      this.disconnectLayerNodes(layer);
    }, LAYER_CLEANUP_DELAY_MS);
    this.cleanupTimers.add(cleanupTimer);
  }

  private disposeLayerSync(layer: SoundscapeLayer | null): void {
    if (!layer) {
      return;
    }
    layer.disposed = true;
    if (layer.timerId !== null) {
      clearTimeout(layer.timerId);
      layer.timerId = null;
    }
    this.disconnectLayerNodes(layer);
  }

  private disconnectLayerNodes(layer: SoundscapeLayer): void {
    if (layer.filter && typeof layer.filter.disconnect === 'function') {
      layer.filter.disconnect();
    }
    if (typeof layer.busGain.disconnect === 'function') {
      layer.busGain.disconnect();
    }
  }

  private clearAllTimers(): void {
    if (this.activeLayer?.timerId !== null && this.activeLayer) {
      clearTimeout(this.activeLayer.timerId);
      this.activeLayer.timerId = null;
    }
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }
}
