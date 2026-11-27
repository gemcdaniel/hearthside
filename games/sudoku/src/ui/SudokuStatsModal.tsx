import { useFocusTrap } from '@hearthside/ui';
import { useId, useRef, type RefObject } from 'react';
import { getAverageTimeMs, getWinRatePercent, type SudokuProfileStats } from '../engine/stats';
import type { SudokuDifficulty } from '../engine/types';
import { CloseIcon } from './SudokuIcons';
import { formatElapsedTime } from './formatTime';
import './sudoku.css';

const DIFFICULTIES: readonly { readonly id: SudokuDifficulty; readonly label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

export interface SudokuStatsModalProps {
  readonly open: boolean;
  readonly profileName: string;
  readonly stats: SudokuProfileStats;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

function formatOptionalTime(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  return formatElapsedTime(ms);
}

export function SudokuStatsModal({
  open,
  profileName,
  stats,
  returnFocusRef,
  onClose,
}: SudokuStatsModalProps) {
  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useFocusTrap(modalRef, {
    active: open,
    onEscape: onClose,
    returnFocusRef,
  });

  if (!open) {
    return null;
  }

  const winRate = getWinRatePercent(stats);

  return (
    <div
      className="hs-modal-backdrop hs-sudoku-stats-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={modalRef}
        className="hs-modal hs-sudoku-stats-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="hs-modal-header">
          <div className="hs-sudoku-hud-group">
            <h2 id={titleId} className="hs-section-title">
              Sudoku Statistics
            </h2>
            <span className="hs-sudoku-diff-pill">{profileName}</span>
          </div>
          <button
            type="button"
            className="hs-sudoku-hud-btn"
            aria-label="Close Statistics"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="hs-modal-body">
          <div className="hs-sudoku-stat-grid">
            <div className="hs-sudoku-stat-card">
              <span className="hs-sudoku-stat-value">{stats.gamesWon}</span>
              <span className="hs-sudoku-stat-label">Won / {stats.gamesStarted} started</span>
            </div>
            <div className="hs-sudoku-stat-card">
              <span className="hs-sudoku-stat-value">{winRate}%</span>
              <span className="hs-sudoku-stat-label">Win Rate</span>
            </div>
            <div className="hs-sudoku-stat-card">
              <span className="hs-sudoku-stat-value">{stats.currentDailyStreak}</span>
              <span className="hs-sudoku-stat-label">
                Daily Streak (Best {stats.bestDailyStreak})
              </span>
            </div>
            <div className="hs-sudoku-stat-card">
              <span className="hs-sudoku-stat-value">{stats.totalHintsUsed}</span>
              <span className="hs-sudoku-stat-label">Hints Used</span>
            </div>
          </div>

          <div className="hs-sudoku-diff-stats">
            {DIFFICULTIES.map(({ id, label }) => {
              const tier = stats.byDifficulty[id];
              const avg = getAverageTimeMs(tier);
              return (
                <div key={id} className="hs-sudoku-diff-stat-row">
                  <div className="hs-sudoku-diff-stat-head">
                    <strong>{label}</strong>
                    <span className="hs-sudoku-stat-sub">
                      {tier.gamesWon} won / {tier.gamesStarted} started
                    </span>
                  </div>
                  <div className="hs-sudoku-diff-stat-times">
                    <span>Best: {formatOptionalTime(tier.bestTimeMs)}</span>
                    <span>Avg: {formatOptionalTime(avg)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
