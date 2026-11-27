import { useFocusTrap } from '@hearthside/ui';
import { useId, useRef } from 'react';
import type { SudokuDifficulty, SudokuMode } from '../engine/types';
import { TrophyIcon } from './SudokuIcons';
import { formatElapsedTime } from './formatTime';

export interface SudokuVictoryModalProps {
  readonly open: boolean;
  readonly mode: SudokuMode;
  readonly difficulty: SudokuDifficulty;
  readonly dailyDate?: string;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly isNewPersonalBest: boolean;
  readonly onPlayAgain: () => void;
  readonly onViewStats: () => void;
  readonly onExitToLibrary: () => void;
  readonly onClose?: () => void;
}

function formatDiff(difficulty: SudokuDifficulty): string {
  switch (difficulty) {
    case 'easy':
      return 'Easy';
    case 'medium':
      return 'Medium';
    case 'hard':
      return 'Hard';
  }
}

export function SudokuVictoryModal({
  open,
  mode,
  difficulty,
  dailyDate,
  elapsedMs,
  hintsUsed,
  isNewPersonalBest,
  onPlayAgain,
  onViewStats,
  onExitToLibrary,
  onClose,
}: SudokuVictoryModalProps) {
  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useFocusTrap(modalRef, {
    active: open,
    onEscape: onClose ?? onExitToLibrary,
  });

  if (!open) {
    return null;
  }

  return (
    <div
      className="hs-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (onClose && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={modalRef}
        className="hs-modal hs-sudoku-victory-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="hs-sudoku-victory-body">
          <div className="hs-sudoku-victory-emblem" aria-hidden="true">
            <TrophyIcon />
          </div>
          <h2 id={titleId} className="hs-section-title">
            Puzzle Solved!
          </h2>
          <p className="hs-sudoku-victory-subtitle">
            {mode === 'daily' && dailyDate ? `Daily (${dailyDate}) · ` : ''}
            {formatDiff(difficulty)}
          </p>

          {isNewPersonalBest ? (
            <span className="hs-badge" data-tone="success">
              New Personal Best!
            </span>
          ) : null}

          <div className="hs-sudoku-victory-metrics">
            <div className="hs-sudoku-stat-card">
              <span className="hs-sudoku-stat-value">{formatElapsedTime(elapsedMs)}</span>
              <span className="hs-sudoku-stat-label">Solve Time</span>
            </div>
            <div className="hs-sudoku-stat-card">
              <span className="hs-sudoku-stat-value">{hintsUsed}</span>
              <span className="hs-sudoku-stat-label">Hints Used</span>
            </div>
          </div>

          <div className="hs-btn-group hs-sudoku-victory-actions">
            <button type="button" className="hs-btn hs-btn-primary" onClick={onPlayAgain}>
              Play Again
            </button>
            <button type="button" className="hs-btn hs-btn-secondary" onClick={onViewStats}>
              View Stats
            </button>
            <button type="button" className="hs-btn hs-btn-secondary" onClick={onExitToLibrary}>
              Back to Library
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
