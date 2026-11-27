import type { GameMetadata, Profile } from '@hearthside/game-core';
import { ProfileAvatar } from './ProfileAvatar';

interface LibraryViewProps {
  readonly games: readonly GameMetadata[];
  readonly activeProfile: Profile;
  readonly onLaunchGame: (gameId: string, modeId?: string) => void;
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

export function LibraryView({ games, activeProfile, onLaunchGame }: LibraryViewProps) {
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
      </div>

      <div className="hs-game-grid">
        {games.map((game) => (
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
              {game.supportedModes.map((mode, index) => (
                <button
                  key={mode.id}
                  type="button"
                  className={index === 0 ? 'hs-btn hs-btn-primary' : 'hs-btn hs-btn-secondary'}
                  onClick={() => onLaunchGame(game.id, mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
