import type { ShellServices } from '@hearthside/game-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BOARD_SIZE, COL_OF, GRID_SIZE, ROW_OF } from '../engine/boardMath';
import { createSudokuState, reduceSudoku, sudokuActions } from '../engine/reducer';
import {
  canRedo,
  canUndo,
  getDuplicateConflicts,
  getRemainingDigitCounts,
  getWrongValueCells,
} from '../engine/selectors';
import {
  SUDOKU_STATE_SCHEMA_VERSION,
  deserializeSudokuState,
  serializeSudokuState,
} from '../engine/serialization';
import { getStarterPuzzle, pickNextStarterPuzzle } from '../engine/starterBank';
import type { SudokuDifficulty, SudokuState } from '../engine/types';
import { SudokuBoard } from './SudokuBoard';
import { SudokuControls } from './SudokuControls';
import { formatElapsedTime } from './formatTime';
import './sudoku.css';

export interface SudokuGameProps {
  readonly services: ShellServices;
  readonly initialMode?: string;
}

function resolveDifficulty(mode?: string): SudokuDifficulty {
  if (mode === 'medium' || mode === 'hard') {
    return mode;
  }
  return 'easy';
}

function formatDifficultyLabel(difficulty: SudokuDifficulty): string {
  switch (difficulty) {
    case 'easy':
      return 'Easy';
    case 'medium':
      return 'Medium';
    case 'hard':
      return 'Hard';
  }
}

function moveSelectedCell(current: number | null, key: string): number | null {
  if (current === null) {
    return 0;
  }
  const row = ROW_OF[current] ?? 0;
  const col = COL_OF[current] ?? 0;
  switch (key) {
    case 'ArrowUp':
      return ((row + GRID_SIZE - 1) % GRID_SIZE) * GRID_SIZE + col;
    case 'ArrowDown':
      return ((row + 1) % GRID_SIZE) * GRID_SIZE + col;
    case 'ArrowLeft':
      return row * GRID_SIZE + ((col + GRID_SIZE - 1) % GRID_SIZE);
    case 'ArrowRight':
      return row * GRID_SIZE + ((col + 1) % GRID_SIZE);
    default:
      return current;
  }
}

function isEditableElementFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

