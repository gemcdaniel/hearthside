import type { AudioService, Profile, ProfileSettings } from '@hearthside/game-core';
import { useMemo } from 'react';
import { shellGameRegistry } from '../games/shellRegistry';
import { createGameStorageService } from '../storage/hearthsideDb';

interface GameHostProps {
  readonly gameId: string;
  readonly initialMode?: string;
  readonly activeProfile: Profile;
  readonly settings: ProfileSettings;
  readonly audio: AudioService;
  readonly onExitToLibrary: () => void;
}

export function GameHost({
  gameId,
  initialMode,
  activeProfile,
  settings,
  audio,
  onExitToLibrary,
}: GameHostProps) {
  const entry = shellGameRegistry.get(gameId);

  const storage = useMemo(
    () => createGameStorageService(activeProfile.id, gameId),
    [activeProfile.id, gameId],
  );

  if (!entry) {
    return (
      <section className="hs-diag-card" aria-label="Game unavailable">
        <p className="hs-diag-output">Game &ldquo;{gameId}&rdquo; is not registered.</p>
        <button type="button" className="hs-btn hs-btn-primary" onClick={onExitToLibrary}>
          Back to Library
        </button>
      </section>
    );
  }

  const GameComponent = entry.Component;
  const services = {
    activeProfile,
    settings,
    storage,
    audio,
    onExitToLibrary,
  };

  return (
    <section className="hs-game-host" aria-label={entry.metadata.name}>
      <GameComponent
        key={`${activeProfile.id}:${gameId}:${initialMode ?? ''}`}
        services={services}
        initialMode={initialMode}
      />
    </section>
  );
}
