import { AUDIO_CUES } from '@hearthside/game-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebAudioService } from './audioService';

function createMockAudioContext(initialState: AudioContextState = 'running') {
  const startSpy = vi.fn();
  const stopSpy = vi.fn();
  const resumeSpy = vi.fn().mockResolvedValue(undefined);
  const createOscillatorSpy = vi.fn(() => ({
    type: 'sine',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: startSpy,
    stop: stopSpy,
  }));
  const createGainSpy = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }));

  class MockAudioContext {
    state = initialState;
    currentTime = 0;
    destination = {};
    resume = resumeSpy;
    createOscillator = createOscillatorSpy;
    createGain = createGainSpy;
  }

  vi.stubGlobal('AudioContext', MockAudioContext);
  return { createOscillatorSpy, startSpy, resumeSpy };
}

describe('WebAudioService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays all synthesized SFX cues and unlocks suspended AudioContext', async () => {
    const { createOscillatorSpy, startSpy, resumeSpy } = createMockAudioContext('suspended');
    const audio = createWebAudioService();

    await audio.unlock();
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    for (const cue of AUDIO_CUES) {
      audio.playSfx(cue);
    }

    expect(createOscillatorSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
  });

  it('suppresses SFX when muted or volume is zero while keeping music settings independent', () => {
    const { createOscillatorSpy } = createMockAudioContext('running');
    const audio = createWebAudioService();

    audio.setSfxEnabled(false);
    audio.setMusicEnabled(true);
    audio.setMusicVolume(0.8);
    audio.playMusicTrack('hearthside-theme');
    audio.playSfx('place');
    expect(createOscillatorSpy).not.toHaveBeenCalled();

    expect(audio.getSnapshot()).toEqual({
      sfxEnabled: false,
      sfxVolume: 0.7,
      musicEnabled: true,
      musicVolume: 0.8,
      activeMusicTrack: 'hearthside-theme',
    });

    audio.setSfxEnabled(true);
    audio.setSfxVolume(0);
    audio.playSfx('win');
    expect(createOscillatorSpy).not.toHaveBeenCalled();

    audio.setSfxVolume(0.5);
    audio.playSfx('tap');
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);

    audio.stopMusic();
    expect(audio.getSnapshot().activeMusicTrack).toBeNull();
  });

  it('degrades gracefully when Web Audio API is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const audio = createWebAudioService();

    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(() => audio.playSfx('hint')).not.toThrow();
  });
});
