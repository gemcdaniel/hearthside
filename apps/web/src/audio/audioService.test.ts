import { AUDIO_CUES } from '@hearthside/game-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachAudioUnlockListeners, createWebAudioService } from './audioService';

function createMockAudioContext(initialState: AudioContextState = 'running') {
  const constructedSpy = vi.fn();
  const startSpy = vi.fn();
  const stopSpy = vi.fn();
  const resumeSpy = vi.fn().mockResolvedValue(undefined);
  const exponentialRampSpy = vi.fn();
  const linearRampSpy = vi.fn();
  const setValueSpy = vi.fn();
  const cancelScheduledSpy = vi.fn();
  const disconnectSpy = vi.fn();
  const filterFreqSpy = vi.fn();

  const createOscillatorSpy = vi.fn(() => ({
    type: 'sine',
    frequency: { setValueAtTime: vi.fn() },
    detune: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: startSpy,
    stop: stopSpy,
  }));

  const createGainSpy = vi.fn(() => ({
    gain: {
      value: 0,
      setValueAtTime: setValueSpy,
      linearRampToValueAtTime: linearRampSpy,
      exponentialRampToValueAtTime: exponentialRampSpy,
      cancelScheduledValues: cancelScheduledSpy,
    },
    connect: vi.fn(),
    disconnect: disconnectSpy,
  }));

  const createBiquadFilterSpy = vi.fn(() => ({
    type: 'lowpass',
    frequency: { setValueAtTime: filterFreqSpy },
    Q: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: disconnectSpy,
  }));

  const createStereoPannerSpy = vi.fn(() => ({
    pan: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
  }));

  const createDynamicsCompressorSpy = vi.fn(() => ({
    threshold: { setValueAtTime: vi.fn() },
    ratio: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
  }));

  class MockAudioContext {
    state = initialState;
    currentTime = 1.5;
    destination = {};
    resume = resumeSpy;
    createOscillator = createOscillatorSpy;
    createGain = createGainSpy;
    createBiquadFilter = createBiquadFilterSpy;
    createStereoPanner = createStereoPannerSpy;
    createDynamicsCompressor = createDynamicsCompressorSpy;

    constructor() {
      constructedSpy();
    }
  }

  vi.stubGlobal('AudioContext', MockAudioContext);
  return {
    constructedSpy,
    createOscillatorSpy,
    createGainSpy,
    createBiquadFilterSpy,
    createStereoPannerSpy,
    startSpy,
    resumeSpy,
    exponentialRampSpy,
    linearRampSpy,
    setValueSpy,
    filterFreqSpy,
  };
}

describe('WebAudioService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('plays all synthesized SFX cues including unitComplete and uses click-free ramps', async () => {
    const mocks = createMockAudioContext('suspended');
    const audio = createWebAudioService();

    await audio.unlock();
    expect(mocks.resumeSpy).toHaveBeenCalledTimes(1);

    for (const cue of AUDIO_CUES) {
      audio.playSfx(cue);
    }

    expect(AUDIO_CUES).toContain('unitComplete');
    expect(mocks.createOscillatorSpy).toHaveBeenCalled();
    expect(mocks.startSpy).toHaveBeenCalled();
    expect(mocks.linearRampSpy).toHaveBeenCalled();
    expect(mocks.exponentialRampSpy).not.toHaveBeenCalled();

    audio.resetForTests();
  });

  it('respects browser autoplay policy until first unlock gesture, then plays & scales music smoothly', async () => {
    const mocks = createMockAudioContext('running');
    const audio = createWebAudioService();

    audio.playMusicTrack('warm-hearthside');
    audio.setMusicEnabled(true);
    audio.setMusicVolume(0.6);

    // Must not instantiate AudioContext or play prior to user gesture unlock
    expect(mocks.constructedSpy).not.toHaveBeenCalled();
    expect(audio.getSnapshot().musicPlaying).toBe(false);

    await audio.unlock();
    expect(mocks.constructedSpy).toHaveBeenCalledTimes(1);
    expect(audio.getSnapshot()).toEqual({
      sfxEnabled: true,
      sfxVolume: 0.7,
      musicEnabled: true,
      musicVolume: 0.6,
      activeMusicTrack: 'warm-hearthside',
      musicPlaying: true,
    });
    expect(mocks.createBiquadFilterSpy).toHaveBeenCalled();
    expect(mocks.createStereoPannerSpy).toHaveBeenCalled();

    // Volume update ramps cleanly without popping
    const prevRampCalls = mocks.linearRampSpy.mock.calls.length;
    audio.setMusicVolume(0.25);
    expect(mocks.linearRampSpy.mock.calls.length).toBeGreaterThan(prevRampCalls);
    expect(mocks.exponentialRampSpy).not.toHaveBeenCalled();

    // Live theme switch crossfades to clean-minimal (higher lowpass frequency ~1850 Hz)
    audio.playMusicTrack('clean-minimal');
    expect(audio.getSnapshot().activeMusicTrack).toBe('clean-minimal');
    expect(mocks.filterFreqSpy).toHaveBeenCalledWith(1850, expect.any(Number));

    // Disabling music pauses smoothly without losing track selection
    audio.setMusicEnabled(false);
    expect(audio.getSnapshot().musicPlaying).toBe(false);
    expect(audio.getSnapshot().activeMusicTrack).toBe('clean-minimal');

    audio.stopMusic();
    expect(audio.getSnapshot().activeMusicTrack).toBeNull();
    audio.resetForTests();
  });

  it('suppresses SFX when muted or zero volume while keeping music controls independent', async () => {
    const mocks = createMockAudioContext('running');
    const audio = createWebAudioService();

    await audio.unlock();
    audio.setSfxEnabled(false);
    audio.setMusicEnabled(true);
    audio.setMusicVolume(0.8);
    audio.playMusicTrack('warm-hearthside');

    const oscBefore = mocks.createOscillatorSpy.mock.calls.length;
    audio.playSfx('place');
    expect(mocks.createOscillatorSpy).toHaveBeenCalledTimes(oscBefore);

    audio.setSfxEnabled(true);
    audio.setSfxVolume(0);
    audio.playSfx('win');
    expect(mocks.createOscillatorSpy).toHaveBeenCalledTimes(oscBefore);

    audio.setSfxVolume(0.5);
    audio.playSfx('tap');
    expect(mocks.createOscillatorSpy).toHaveBeenCalledTimes(oscBefore + 1);

    audio.resetForTests();
  });

  it('auto-pauses on visibilitychange hidden and resumes when visible again only if still enabled', async () => {
    createMockAudioContext('running');
    const audio = createWebAudioService();
    const detach = attachAudioUnlockListeners(audio);

    audio.playMusicTrack('clean-minimal');
    audio.setMusicEnabled(true);
    await audio.unlock();
    expect(audio.getSnapshot().musicPlaying).toBe(true);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio.getSnapshot().musicPlaying).toBe(false);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio.getSnapshot().musicPlaying).toBe(true);

    // If user muted music while hidden or before hiding again, returning visible stays silent
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    audio.setMusicEnabled(false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio.getSnapshot().musicPlaying).toBe(false);

    detach();
    audio.resetForTests();
  });

  it('degrades gracefully when Web Audio API is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const audio = createWebAudioService();

    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(() => audio.playSfx('hint')).not.toThrow();
    expect(() => audio.setMusicEnabled(true)).not.toThrow();
    expect(() => audio.playMusicTrack('warm-hearthside')).not.toThrow();
    expect(audio.getSnapshot().musicPlaying).toBe(false);
  });
});
