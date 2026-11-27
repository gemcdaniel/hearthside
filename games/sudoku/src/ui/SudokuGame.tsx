import type { ShellServices } from '@hearthside/game-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BOARD_SIZE, COL_OF, GRID_SIZE, ROW_OF } from '../engine/boardMath';
import {
  computeDailySeed,
  computeOverflowSeed,
  dailyCacheKey,
  parseSudokuLaunchMode,
} from '../engine/daily';
import {
  advanceActiveHint,
  boardToDigitsString,
  createActiveHintFromResponse,
  formatHintTierMessage,
  type ActiveHintState,
  type HintStep,
} from '../engine/hints';
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
import {
  SUDOKU_STATS_SCHEMA_VERSION,
  createEmptySudokuStats,
  normalizeSudokuStats,
  recordGameStarted,
  recordGameWon,
  type SudokuProfileStats,
} from '../engine/stats';
import type { PuzzleRecord, SudokuDifficulty, SudokuMode, SudokuState } from '../engine/types';
import { getDefaultSudokuWasmClient, type SudokuWasmClient } from '../wasm/sudokuWasmClient';
import { SudokuBoard } from './SudokuBoard';
import { SudokuControls } from './SudokuControls';
import {
  BackIcon,
  NewPuzzleIcon,
  PauseIcon,
  PlayIcon,
  RotatePhoneIcon,
  StatsIcon,
} from './SudokuIcons';
import { SudokuStatsModal } from './SudokuStatsModal';
import { SudokuVictoryModal } from './SudokuVictoryModal';
import { formatElapsedTime } from './formatTime';
import './sudoku.css';

export interface SudokuGameProps {
  readonly services: ShellServices;
  readonly initialMode?: string;
  readonly wasmClient?: SudokuWasmClient;
}

interface VictorySummary {
  readonly mode: SudokuMode;
  readonly difficulty: SudokuDifficulty;
  readonly dailyDate?: string;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly isNewPersonalBest: boolean;
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

export function SudokuGame({ services, initialMode, wasmClient }: SudokuGameProps) {
  const launch = parseSudokuLaunchMode(initialMode);
  const { mode, difficulty, dailyDate, slot } = launch;
  const effectiveWasm = wasmClient ?? getDefaultSudokuWasmClient();

  const [state, setState] = useState<SudokuState>(() =>
    createSudokuState(getStarterPuzzle(difficulty, 0), { mode, dailyDate }),
  );
  const [loaded, setLoaded] = useState(false);
  const [generatingPuzzle, setGeneratingPuzzle] = useState(mode === 'daily');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmNewPuzzle, setConfirmNewPuzzle] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<ActiveHintState>({ kind: 'idle' });
  const [stats, setStats] = useState<SudokuProfileStats>(createEmptySudokuStats);
  const [statsOpen, setStatsOpen] = useState(false);
  const [victorySummary, setVictorySummary] = useState<VictorySummary | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const servicesRef = useRef(services);
  servicesRef.current = services;

  const wasmRef = useRef(effectiveWasm);
  wasmRef.current = effectiveWasm;

  const lastCompletedIdRef = useRef<string | null>(null);
  const completedIdsRef = useRef<Set<string>>(new Set());
  const hintRequestSeqRef = useRef(0);
  const overflowCountRef = useRef(0);

  const persistSave = useCallback(
    async (snapshot: SudokuState) => {
      if (snapshot.completed) {
        return;
      }
      const modeLabel =
        mode === 'daily' && dailyDate
          ? `Daily · ${formatDifficultyLabel(difficulty)}`
          : formatDifficultyLabel(difficulty);
      await servicesRef.current.storage.saveGame<string>({
        schemaVersion: SUDOKU_STATE_SCHEMA_VERSION,
        profileId: servicesRef.current.activeProfile.id,
        gameId: 'sudoku',
        slot,
        updatedAt: new Date().toISOString(),
        summary: {
          elapsedMs: snapshot.elapsedMs,
          label: modeLabel,
        },
        payload: serializeSudokuState(snapshot),
      });
    },
    [difficulty, mode, dailyDate, slot],
  );

