interface WebkitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export interface WebAudioSmokeResult {
  readonly played: boolean;
  readonly state: AudioContextState | 'unsupported';
  readonly reason?: string;
}

let sharedAudioContext: AudioContext | null = null;

function resolveAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  if (typeof window.AudioContext === 'function') {
    return window.AudioContext;
  }
  return (window as WebkitAudioWindow).webkitAudioContext;
}

export function resetAudioContextForTests(): void {
  sharedAudioContext = null;
}

export async function playSmokeChime(): Promise<WebAudioSmokeResult> {
  const AudioCtx = resolveAudioContextConstructor();
  if (!AudioCtx) {
    return {
      played: false,
      state: 'unsupported',
      reason: 'Web Audio API is unavailable in this browser.',
    };
  }

  try {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioCtx();
    }

    if (sharedAudioContext.state === 'suspended') {
      await sharedAudioContext.resume();
    }

    const ctx = sharedAudioContext;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
    osc.connect(gain);

    osc.start(now);
    osc.stop(now + 0.25);

    return {
      played: true,
      state: ctx.state,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to start Web Audio playback.';
    return {
      played: false,
      state: sharedAudioContext?.state ?? 'unsupported',
      reason: message,
    };
  }
}
