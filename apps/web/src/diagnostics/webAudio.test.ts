import { afterEach, describe, expect, it, vi } from 'vitest';
import { playSmokeChime, resetAudioContextForTests } from './webAudio';

describe('webAudio diagnostics helper', () => {
  afterEach(() => {
    resetAudioContextForTests();
    vi.unstubAllGlobals();
  });

  it('returns unsupported when AudioContext is missing', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const result = await playSmokeChime();
    expect(result.played).toBe(false);
    expect(result.state).toBe('unsupported');
  });

  it('resumes a suspended AudioContext and plays a chime on user click', async () => {
    const startMock = vi.fn();
    const stopMock = vi.fn();
    const resumeMock = vi.fn().mockImplementation(async function (this: { state: string }) {
      this.state = 'running';
    });

    class MockAudioContext {
      state: AudioContextState = 'suspended';
      currentTime = 1.0;
      destination = {};
      resume = resumeMock;
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: {
            setValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
          start: startMock,
          stop: stopMock,
        };
      }
    }

    vi.stubGlobal('AudioContext', MockAudioContext);

    const result = await playSmokeChime();
    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ played: true, state: 'running' });
  });
});