export function SudokuGame({ services, initialMode }: SudokuGameProps) {
  const difficulty = resolveDifficulty(initialMode);
  const [state, setState] = useState<SudokuState>(() =>
    createSudokuState(getStarterPuzzle(difficulty, 0)),
  );
  const [loaded, setLoaded] = useState(false);
  const [confirmNewPuzzle, setConfirmNewPuzzle] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const servicesRef = useRef(services);
  servicesRef.current = services;

  const lastCompletedIdRef = useRef<string | null>(null);
  const completedIdsRef = useRef<Set<string>>(new Set());

  const persistSave = useCallback(
    async (snapshot: SudokuState) => {
      if (snapshot.completed) {
        return;
      }
      await servicesRef.current.storage.saveGame<string>({
        schemaVersion: SUDOKU_STATE_SCHEMA_VERSION,
        profileId: servicesRef.current.activeProfile.id,
        gameId: 'sudoku',
        slot: difficulty,
        updatedAt: new Date().toISOString(),
        summary: {
          elapsedMs: snapshot.elapsedMs,
          label: formatDifficultyLabel(difficulty),
        },
        payload: serializeSudokuState(snapshot),
      });
    },
    [difficulty],
  );

  // Load saved slot or next uncompleted puzzle from starter bank on mount.
  useEffect(() => {
    let active = true;
    async function init() {
      const completedRecords = await services.storage.listCompletedPuzzles();
      if (!active) {
        return;
      }
      const completedSet = new Set(completedRecords.map((r) => r.puzzleId));
      completedIdsRef.current = completedSet;

      const existingSave = await services.storage.loadSave<string>(difficulty);
      if (!active) {
        return;
      }

      if (existingSave) {
        try {
          const restored = deserializeSudokuState(existingSave.payload);
          if (!restored.completed) {
            if (restored.completed) {
              lastCompletedIdRef.current = restored.puzzle.id;
            }
            setState(restored);
            setLoaded(true);
            return;
          }
        } catch {
          // Fall through to starting a fresh puzzle if save payload is corrupted.
        }
      }

      const nextPuzzle =
        pickNextStarterPuzzle(difficulty, completedSet) ?? getStarterPuzzle(difficulty, 0);
      setState(createSudokuState(nextPuzzle));
      setLoaded(true);
    }

    void init();
    return () => {
      active = false;
    };
  }, [difficulty, services.storage]);

  // 1-second timer tick while actively playing.
  useEffect(() => {
    if (!loaded || state.paused || state.completed) {
      return;
    }
    const timer = window.setInterval(() => {
      setState((prev) => reduceSudoku(prev, sudokuActions.tickTimer(1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loaded, state.paused, state.completed]);

  // Auto-save every 10 seconds while active.
  useEffect(() => {
    if (!loaded || state.paused || state.completed) {
      return;
    }
    const saver = window.setInterval(() => {
      void persistSave(stateRef.current);
    }, 10_000);
    return () => window.clearInterval(saver);
  }, [loaded, state.paused, state.completed, persistSave]);

  // Auto-pause and persist when the browser tab becomes hidden (never on window.blur).
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && !stateRef.current.completed && !stateRef.current.paused) {
        const pausedState = reduceSudoku(stateRef.current, sudokuActions.setPaused(true));
        setState(pausedState);
        void persistSave(pausedState);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [persistSave]);

  // Handle puzzle completion transition (win SFX, record completion, clear save slot).
  useEffect(() => {
    if (!loaded || !state.completed) {
      return;
    }
    if (lastCompletedIdRef.current === state.puzzle.id) {
      return;
    }
    lastCompletedIdRef.current = state.puzzle.id;
    completedIdsRef.current.add(state.puzzle.id);

    servicesRef.current.audio.playSfx('win');
    void servicesRef.current.storage.recordCompletedPuzzle({
      profileId: servicesRef.current.activeProfile.id,
      gameId: 'sudoku',
      puzzleId: state.puzzle.id,
      difficulty: state.puzzle.difficulty,
      completedAt: new Date().toISOString(),
      elapsedMs: state.elapsedMs,
      hintsUsed: state.hintsUsed,
    });
    void servicesRef.current.storage.deleteSave(difficulty);
  }, [
    loaded,
    state.completed,
    state.puzzle.id,
    state.puzzle.difficulty,
    state.elapsedMs,
    state.hintsUsed,
    difficulty,
  ]);

  const applyAndSave = useCallback(
    (next: SudokuState) => {
      setState(next);
      void persistSave(next);
    },
    [persistSave],
  );

  const handleSelectCell = useCallback((cell: number) => {
    if (stateRef.current.selectedCell !== cell) {
      servicesRef.current.audio.playSfx('tap');
    }
    setState((prev) => reduceSudoku(prev, sudokuActions.selectCell(cell)));
  }, []);

  const handleDigitInput = useCallback(
    (digit: number) => {
      const current = stateRef.current;
      const cell = current.selectedCell;
      if (current.paused || current.completed || cell === null) {
        return;
      }
      const targetCell = current.cells[cell];
      if (!targetCell || targetCell.given) {
        return;
      }

      if (current.notesMode && targetCell.value === 0) {
        const next = reduceSudoku(current, sudokuActions.toggleNote(cell, digit));
        if (next !== current) {
          servicesRef.current.audio.playSfx('note');
          setCheckMessage(null);
          applyAndSave(next);
        }
        return;
      }

      const next = reduceSudoku(current, sudokuActions.placeDigit(cell, digit));
      if (next !== current) {
        const hasFlaggedConflict =
          servicesRef.current.settings.sudoku.flagDuplicateConflicts &&
          getDuplicateConflicts(next.cells).includes(cell);
        const hasFlaggedWrong =
          servicesRef.current.settings.sudoku.flagWrongValues &&
          getWrongValueCells(next.cells, next.puzzle.solution).includes(cell);

        if (!next.completed) {
          servicesRef.current.audio.playSfx(
            hasFlaggedConflict || hasFlaggedWrong ? 'conflict' : 'place',
          );
        }
        setCheckMessage(null);
        applyAndSave(next);
      }
    },
    [applyAndSave],
  );

  const handleErase = useCallback(() => {
    const current = stateRef.current;
    if (current.paused || current.completed || current.selectedCell === null) {
      return;
    }
    const next = reduceSudoku(current, sudokuActions.clearCell(current.selectedCell));
    if (next !== current) {
      servicesRef.current.audio.playSfx('erase');
      setCheckMessage(null);
      applyAndSave(next);
    }
  }, [applyAndSave]);

  const handleUndo = useCallback(() => {
    const current = stateRef.current;
    const next = reduceSudoku(current, sudokuActions.undo());
    if (next !== current) {
      servicesRef.current.audio.playSfx('tap');
      setCheckMessage(null);
      applyAndSave(next);
    }
  }, [applyAndSave]);

  const handleRedo = useCallback(() => {
    const current = stateRef.current;
    const next = reduceSudoku(current, sudokuActions.redo());
    if (next !== current) {
      servicesRef.current.audio.playSfx('tap');
      setCheckMessage(null);
      applyAndSave(next);
    }
  }, [applyAndSave]);

  const handleToggleNotesMode = useCallback(() => {
    servicesRef.current.audio.playSfx('tap');
    setState((prev) => reduceSudoku(prev, sudokuActions.toggleNotesMode()));
  }, []);

  const handleToggleAutoShow = useCallback(() => {
    servicesRef.current.audio.playSfx('tap');
    const next = reduceSudoku(stateRef.current, sudokuActions.toggleAutoShow());
    applyAndSave(next);
  }, [applyAndSave]);

  const handleTogglePause = useCallback(() => {
    const current = stateRef.current;
    if (current.completed) {
      return;
    }
    servicesRef.current.audio.playSfx('tap');
    const next = reduceSudoku(current, sudokuActions.setPaused(!current.paused));
    applyAndSave(next);
  }, [applyAndSave]);

  const handleCheckBoard = useCallback(() => {
    const current = stateRef.current;
    if (current.paused || current.completed) {
      return;
    }
    const next = reduceSudoku(current, sudokuActions.checkBoard());
    setState(next);
    if (next.checkedWrongCells.length === 0) {
      servicesRef.current.audio.playSfx('tap');
      setCheckMessage('Everything entered so far matches the solution!');
    } else {
      servicesRef.current.audio.playSfx('conflict');
      setCheckMessage(
        `${next.checkedWrongCells.length} wrong ${
          next.checkedWrongCells.length === 1 ? 'entry' : 'entries'
        } highlighted.`,
      );
    }
  }, []);

  const startNewPuzzle = useCallback(() => {
    const current = stateRef.current;
    const exclude = new Set(completedIdsRef.current);
    exclude.add(current.puzzle.id);

    const nextPuzzle =
      pickNextStarterPuzzle(difficulty, exclude) ?? getStarterPuzzle(difficulty, 0);
    lastCompletedIdRef.current = null;
    setConfirmNewPuzzle(false);
    setCheckMessage(null);
    const fresh = createSudokuState(nextPuzzle);
    servicesRef.current.audio.playSfx('tap');
    applyAndSave(fresh);
  }, [difficulty, applyAndSave]);

  function handleRequestNewPuzzle() {
    if (state.completed || (state.history.length === 0 && state.elapsedMs === 0)) {
      startNewPuzzle();
      return;
    }
    services.audio.playSfx('tap');
    setConfirmNewPuzzle(true);
  }

  function handleExit() {
    services.audio.playSfx('tap');
    if (!stateRef.current.completed) {
      void persistSave(stateRef.current);
    }
    services.onExitToLibrary();
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableElementFocused(event.target)) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      const lowerKey = event.key.toLowerCase();

      if (mod && lowerKey === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (mod && lowerKey === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (mod || event.altKey) {
        return;
      }

      if (lowerKey === 'p' || event.key === 'Escape') {
        event.preventDefault();
        handleTogglePause();
        return;
      }

      if (stateRef.current.paused || stateRef.current.completed) {
        return;
      }

      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const moved = moveSelectedCell(stateRef.current.selectedCell, event.key);
        if (moved !== null && moved >= 0 && moved < BOARD_SIZE) {
          handleSelectCell(moved);
        }
        return;
      }

      if (event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        handleDigitInput(Number(event.key));
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
        event.preventDefault();
        handleErase();
        return;
      }

      if (lowerKey === 'n') {
        event.preventDefault();
        handleToggleNotesMode();
        return;
      }

      if (lowerKey === 'a') {
        event.preventDefault();
        handleToggleAutoShow();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleDigitInput,
    handleErase,
    handleRedo,
    handleSelectCell,
    handleToggleAutoShow,
    handleToggleNotesMode,
    handleTogglePause,
    handleUndo,
  ]);

  const remainingCounts = getRemainingDigitCounts(state.cells);
  const selectedCellObj = state.selectedCell !== null ? state.cells[state.selectedCell] : undefined;
  const canEraseSelected = Boolean(selectedCellObj && !selectedCellObj.given);

  return (
    <div className="hs-sudoku-root">
      <div className="hs-sudoku-hud">
        <div className="hs-sudoku-hud-group">
          <button type="button" className="hs-btn hs-btn-secondary" onClick={handleExit}>
            Back to Library
          </button>
          <span className="hs-badge" data-tone="success">
            {formatDifficultyLabel(difficulty)}
          </span>
        </div>

        <div className="hs-sudoku-hud-group">
          <span
            className="hs-sudoku-timer"
            aria-label={`Elapsed time ${formatElapsedTime(state.elapsedMs)}`}
          >
            {formatElapsedTime(state.elapsedMs)}
          </span>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            disabled={state.completed}
            onClick={handleTogglePause}
          >
            {state.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={handleRequestNewPuzzle}
          >
            New Puzzle
          </button>
        </div>
      </div>

      {confirmNewPuzzle ? (
        <div className="hs-sudoku-banner" role="alert">
          <span>Start a fresh {formatDifficultyLabel(difficulty)} puzzle?</span>
          <div className="hs-btn-group">
            <button type="button" className="hs-btn hs-btn-primary" onClick={startNewPuzzle}>
              Start New
            </button>
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              onClick={() => setConfirmNewPuzzle(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {state.autoShowEnabled ? (
        <div className="hs-sudoku-autoshow-banner" role="status">
          Auto-Show Candidates active — your manual notes stay preserved in memory.
        </div>
      ) : null}

      {checkMessage ? (
        <div className="hs-sudoku-banner" aria-live="polite">
          <span>{checkMessage}</span>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => {
              setCheckMessage(null);
              setState((prev) => reduceSudoku(prev, sudokuActions.clearCheckBoard()));
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="hs-sudoku-workspace">
        <div className="hs-sudoku-board-col">
          <SudokuBoard
            state={state}
            flagDuplicateConflicts={services.settings.sudoku.flagDuplicateConflicts}
            flagWrongValues={services.settings.sudoku.flagWrongValues}
            onSelectCell={handleSelectCell}
            onResume={handleTogglePause}
          />
        </div>

        <div className="hs-sudoku-panel-col">
          <SudokuControls
            canUndo={canUndo(state)}
            canRedo={canRedo(state)}
            notesMode={state.notesMode}
            autoShowEnabled={state.autoShowEnabled}
            canErase={canEraseSelected}
            disabled={state.paused || state.completed}
            remainingCounts={remainingCounts}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onErase={handleErase}
            onToggleNotesMode={handleToggleNotesMode}
            onToggleAutoShow={handleToggleAutoShow}
            onCheckBoard={handleCheckBoard}
            onDigitInput={handleDigitInput}
          />

          {state.completed ? (
            <section className="hs-sudoku-complete-card" role="status" aria-label="Puzzle solved">
              <h2 className="hs-section-title">Puzzle Solved!</h2>
              <p className="hs-sudoku-complete-time">
                {formatDifficultyLabel(difficulty)} completed in{' '}
                {formatElapsedTime(state.elapsedMs)}.
              </p>
              <div className="hs-btn-group">
                <button type="button" className="hs-btn hs-btn-primary" onClick={startNewPuzzle}>
                  New Game
                </button>
                <button type="button" className="hs-btn hs-btn-secondary" onClick={handleExit}>
                  Back to Library
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
