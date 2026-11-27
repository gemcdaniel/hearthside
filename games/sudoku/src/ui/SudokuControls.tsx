import {
  AutoShowIcon,
  CheckIcon,
  EraseIcon,
  HintIcon,
  NotesIcon,
  RedoIcon,
  UndoIcon,
} from './SudokuIcons';

const PAD_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface SudokuControlsProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly notesMode: boolean;
  readonly autoShowEnabled: boolean;
  readonly canErase: boolean;
  readonly disabled: boolean;
  readonly remainingCounts: Record<number, number>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onErase: () => void;
  readonly onToggleNotesMode: () => void;
  readonly onToggleAutoShow: () => void;
  readonly onCheckBoard: () => void;
  readonly onDigitInput: (digit: number) => void;
}

export function SudokuControls({
  canUndo,
  canRedo,
  notesMode,
  autoShowEnabled,
  canErase,
  disabled,
  remainingCounts,
  onUndo,
  onRedo,
  onErase,
  onToggleNotesMode,
  onToggleAutoShow,
  onCheckBoard,
  onDigitInput,
}: SudokuControlsProps) {
  return (
    <div className="hs-sudoku-controls">
      <div className="hs-sudoku-actions" role="toolbar" aria-label="Puzzle actions">
        <button
          type="button"
          className="hs-sudoku-tool-btn"
          aria-label="Undo"
          disabled={disabled || !canUndo}
          onClick={onUndo}
        >
          <UndoIcon />
          <span className="hs-sudoku-tool-label">Undo</span>
          <span className="hs-sudoku-kbd" aria-hidden="true">
            Ctrl+Z
          </span>
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          aria-label="Redo"
          disabled={disabled || !canRedo}
          onClick={onRedo}
        >
          <RedoIcon />
          <span className="hs-sudoku-tool-label">Redo</span>
          <span className="hs-sudoku-kbd" aria-hidden="true">
            Ctrl+Y
          </span>
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          aria-label="Erase"
          disabled={disabled || !canErase}
          onClick={onErase}
        >
          <EraseIcon />
          <span className="hs-sudoku-tool-label">Erase</span>
          <span className="hs-sudoku-kbd" aria-hidden="true">
            Del
          </span>
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          aria-label="Notes"
          aria-pressed={notesMode}
          disabled={disabled}
          onClick={onToggleNotesMode}
        >
          <NotesIcon />
          <span className="hs-sudoku-tool-label">Notes</span>
          <span className="hs-sudoku-kbd" aria-hidden="true">
            N
          </span>
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn hs-sudoku-autoshow-btn"
          aria-label="Auto-Show"
          aria-pressed={autoShowEnabled}
          disabled={disabled}
          title="Show legal candidates (your manual notes stay preserved in memory)"
          onClick={onToggleAutoShow}
        >
          <span className="hs-autoshow-icon-wrap">
            <AutoShowIcon />
            <span className="hs-autoshow-dot" aria-hidden="true" />
          </span>
          <span className="hs-sudoku-tool-label">Auto-Show</span>
          <span className="hs-sudoku-kbd" aria-hidden="true">
            A
          </span>
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          aria-label="Check Board"
          disabled={disabled}
          onClick={onCheckBoard}
        >
          <CheckIcon />
          <span className="hs-sudoku-tool-label">
            <span className="hs-sudoku-label-short">Check</span>
            <span className="hs-sudoku-label-full">Check Board</span>
          </span>
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn hs-sudoku-hint-btn"
          disabled
          aria-label="Hint (coming in Run 4)"
          title="4-tier WASM hints arrive in Run 4"
        >
          <HintIcon />
          <span className="hs-sudoku-tool-label">Hint</span>
        </button>
      </div>

      <div className="hs-sudoku-numpad" role="group" aria-label="Number pad">
        {PAD_DIGITS.map((digit) => {
          const remaining = remainingCounts[digit] ?? 0;
          return (
            <button
              key={digit}
              type="button"
              className="hs-sudoku-num-btn"
              data-depleted={remaining === 0 ? 'true' : 'false'}
              disabled={disabled}
              aria-label={`${notesMode ? 'Note' : 'Enter'} ${digit}, ${remaining} remaining`}
              onClick={() => onDigitInput(digit)}
            >
              <span className="hs-sudoku-num-digit">{digit}</span>
              <span className="hs-sudoku-num-remaining">{remaining}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
