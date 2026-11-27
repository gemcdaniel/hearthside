import {
  ALL_DIGITS_MASK,
  BOARD_SIZE,
  GRID_SIZE,
  PEERS,
  digitBit,
  isValidCellIndex,
  parseBoardDigits,
} from './boardMath';
import type { HighlightMap, SudokuCell, SudokuHistoryEntry, SudokuState } from './types';

export function getPeerPlacedMask(cells: readonly SudokuCell[], cell: number): number {
  if (!isValidCellIndex(cell)) {
    return 0;
  }
  const peers = PEERS[cell];
  if (!peers) {
    return 0;
  }
  let mask = 0;
  for (const peerIdx of peers) {
    const peer = cells[peerIdx];
    if (peer && peer.value >= 1 && peer.value <= GRID_SIZE) {
      mask |= digitBit(peer.value);
    }
  }
  return mask;
}

export function getComputedCandidates(cells: readonly SudokuCell[], cell: number): number {
  if (!isValidCellIndex(cell)) {
    return 0;
  }
  const target = cells[cell];
  if (!target || target.value !== 0) {
    return 0;
  }
  return ALL_DIGITS_MASK & ~getPeerPlacedMask(cells, cell);
}

export function getVisibleNotes(state: SudokuState, cell: number): number {
  if (!isValidCellIndex(cell)) {
    return 0;
  }
  const target = state.cells[cell];
  if (!target || target.value !== 0) {
    return 0;
  }

  const peerMask = getPeerPlacedMask(state.cells, cell);
  if (!state.autoShowEnabled) {
    return (target.manualNotes & ALL_DIGITS_MASK) & ~peerMask;
  }

  const computed = ALL_DIGITS_MASK & ~peerMask;
  const added = target.autoShowAdded & ALL_DIGITS_MASK;
  const excluded = target.autoShowExcluded & ALL_DIGITS_MASK;
  return ((computed | added) & ~excluded) & ~peerMask;
}

export function getDuplicateConflicts(cells: readonly SudokuCell[]): number[] {
  const conflicts: number[] = [];
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const cell = cells[i];
    if (!cell || cell.value === 0) {
      continue;
    }
    const peers = PEERS[i] ?? [];
    for (const peerIdx of peers) {
      const peer = cells[peerIdx];
      if (peer && peer.value === cell.value) {
        conflicts.push(i);
        break;
      }
    }
  }
  return conflicts;
}

export function getWrongValueCells(cells: readonly SudokuCell[], solution: string): number[] {
  const solDigits = parseBoardDigits(solution, 'solution');
  const wrong: number[] = [];
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const cell = cells[i];
    const expected = solDigits[i] ?? 0;
    if (!cell || cell.given || cell.value === 0) {
      continue;
    }
    if (cell.value !== expected) {
      wrong.push(i);
    }
  }
  return wrong;
}

export function getHighlightMap(state: SudokuState): HighlightMap {
  const selected = state.selectedCell;
  if (selected === null || !isValidCellIndex(selected)) {
    return { selected: null, peers: [], sameDigit: [] };
  }

  const peers = PEERS[selected] ?? [];
  const selectedCellObj = state.cells[selected];
  const selectedDigit = selectedCellObj?.value ?? 0;
  const sameDigit: number[] = [];

  if (selectedDigit >= 1 && selectedDigit <= GRID_SIZE) {
    for (let i = 0; i < BOARD_SIZE; i += 1) {
      if (i === selected) {
        continue;
      }
      if (state.cells[i]?.value === selectedDigit) {
        sameDigit.push(i);
      }
    }
  }

  return {
    selected,
    peers: [...peers],
    sameDigit,
  };
}

export function getRemainingDigitCounts(cells: readonly SudokuCell[]): Record<number, number> {
  const placed: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
  };

  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const val = cells[i]?.value ?? 0;
    if (val >= 1 && val <= GRID_SIZE) {
      placed[val] = (placed[val] ?? 0) + 1;
    }
  }

  const remaining: Record<number, number> = {};
  for (let d = 1; d <= GRID_SIZE; d += 1) {
    remaining[d] = Math.max(0, GRID_SIZE - (placed[d] ?? 0));
  }
  return remaining;
}

export function isPuzzleSolved(cells: readonly SudokuCell[], solution: string): boolean {
  if (cells.length !== BOARD_SIZE) {
    return false;
  }
  const solDigits = parseBoardDigits(solution, 'solution');
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const val = cells[i]?.value ?? 0;
    if (val === 0 || val !== (solDigits[i] ?? 0)) {
      return false;
    }
  }
  return getDuplicateConflicts(cells).length === 0;
}

export function isHistoryEntryActive(state: SudokuState, entry: SudokuHistoryEntry): boolean {
  const overlayMatchesSession =
    state.autoShowEnabled &&
    entry.autoShowSession !== null &&
    state.autoShowSession === entry.autoShowSession;

  if (entry.autoShowSession === null || overlayMatchesSession) {
    return true;
  }

  return entry.changes.some(
    (c) => c.prevValue !== c.nextValue || c.prevManualNotes !== c.nextManualNotes,
  );
}

export function canUndo(state: SudokuState): boolean {
  for (let idx = state.historyCursor - 1; idx >= 0; idx -= 1) {
    const entry = state.history[idx];
    if (entry && isHistoryEntryActive(state, entry)) {
      return true;
    }
  }
  return false;
}

export function canRedo(state: SudokuState): boolean {
  for (let idx = state.historyCursor; idx < state.history.length; idx += 1) {
    const entry = state.history[idx];
    if (entry && isHistoryEntryActive(state, entry)) {
      return true;
    }
  }
  return false;
}
