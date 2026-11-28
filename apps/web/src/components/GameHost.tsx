import type {
  AudioService,
  CloudSyncService,
  LeaderboardService,
  Profile,
  ProfileSettings,
} from '@hearthside/game-core';
import { useMemo } from 'react';
import { shellGameRegistry } from '../games/shellRegistry';
import { createGameStorageService } from '../storage/hearthsideDb';
import { createShellPuzzleSync } from '../sync/puzzleSync';

interface GameHostProps {
  readonly gameId: string;
  readonly initialMode?: string;
  readonly activeProfile: Profile;
  readonly settings: ProfileSettings;
  readonly audio: AudioService;
  readonly isSignedIn?: boolean;
  readonly reloadKey?: number;
  readonly syncService?: CloudSyncService;
  readonly leaderboardService?: LeaderboardService;
  readonly onExitToLibrary: () => void;
}

export function GameHost({
  gameId,
  initialMode,
  activeProfile,
  settings,
  audio,
  isSignedIn = false,
  reloadKey = 0,
  syncService,
  leaderboardService,
  onExitToLibrary,
}: GameHostProps) {
  const entry = shellGameRegistry.get(gameId);

  const storage = useMemo(
    () => createGameStorageService(activeProfile.id, gameId),
    [activeProfile.id, gameId],
  );
  const puzzleSync = useMemo(() => createShellPuzzleSync(isSignedIn), [isSignedIn]);

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
    puzzleSync,
    ...(syncService ? { sync: syncService } : {}),
    ...(leaderboardService ? { leaderboards: leaderboardService } : {}),
    onExitToLibrary,
  };

  return (
    <section className="hs-game-host" aria-label={entry.metadata.name}>
      <GameComponent
        key={`${activeProfile.id}:${gameId}:${initialMode ?? ''}:${reloadKey}`}
        services={services}
        initialMode={initialMode}
      />
    </section>
  );
}