  const incrementStartedStats = useCallback(async () => {
    try {
      const existing = await servicesRef.current.storage.loadStats();
      const base = existing ? normalizeSudokuStats(existing.stats) : createEmptySudokuStats();
      const updated = recordGameStarted(base, difficulty);
      setStats(updated);
      await servicesRef.current.storage.saveStats({
        schemaVersion: SUDOKU_STATS_SCHEMA_VERSION,
        profileId: servicesRef.current.activeProfile.id,
        gameId: 'sudoku',
        updatedAt: new Date().toISOString(),
        stats: updated,
      });
    } catch {
      // Non-fatal if IndexedDB stats write is temporarily unavailable.
    }
  }, [difficulty]);

  const resolveNextStandardPuzzle = useCallback(
    async (excludeIds: ReadonlySet<string>): Promise<PuzzleRecord> => {
      const fromBank = pickNextStarterPuzzle(difficulty, excludeIds);
      if (fromBank) {
        return fromBank;
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const seed = computeOverflowSeed(difficulty, overflowCountRef.current);
        overflowCountRef.current += 1;
        const generated = await wasmRef.current.generatePuzzle(seed, difficulty);
        if (!excludeIds.has(generated.id)) {
          return generated;
        }
      }
      return getStarterPuzzle(difficulty, 0);
    },
    [difficulty],
  );

  // Load stats, saved slot, cached/generated Daily Puzzle, or starter-bank puzzle on mount.
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const [completedRecords, existingStats, existingSave] = await Promise.all([
          services.storage.listCompletedPuzzles(),
          services.storage.loadStats(),
          services.storage.loadSave<string>(slot),
        ]);
        if (!active) {
          return;
        }

        const completedSet = new Set(completedRecords.map((r) => r.puzzleId));
        completedIdsRef.current = completedSet;
        if (existingStats) {
          setStats(normalizeSudokuStats(existingStats.stats));
        }

        if (existingSave) {
          try {
            const restored = deserializeSudokuState(existingSave.payload);
            if (!restored.completed) {
              setState(restored);
              setGeneratingPuzzle(false);
              setLoaded(true);
              return;
            }
          } catch {
            // Fall through to fresh puzzle creation if save payload is invalid.
          }
        }

        if (mode === 'daily' && dailyDate) {
          setGeneratingPuzzle(true);
          const cacheKey = dailyCacheKey(dailyDate, difficulty);
          let puzzle = await services.storage.loadCachedPuzzle<PuzzleRecord>(cacheKey);
          if (!active) {
            return;
          }
          if (!puzzle) {
            const seed = computeDailySeed(dailyDate, difficulty);
            puzzle = await wasmRef.current.generatePuzzle(seed, difficulty);
            if (!active) {
              return;
            }
            await services.storage.saveCachedPuzzle(cacheKey, puzzle);
          }
          setState(createSudokuState(puzzle, { mode: 'daily', dailyDate }));
          setGeneratingPuzzle(false);
          setLoaded(true);
          void incrementStartedStats();
          return;
        }

        const bankPuzzle = pickNextStarterPuzzle(difficulty, completedSet);
        if (bankPuzzle) {
          setState(createSudokuState(bankPuzzle, { mode: 'standard' }));
          setGeneratingPuzzle(false);
          setLoaded(true);
          void incrementStartedStats();
          return;
        }

