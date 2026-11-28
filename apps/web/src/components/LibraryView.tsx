import type {
  GameMetadata,
  LeaderboardOpenTarget,
  Profile,
  SaveSlotSummary,
} from '@hearthside/game-core';
import { useMemo } from 'react';
import { shellGameRegistry } from '../games/shellRegistry';
import { createGameStorageService } from '../storage/hearthsideDb';
import { FamilyDailyCard } from './FamilyDailyCard';
import { ProfileAvatar } from './ProfileAvatar';

export type SavedSlotsByGame = Readonly<Record<string, Readonly<Record<string, SaveSlotSummary>>>>;

interface LibraryViewProps {
  readonly games: readonly GameMetadata[];
  readonly activeProfile: Profile;
  readonly savedSlotsByGame: SavedSlotsByGame;
  readonly refreshVersion?: number;
  readonly signedIn?: boolean;
  readonly todayDateYYYYMMDD?: string;
  readonly leaderboardRefreshVersion?: number;
  readonly onOpenLeaderboard?: (target: LeaderboardOpenTarget) => void;
  readonly onLaunchGame: (gameId: string, modeId?: string) => void;
}

function formatResumeTime(elapsedMs?: number): string {
  if (elapsedMs === undefined || !Number.isFinite(elapsedMs)) {
    return '';
  }
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderGameIcon(icon: string) {
  if (icon === 'sudoku-grid') {
    return (
      <svg viewBox="0 0 32 32" className="hs-game-icon-svg" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="26"
          height="26"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <line x1="11.67" y1="3" x2="11.67" y2="29" stroke="currentColor" strokeWidth="1.6" />
        <line x1="20.33" y1="3" x2="20.33" y2="29" stroke="currentColor" strokeWidth="1.6" />
        <line x1="3" y1="11.67" x2="29" y2="11.67" stroke="currentColor" strokeWidth="1.6" />
        <line x1="3" y1="20.33" x2="29" y2="20.33" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" className="hs-game-icon-svg" aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="24"
        height="24"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
    </svg>
  );
}

export function LibraryView({
  games,
  activeProfile,
  savedSlotsByGame,
  refreshVersion = 0,
  signedIn = false,
  todayDateYYYYMMDD = '',
  leaderboardRefreshVersion = 0,
  onOpenLeaderboard,
  onLaunchGame,
}: LibraryViewProps) {
  const storageByGame = useMemo(() => {
    const map: Record<string, ReturnType<typeof createGameStorageService>> = {};
    for (const game of games) {
      map[game.id] = createGameStorageService(activeProfile.id, game.id);
    }
    return map;
  }, [activeProfile.id, games]);

  return (
    <section className="hs-library" aria-label="Game Library">
      <div className="hs-library-welcome">
        <div className="hs-library-player">
          <ProfileAvatar
            avatarId={activeProfile.avatarId}
            accentColor={activeProfile.accentColor}
            size="md"
          />
          <div>
            <h2 className="hs-section-title">Welcome, {activeProfile.name}</h2>
            <p className="hs-library-caption">
              Choose a game below. All saves, settings, and stats stay private to your profile.
            </p>
          </div>
        </div>
        {onOpenLeaderboard && signedIn ? (
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() =>
              onOpenLeaderboard({
                kind: 'daily',
                date: todayDateYYYYMMDD || undefined,
                difficulty: 'easy',
              })
            }
          >
            Leaderboards
          </button>
        ) : null}
      </div>

      {onOpenLeaderboard && todayDateYYYYMMDD ? (
        <FamilyDailyCard
          signedIn={signedIn}
          activeRemoteProfileId={activeProfile.remoteProfileId}
          dateYYYYMMDD={todayDateYYYYMMDD}
          refreshVersion={leaderboardRefreshVersion}
          onOpenLeaderboard={onOpenLeaderboard}
        />
      ) : null}

      <div className="hs-game-grid">
        {games.map((game) => {
          const gameSaves = savedSlotsByGame[game.id] ?? {};
          const registryEntry = shellGameRegistry.get(game.id);
          const LibraryExtras = registryEntry?.LibraryExtras;
          const gameStorage = storageByGame[game.id];

          return (
            <article key={game.id} className="hs-game-card">
              <div className="hs-game-card-top">
                <div className="hs-game-icon">{renderGameIcon(game.icon)}</div>
                <div className="hs-game-card-info">
                  <div className="hs-game-card-badges">
                    <h3 className="hs-game-card-title">{game.name}</h3>
                    {game.supportsOffline ? (
                      <span className="hs-badge" data-tone="success">
                        Offline
                      </span>
                    ) : null}
                  </div>
                  <p className="hs-game-card-desc">{game.description}</p>
                </div>
              </div>

              <div className="hs-btn-group">
                {game.supportedModes.map((mode, index) => {
                  const saveSummary = gameSaves[mode.id];
                  const resumeTime = formatResumeTime(saveSummary?.elapsedMs);
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={
                        index === 0 || saveSummary
                          ? 'hs-btn hs-btn-primary hs-mode-btn'
                          : 'hs-btn hs-btn-secondary hs-mode-btn'
                      }
                      onClick={() => onLaunchGame(game.id, mode.id)}
                    >
                      <span>{mode.label}</span>
                      {saveSummary ? (
                        <span className="hs-mode-resume">
                          Resume{resumeTime ? ` · ${resumeTime}` : ''}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {LibraryExtras && gameStorage ? (
                <LibraryExtras
                  activeProfile={activeProfile}
                  storage={gameStorage}
                  savedSlots={gameSaves}
                  refreshVersion={refreshVersion}
                  onLaunchMode={(modeId) => onLaunchGame(game.id, modeId)}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
