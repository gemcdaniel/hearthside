import {
  isAvatarId,
  isProfileAccentId,
  type LeaderboardDifficulty,
  type LeaderboardEntry,
  type LeaderboardOpenTarget,
  type LeaderboardScope,
} from '@hearthside/game-core';
import { useFocusTrap } from '@hearthside/ui';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { getDailyLeaderboard, getPuzzleLeaderboard, isNavigatorOnline } from '../api/client';
import { ProfileAvatar } from './ProfileAvatar';

export interface LeaderboardModalProps {
  readonly open: boolean;
  readonly signedIn: boolean;
  readonly activeRemoteProfileId?: string;
  readonly initialTarget: LeaderboardOpenTarget;
  readonly todayDateYYYYMMDD: string;
  readonly refreshVersion?: number;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

const DIFFICULTIES: readonly { readonly id: LeaderboardDifficulty; readonly label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

function formatMMSS(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function shiftDateYYYYMMDD(dateYYYYMMDD: string, deltaDays: number): string {
  const [yStr, mStr, dStr] = dateYYYYMMDD.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return dateYYYYMMDD;
  }
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function RankBadge({ rank }: { readonly rank: number }) {
  return (
    <span className="hs-lb-rank" data-top={rank <= 3 ? String(rank) : 'other'}>
      {rank <= 3 ? (
        <svg viewBox="0 0 16 16" className="hs-lb-medal-icon" aria-hidden="true" focusable="false">
          <circle cx="8" cy="9" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M5.5 2.2 7 5.2M10.5 2.2 9 5.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      <span>#{rank}</span>
    </span>
  );
}

export function LeaderboardModal({
  open,
  signedIn,
  activeRemoteProfileId,
  initialTarget,
  todayDateYYYYMMDD,
  refreshVersion = 0,
  returnFocusRef,
  onClose,
}: LeaderboardModalProps) {
  const [modeKind, setModeKind] = useState<'daily' | 'puzzle'>(initialTarget.kind);
  const [dailyDate, setDailyDate] = useState(
    initialTarget.kind === 'daily' && initialTarget.date ? initialTarget.date : todayDateYYYYMMDD,
  );
  const [difficulty, setDifficulty] = useState<LeaderboardDifficulty>(
    initialTarget.kind === 'daily' && initialTarget.difficulty ? initialTarget.difficulty : 'easy',
  );
  const [puzzleId, setPuzzleId] = useState(
    initialTarget.kind === 'puzzle' ? initialTarget.puzzleId : '',
  );
  const [puzzleLabel, setPuzzleLabel] = useState(
    initialTarget.kind === 'puzzle' ? (initialTarget.label ?? 'Puzzle Board') : '',
  );
  const [scope, setScope] = useState<LeaderboardScope>('household');
  const [noHintsOnly, setNoHintsOnly] = useState(false);

  const [entries, setEntries] = useState<readonly LeaderboardEntry[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'offline' | 'error'>(
    'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    setModeKind(initialTarget.kind);
    if (initialTarget.kind === 'daily') {
      setDailyDate(initialTarget.date ?? todayDateYYYYMMDD);
      setDifficulty(initialTarget.difficulty ?? 'easy');
    } else {
      setPuzzleId(initialTarget.puzzleId);
      setPuzzleLabel(initialTarget.label ?? 'This Puzzle');
    }
  }, [open, initialTarget, todayDateYYYYMMDD]);

  useFocusTrap(modalRef, {
    active: open,
    onEscape: onClose,
    returnFocusRef,
  });

  const fetchBoard = useCallback(async () => {
    if (!open || !signedIn) {
      return;
    }
    if (!isNavigatorOnline()) {
      setLoadState('offline');
      return;
    }

    setLoadState('loading');
    setErrorMessage(null);

    const res =
      modeKind === 'puzzle' && puzzleId
        ? await getPuzzleLeaderboard(puzzleId, { scope, noHintsOnly })
        : await getDailyLeaderboard({
            date: dailyDate,
            difficulty,
            scope,
            noHintsOnly,
          });

    if (res.status === 'ok') {
      setEntries(res.data.entries);
      setLoadState('ready');
    } else if (res.status === 'offline' || res.status === 'unavailable') {
      setLoadState('offline');
    } else if (res.status === 'unauthorized') {
      setEntries([]);
      setLoadState('error');
      setErrorMessage('Sign in again to view household and friends leaderboards.');
    } else {
      setLoadState('error');
      setErrorMessage(res.message);
    }
  }, [open, signedIn, modeKind, puzzleId, dailyDate, difficulty, scope, noHintsOnly]);

  useEffect(() => {
    if (open && signedIn) {
      void fetchBoard();
    } else if (open && !signedIn) {
      setEntries([]);
      setLoadState('idle');
    }
  }, [open, signedIn, refreshVersion, fetchBoard]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="hs-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={modalRef}
        className="hs-modal hs-lb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="hs-modal-header">
          <div>
            <h2 id={titleId} className="hs-section-title">
              Leaderboards
            </h2>
            <p className="hs-account-meta">
              {modeKind === 'puzzle' ? puzzleLabel : `Daily Sudoku · ${dailyDate}`}
            </p>
          </div>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="hs-modal-body">
          {!signedIn ? (
            <div className="hs-lb-empty" role="status">
              <p className="hs-account-meta">
                Sign in to a household account in Settings to view Household and Friends
                leaderboards. Offline solo play stays saved locally on your device.
              </p>
            </div>
          ) : (
            <>
              {!activeRemoteProfileId ? (
                <p className="hs-account-meta" role="status">
                  Your active local profile is not linked yet. Link or switch profiles in Settings
                  to submit your own times.
                </p>
              ) : null}

              <div className="hs-lb-toolbar">
                <div className="hs-btn-group" role="tablist" aria-label="Leaderboard scope">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={scope === 'household'}
                    className={`hs-btn ${scope === 'household' ? 'hs-btn-primary' : 'hs-btn-secondary'}`}
                    onClick={() => setScope('household')}
                  >
                    Household
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={scope === 'friends'}
                    className={`hs-btn ${scope === 'friends' ? 'hs-btn-primary' : 'hs-btn-secondary'}`}
                    onClick={() => setScope('friends')}
                  >
                    Friends
                  </button>
                </div>

                <button
                  type="button"
                  className={`hs-btn ${noHintsOnly ? 'hs-btn-primary' : 'hs-btn-secondary'}`}
                  aria-pressed={noHintsOnly}
                  onClick={() => setNoHintsOnly((prev) => !prev)}
                >
                  No-Hint Only
                </button>
              </div>

              {modeKind === 'daily' ? (
                <div className="hs-lb-daily-controls">
                  <div className="hs-btn-group" role="group" aria-label="Daily difficulty">
                    {DIFFICULTIES.map((tier) => (
                      <button
                        key={tier.id}
                        type="button"
                        className={`hs-btn ${difficulty === tier.id ? 'hs-btn-primary' : 'hs-btn-secondary'}`}
                        aria-pressed={difficulty === tier.id}
                        onClick={() => setDifficulty(tier.id)}
                      >
                        {tier.label}
                      </button>
                    ))}
                  </div>

                  <div className="hs-btn-group" role="group" aria-label="Daily date">
                    <button
                      type="button"
                      className="hs-btn hs-btn-secondary"
                      onClick={() => setDailyDate((d) => shiftDateYYYYMMDD(d, -1))}
                    >
                      Previous Day
                    </button>
                    <span className="hs-lb-date-label">{dailyDate}</span>
                    <button
                      type="button"
                      className="hs-btn hs-btn-secondary"
                      disabled={dailyDate >= todayDateYYYYMMDD}
                      onClick={() => setDailyDate((d) => shiftDateYYYYMMDD(d, 1))}
                    >
                      Next Day
                    </button>
                  </div>
                </div>
              ) : (
                <div className="hs-lb-daily-controls">
                  <span className="hs-badge" data-tone="success">
                    This Puzzle
                  </span>
                  <button
                    type="button"
                    className="hs-btn hs-btn-secondary"
                    onClick={() => {
                      setModeKind('daily');
                      setDailyDate(todayDateYYYYMMDD);
                    }}
                  >
                    Switch to Daily Boards
                  </button>
                </div>
              )}

              {loadState === 'loading' ? (
                <p className="hs-account-meta" role="status">
                  Loading verified times…
                </p>
              ) : loadState === 'offline' ? (
                <div className="hs-lb-empty" role="status">
                  <p className="hs-account-meta">
                    Offline — connect to your home server to load leaderboard standings.
                  </p>
                  <button
                    type="button"
                    className="hs-btn hs-btn-secondary"
                    onClick={() => void fetchBoard()}
                  >
                    Retry
                  </button>
                </div>
              ) : loadState === 'error' ? (
                <div className="hs-lb-empty" role="status">
                  <p className="hs-account-meta">
                    {errorMessage ?? 'Unable to load leaderboard standings.'}
                  </p>
                  <button
                    type="button"
                    className="hs-btn hs-btn-secondary"
                    onClick={() => void fetchBoard()}
                  >
                    Retry
                  </button>
                </div>
              ) : entries.length === 0 ? (
                <div className="hs-lb-empty" role="status">
                  <p className="hs-account-meta">No verified times yet — be the first!</p>
                </div>
              ) : (
                <ol className="hs-lb-list" aria-label="Ranked verified times">
                  {entries.map((entry) => {
                    const avatarId = isAvatarId(entry.avatarId) ? entry.avatarId : 'hearth';
                    const accentColor = isProfileAccentId(entry.accentColor)
                      ? entry.accentColor
                      : 'cobalt';
                    const isSelf = activeRemoteProfileId === entry.profileId;
                    return (
                      <li
                        key={entry.profileId}
                        className="hs-lb-row"
                        data-self={isSelf ? 'true' : 'false'}
                      >
                        <div className="hs-lb-row-left">
                          <RankBadge rank={entry.rank} />
                          <ProfileAvatar avatarId={avatarId} accentColor={accentColor} size="sm" />
                          <div className="hs-lb-row-names">
                            <span className="hs-profile-row-name">{entry.profileName}</span>
                            <div className="hs-lb-row-tags">
                              {entry.isChild ? (
                                <span className="hs-badge" data-tone="warning">
                                  Child
                                </span>
                              ) : null}
                              {scope === 'friends' && !entry.isOwnHousehold ? (
                                <span className="hs-badge" data-tone="success">
                                  {entry.householdName}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="hs-lb-row-metrics">
                          <span className="hs-lb-time">{formatMMSS(entry.elapsedMs)}</span>
                          <span
                            className="hs-badge"
                            data-tone={entry.hintsUsed === 0 ? 'success' : 'warning'}
                          >
                            {entry.hintsUsed === 0
                              ? 'Clean'
                              : `${entry.hintsUsed} ${entry.hintsUsed === 1 ? 'hint' : 'hints'}`}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