        setGeneratingPuzzle(true);
        const overflowPuzzle = await resolveNextStandardPuzzle(completedSet);
        if (!active) {
          return;
        }
        setState(createSudokuState(overflowPuzzle, { mode: 'standard' }));
        setGeneratingPuzzle(false);
        setLoaded(true);
        void incrementStartedStats();
      } catch (err: unknown) {
        if (!active) {
          return;
        }
        setGeneratingPuzzle(false);
        setLoadError(err instanceof Error ? err.message : 'Unable to initialize puzzle.');
        setLoaded(true);
      }
    }

    void init();
    return () => {
      active = false;
    };
  }, [
    difficulty,
    mode,
    dailyDate,
    slot,
    services.storage,
    incrementStartedStats,
    resolveNextStandardPuzzle,
  ]);

  // 1-second timer tick while actively playing.
  useEffect(() => {
    if (!loaded || generatingPuzzle || state.paused || state.completed) {
      return;
    }
    const timer = window.setInterval(() => {
      setState((prev) => reduceSudoku(prev, sudokuActions.tickTimer(1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loaded, generatingPuzzle, state.paused, state.completed]);

  // Auto-save every 10 seconds while active.
  useEffect(() => {
    if (!loaded || generatingPuzzle || state.paused || state.completed) {
      return;
    }
    const saver = window.setInterval(() => {
      void persistSave(stateRef.current);
    }, 10_000);
    return () => window.clearInterval(saver);
  }, [loaded, generatingPuzzle, state.paused, state.completed, persistSave]);

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

  // Handle puzzle completion transition (win SFX, completion record, stats update, Victory modal).
  useEffect(() => {
    if (!loaded || generatingPuzzle || !state.completed) {
      return;
    }
    if (lastCompletedIdRef.current === state.puzzle.id) {
      return;
    }
    lastCompletedIdRef.current = state.puzzle.id;
    completedIdsRef.current.add(state.puzzle.id);

    setActiveHint({ kind: 'idle' });
    setCheckMessage(null);
    servicesRef.current.audio.playSfx('win');

    const snapshot = state;
    async function finalizeWin() {
      let isNewPersonalBest = false;
      try {
        const existingStats = await servicesRef.current.storage.loadStats();
        const base = existingStats
          ? normalizeSudokuStats(existingStats.stats)
          : createEmptySudokuStats();
        const result = recordGameWon(base, {
          difficulty: snapshot.puzzle.difficulty,
          mode: snapshot.mode,
          dailyDate: snapshot.dailyDate,
          elapsedMs: snapshot.elapsedMs,
          hintsUsed: snapshot.hintsUsed,
        });
        isNewPersonalBest = result.isNewPersonalBest;
        setStats(result.stats);

        await servicesRef.current.storage.saveStats({
          schemaVersion: SUDOKU_STATS_SCHEMA_VERSION,
          profileId: servicesRef.current.activeProfile.id,
          gameId: 'sudoku',
          updatedAt: new Date().toISOString(),
          stats: result.stats,
        });
      } catch {
        // Proceed with victory modal even if stats persistence fails.
      }

      try {
        await servicesRef.current.storage.recordCompletedPuzzle({
          profileId: servicesRef.current.activeProfile.id,
          gameId: 'sudoku',
          puzzleId: snapshot.puzzle.id,
          difficulty: snapshot.puzzle.difficulty,
          mode: snapshot.mode,
          dailyDate: snapshot.dailyDate,
          completedAt: new Date().toISOString(),
          elapsedMs: snapshot.elapsedMs,
          hintsUsed: snapshot.hintsUsed,
        });
        await servicesRef.current.storage.deleteSave(slot);
      } catch {
        // Ignore non-fatal storage cleanup errors.
      }

      setVictorySummary({
        mode: snapshot.mode,
        difficulty: snapshot.puzzle.difficulty,
        dailyDate: snapshot.dailyDate,
        elapsedMs: snapshot.elapsedMs,
        hintsUsed: snapshot.hintsUsed,
        isNewPersonalBest,
      });
    }

    void finalizeWin();
  }, [loaded, generatingPuzzle, state, slot]);

  const clearTransientHint = useCallback(() => {
    hintRequestSeqRef.current += 1;
    setActiveHint((prev) => (prev.kind === 'idle' ? prev : { kind: 'idle' }));
  }, []);

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
      if (current.paused || current.completed || generatingPuzzle || cell === null) {
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
          clearTransientHint();
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
        clearTransientHint();
        applyAndSave(next);
      }
    },
    [applyAndSave, clearTransientHint, generatingPuzzle],
  );

  const handleErase = useCallback(() => {
    const current = stateRef.current;
    if (current.paused || current.completed || generatingPuzzle || current.selectedCell === null) {
      return;
    }
    const next = reduceSudoku(current, sudokuActions.clearCell(current.selectedCell));
    if (next !== current) {
      servicesRef.current.audio.playSfx('erase');
      setCheckMessage(null);
      clearTransientHint();
      applyAndSave(next);
    }
  }, [applyAndSave, clearTransientHint, generatingPuzzle]);

  const handleUndo = useCallback(() => {
    const current = stateRef.current;
    const next = reduceSudoku(current, sudokuActions.undo());
    if (next !== current) {
      servicesRef.current.audio.playSfx('tap');
      setCheckMessage(null);
      clearTransientHint();
      applyAndSave(next);
    }
  }, [applyAndSave, clearTransientHint]);

  const handleRedo = useCallback(() => {
    const current = stateRef.current;
    const next = reduceSudoku(current, sudokuActions.redo());
    if (next !== current) {
      servicesRef.current.audio.playSfx('tap');
      setCheckMessage(null);
      clearTransientHint();
      applyAndSave(next);
    }
  }, [applyAndSave, clearTransientHint]);

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
    if (current.completed || generatingPuzzle) {
      return;
    }
    servicesRef.current.audio.playSfx('tap');
    const next = reduceSudoku(current, sudokuActions.setPaused(!current.paused));
    applyAndSave(next);
  }, [applyAndSave, generatingPuzzle]);

  const handleCheckBoard = useCallback(() => {
    const current = stateRef.current;
    if (current.paused || current.completed || generatingPuzzle) {
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
  }, [generatingPuzzle]);

  const applyHintStep = useCallback(
    (step: HintStep) => {
      const current = stateRef.current;
      const next = reduceSudoku(
        current,
        sudokuActions.applyHintStep(step.placements, step.eliminations),
      );
      if (next !== current) {
        if (!next.completed) {
          servicesRef.current.audio.playSfx('hint');
        }
        setActiveHint({ kind: 'idle' });
        setCheckMessage(
          step.placements.length > 0 ? 'Applied hint placement.' : 'Applied hint eliminations.',
        );
        applyAndSave(next);
      } else {
        servicesRef.current.audio.playSfx('tap');
        setActiveHint({
          kind: 'notice',
          message:
            'Turn on Auto-Show or add candidate notes to see elimination changes directly on empty cells.',
        });
      }
    },
    [applyAndSave],
  );

  const handleHint = useCallback(async () => {
    const current = stateRef.current;
    if (current.paused || current.completed || generatingPuzzle) {
      return;
    }

    if (activeHint.kind === 'loading') {
      return;
    }

    if (activeHint.kind === 'step') {
      const { next, shouldApplyStep } = advanceActiveHint(activeHint);
      if (!shouldApplyStep) {
        servicesRef.current.audio.playSfx('tap');
        setActiveHint(next);
        return;
      }
      applyHintStep(activeHint.step);
      return;
    }

    const snapshot = current;
    const reqId = ++hintRequestSeqRef.current;
    setActiveHint({ kind: 'loading' });

    try {
      const response = await wasmRef.current.nextHint(
        boardToDigitsString(snapshot.cells),
        snapshot.puzzle.solution,
      );
      if (reqId !== hintRequestSeqRef.current || stateRef.current !== snapshot) {
        return;
      }

      const nextHint = createActiveHintFromResponse(response);
      setActiveHint(nextHint);

      if (nextHint.kind === 'step') {
        servicesRef.current.audio.playSfx('hint');
        const recorded = reduceSudoku(snapshot, sudokuActions.recordHintViewed());
        if (recorded !== snapshot) {
          applyAndSave(recorded);
        }
      } else if (nextHint.kind === 'issue') {
        servicesRef.current.audio.playSfx('conflict');
      } else {
        servicesRef.current.audio.playSfx('tap');
      }
    } catch (err: unknown) {
      if (reqId !== hintRequestSeqRef.current) {
        return;
      }
      setActiveHint({
        kind: 'notice',
        message: err instanceof Error ? err.message : 'Unable to compute hint right now.',
      });
    }
  }, [activeHint, applyAndSave, applyHintStep, generatingPuzzle]);

  const handleClearIssueCell = useCallback(
    (cells: readonly number[]) => {
      const current = stateRef.current;
      const targetIdx = cells.find((idx) => {
        const c = current.cells[idx];
        return Boolean(c && !c.given && c.value !== 0);
      });
      if (targetIdx === undefined) {
        clearTransientHint();
        return;
      }
      let next = reduceSudoku(current, sudokuActions.selectCell(targetIdx));
      next = reduceSudoku(next, sudokuActions.clearCell(targetIdx));
      servicesRef.current.audio.playSfx('erase');
      setCheckMessage(null);
      clearTransientHint();
      applyAndSave(next);
    },
    [applyAndSave, clearTransientHint],
  );

  const startNewPuzzle = useCallback(async () => {
    const current = stateRef.current;
    const exclude = new Set(completedIdsRef.current);
    exclude.add(current.puzzle.id);

    setConfirmNewPuzzle(false);
    setVictorySummary(null);
    setCheckMessage(null);
    clearTransientHint();

    let nextPuzzle: PuzzleRecord;
    const bankPuzzle = pickNextStarterPuzzle(difficulty, exclude);
    if (bankPuzzle) {
      nextPuzzle = bankPuzzle;
    } else {
      setGeneratingPuzzle(true);
      try {
        nextPuzzle = await resolveNextStandardPuzzle(exclude);
      } finally {
        setGeneratingPuzzle(false);
      }
    }

    lastCompletedIdRef.current = null;
    const fresh = createSudokuState(nextPuzzle, { mode: 'standard' });
    servicesRef.current.audio.playSfx('tap');
    applyAndSave(fresh);
    void incrementStartedStats();
  }, [
    difficulty,
    applyAndSave,
    clearTransientHint,
    incrementStartedStats,
    resolveNextStandardPuzzle,
  ]);

  function handleRequestNewPuzzle() {
    if (state.completed || (state.history.length === 0 && state.elapsedMs === 0)) {
      void startNewPuzzle();
      return;
    }
    services.audio.playSfx('tap');
    setConfirmNewPuzzle(true);
  }

  function handleExit() {
    services.audio.playSfx('tap');
    if (!stateRef.current.completed && !generatingPuzzle) {
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

      if (stateRef.current.paused || stateRef.current.completed || generatingPuzzle) {
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
        return;
      }

      if (lowerKey === 'h') {
        event.preventDefault();
        void handleHint();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    generatingPuzzle,
    handleDigitInput,
    handleErase,
    handleHint,
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

  const hintTierMessage =
    activeHint.kind === 'step' ? formatHintTierMessage(activeHint.step, activeHint.tier) : null;

  const statusHeadline =
    hintTierMessage?.headline ??
    (activeHint.kind === 'issue'
      ? activeHint.status === 'conflict'
        ? 'Conflict detected on board'
        : 'Wrong entry detected'
      : activeHint.kind === 'notice'
        ? activeHint.message
        : activeHint.kind === 'loading'
          ? 'Checking next logical step...'
          : (checkMessage ?? loadError));

  const stageOverlay = generatingPuzzle ? (
    <div className="hs-sudoku-overlay" role="status" aria-label="Generating puzzle">
      <p className="hs-sudoku-curtain-title">
        {mode === 'daily' ? 'Preparing Daily Puzzle...' : 'Generating Fresh Puzzle...'}
      </p>
      <p className="hs-sudoku-curtain-subtitle">
        Building your deterministic offline board locally in WASM.
      </p>
    </div>
  ) : confirmNewPuzzle ? (
    <div className="hs-sudoku-overlay" role="alert" aria-label="Start new puzzle confirmation">
      <p className="hs-sudoku-curtain-title">New Puzzle?</p>
      <p className="hs-sudoku-curtain-subtitle">
        Start a fresh {formatDifficultyLabel(difficulty)} puzzle?
      </p>
      <div className="hs-btn-group">
        <button
          type="button"
          className="hs-btn hs-btn-primary"
          onClick={() => void startNewPuzzle()}
        >
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
  ) : null;

  const hintCard =
    activeHint.kind === 'step' && hintTierMessage ? (
      <div className="hs-sudoku-hint-sheet" data-testid="sudoku-hint-card" role="status">
        <div className="hs-sudoku-hint-body">
          <strong className="hs-sudoku-hint-title">{hintTierMessage.headline}</strong>
          <p className="hs-sudoku-hint-detail">{hintTierMessage.detail}</p>
        </div>
        <div className="hs-sudoku-hint-actions">
          <button
            type="button"
            className="hs-sudoku-hint-primary"
            onClick={() => void handleHint()}
          >
            {activeHint.tier === 3 ? 'Apply Step' : 'Next Hint'}
          </button>
          <button type="button" className="hs-sudoku-hint-dismiss" onClick={clearTransientHint}>
            Dismiss
          </button>
        </div>
      </div>
    ) : activeHint.kind === 'issue' ? (
      <div
        className="hs-sudoku-hint-sheet"
        data-testid="sudoku-hint-card"
        data-tone="issue"
        role="alert"
      >
        <div className="hs-sudoku-hint-body">
          <strong className="hs-sudoku-hint-title">
            {activeHint.status === 'conflict' ? 'Peer Conflict Found' : 'Wrong Entry Found'}
          </strong>
          <p className="hs-sudoku-hint-detail">{activeHint.message}</p>
        </div>
        <div className="hs-sudoku-hint-actions">
          <button
            type="button"
            className="hs-sudoku-hint-secondary"
            onClick={() => {
              const first = activeHint.cells[0];
              if (first !== undefined) {
                handleSelectCell(first);
              }
            }}
          >
            Show
          </button>
          <button
            type="button"
            className="hs-sudoku-hint-primary"
            onClick={() => handleClearIssueCell(activeHint.cells)}
          >
            Clear
          </button>
          <button type="button" className="hs-sudoku-hint-dismiss" onClick={clearTransientHint}>
            Dismiss
          </button>
        </div>
      </div>
    ) : activeHint.kind === 'notice' ? (
      <div className="hs-sudoku-hint-sheet" data-testid="sudoku-hint-card" role="status">
        <div className="hs-sudoku-hint-body">
          <p className="hs-sudoku-hint-detail">{activeHint.message}</p>
        </div>
        <div className="hs-sudoku-hint-actions">
          <button type="button" className="hs-sudoku-hint-dismiss" onClick={clearTransientHint}>
            Dismiss
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="hs-sudoku-root">
      <header className="hs-sudoku-hud">
        <div className="hs-sudoku-hud-group">
          <button
            type="button"
            className="hs-sudoku-hud-btn"
            aria-label="Back to Library"
            onClick={handleExit}
          >
            <BackIcon />
            <span className="hs-sudoku-hud-label">Library</span>
          </button>
          <span className="hs-sudoku-diff-pill">
            {mode === 'daily'
              ? `Daily · ${formatDifficultyLabel(difficulty)}`
              : formatDifficultyLabel(difficulty)}
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
            className="hs-sudoku-hud-btn"
            aria-label="Statistics"
            onClick={() => {
              services.audio.playSfx('tap');
              setStatsOpen(true);
            }}
          >
            <StatsIcon />
            <span className="hs-sudoku-hud-label">Stats</span>
          </button>
          <button
            type="button"
            className="hs-sudoku-hud-btn"
            aria-label={state.paused ? 'Resume' : 'Pause'}
            disabled={state.completed || generatingPuzzle}
            onClick={handleTogglePause}
          >
            {state.paused ? <PlayIcon /> : <PauseIcon />}
            <span className="hs-sudoku-hud-label">{state.paused ? 'Resume' : 'Pause'}</span>
          </button>
          {mode === 'standard' ? (
            <button
              type="button"
              className="hs-sudoku-hud-btn"
              aria-label="New Puzzle"
              onClick={handleRequestNewPuzzle}
            >
              <NewPuzzleIcon />
              <span className="hs-sudoku-hud-label">New</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="hs-sudoku-workspace">
        <div className="hs-sudoku-board-col">
          <SudokuBoard
            state={state}
            flagDuplicateConflicts={services.settings.sudoku.flagDuplicateConflicts}
            flagWrongValues={services.settings.sudoku.flagWrongValues}
            activeHint={activeHint}
            onSelectCell={handleSelectCell}
            onResume={handleTogglePause}
            stageOverlay={stageOverlay}
          />

          <div
            className="hs-sudoku-status-rail"
            data-testid="sudoku-status-rail"
            data-has-message={statusHeadline ? 'true' : 'false'}
            aria-live="polite"
          >
            {statusHeadline ? (
              <>
                <span className="hs-sudoku-status-text">{statusHeadline}</span>
                {checkMessage && activeHint.kind === 'idle' ? (
                  <button
                    type="button"
                    className="hs-sudoku-status-dismiss"
                    onClick={() => {
                      setCheckMessage(null);
                      setState((prev) => reduceSudoku(prev, sudokuActions.clearCheckBoard()));
                    }}
                  >
                    Dismiss
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <aside className="hs-sudoku-panel-col" aria-label="Puzzle controls">
          <SudokuControls
            canUndo={canUndo(state)}
            canRedo={canRedo(state)}
            notesMode={state.notesMode}
            autoShowEnabled={state.autoShowEnabled}
            canErase={canEraseSelected}
            disabled={state.paused || state.completed || confirmNewPuzzle || generatingPuzzle}
            hintActive={activeHint.kind !== 'idle'}
            hintLoading={activeHint.kind === 'loading'}
            hintTier={activeHint.kind === 'step' ? activeHint.tier : undefined}
            hintCard={hintCard}
            remainingCounts={remainingCounts}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onErase={handleErase}
            onToggleNotesMode={handleToggleNotesMode}
            onToggleAutoShow={handleToggleAutoShow}
            onCheckBoard={handleCheckBoard}
            onHint={() => void handleHint()}
            onDigitInput={handleDigitInput}
          />
        </aside>
      </div>

      <SudokuVictoryModal
        open={victorySummary !== null}
        mode={victorySummary?.mode ?? mode}
        difficulty={victorySummary?.difficulty ?? difficulty}
        dailyDate={victorySummary?.dailyDate ?? dailyDate}
        elapsedMs={victorySummary?.elapsedMs ?? state.elapsedMs}
        hintsUsed={victorySummary?.hintsUsed ?? state.hintsUsed}
        isNewPersonalBest={victorySummary?.isNewPersonalBest ?? false}
        onPlayAgain={() => void startNewPuzzle()}
        onViewStats={() => setStatsOpen(true)}
        onExitToLibrary={handleExit}
      />

      <SudokuStatsModal
        open={statsOpen}
        profileName={services.activeProfile.name}
        stats={stats}
        onClose={() => setStatsOpen(false)}
      />

      <div
        className="hs-sudoku-rotate-guard"
        data-testid="phone-landscape-guard"
        role="region"
        aria-label="Rotate device"
      >
        <div className="hs-sudoku-rotate-card">
          <RotatePhoneIcon />
          <p className="hs-sudoku-curtain-title">Rotate to portrait to play</p>
          <p className="hs-sudoku-curtain-subtitle">
            Sudoku is designed for portrait comfort on compact phone screens.
          </p>
          <button type="button" className="hs-btn hs-btn-secondary" onClick={handleExit}>
            Return to Library
          </button>
        </div>
      </div>
    </div>
  );
}
