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
          disabled={disabled || !canUndo}
          onClick={onUndo}
        >
          Undo
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          disabled={disabled || !canRedo}
          onClick={onRedo}
        >
          Redo
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          disabled={disabled || !canErase}
          onClick={onErase}
        >
          Erase
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          aria-pressed={notesMode}
          disabled={disabled}
          onClick={onToggleNotesMode}
        >
          Notes
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn hs-sudoku-autoshow-btn"
          aria-pressed={autoShowEnabled}
          disabled={disabled}
          title="Show legal candidates (your manual notes are preserved in memory)"
          onClick={onToggleAutoShow}
        >
          Auto-Show
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          disabled={disabled}
          onClick={onCheckBoard}
        >
          Check Board
        </button>

        <button
          type="button"
          className="hs-sudoku-tool-btn"
          disabled
          aria-label="Hint (coming in Run 4)"
          title="4-tier WASM hints arrive in Run 4"
        >
          Hint
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
