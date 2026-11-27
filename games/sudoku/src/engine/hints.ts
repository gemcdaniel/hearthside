import { BOXES, BOX_OF, COLS, COL_OF, GRID_SIZE, ROWS, ROW_OF, isValidCellIndex } from './boardMath';
import type { SudokuCell, SudokuDifficulty, SudokuElimination, SudokuPlacement } from './types';

export type HintStatus =
  | 'ok'
  | 'conflict'
  | 'wrong_entry'
  | 'unsolvable'
  | 'solved'
  | 'no_logical_step';

export interface HintRegion {
  readonly kind: 'cell' | 'row' | 'column' | 'box';
  readonly index: number;
}

export interface HintStep {
  readonly technique: string;
  readonly difficulty: SudokuDifficulty;
  readonly region: HintRegion;
  readonly drivingCells: readonly number[];
  readonly placements: readonly SudokuPlacement[];
  readonly eliminations: readonly SudokuElimination[];
}

export interface SudokuHintResponse {
  readonly ok: boolean;
  readonly engineVersion: string;
  readonly status?: HintStatus;
  readonly conflictCells?: readonly number[];
  readonly wrongCells?: readonly number[];
  readonly step?: HintStep;
  readonly error?: string;
}

export interface TechniqueGuide {
  readonly label: string;
  readonly summary: string;
}

export const TECHNIQUE_GUIDES: Readonly<Record<string, TechniqueGuide>> = {
  naked_single: {
    label: 'Naked Single',
    summary: 'Only one possible digit fits inside this cell.',
  },
  hidden_single: {
    label: 'Hidden Single',
    summary: 'Only one cell in this row, column, or box can hold a needed digit.',
  },
  pointing_line: {
    label: 'Pointing Pair / Triple',
    summary:
      'In this box, a digit only fits along one line, so it can be removed from the rest of that line.',
  },
  box_line_reduction: {
    label: 'Box-Line Reduction',
    summary:
      'Along this row or column, a digit only appears inside one box, so other cells in that box cannot use it.',
  },
  naked_pair: {
    label: 'Naked Pair',
    summary:
      'Two cells share the exact same two candidates, so those two digits cannot appear anywhere else in the unit.',
  },
  hidden_pair: {
    label: 'Hidden Pair',
    summary:
      'Two digits can only go in the same two cells of a unit, so all other notes in those two cells can be cleared.',
  },
  naked_triple: {
    label: 'Naked Triple',
    summary:
      'Three cells only use candidates from a set of three digits, locking those digits out of other cells in the unit.',
  },
  hidden_triple: {
    label: 'Hidden Triple',
    summary:
      'Three digits are restricted to the same three cells in a unit, clearing any extra candidates inside them.',
  },
  skyscraper: {
    label: 'Skyscraper',
    summary:
      'Two parallel lines share a strong base for one digit, forcing its ends to eliminate that digit from shared peers.',
  },
  x_wing: {
    label: 'X-Wing',
    summary:
      'A digit forms a 2x2 rectangle across two rows and columns, removing it from the perpendicular lines.',
  },
  w_wing: {
    label: 'W-Wing',
    summary:
      'Two matching two-candidate cells linked by a bridge digit guarantee one holds the other digit.',
  },
  xy_wing: {
    label: 'XY-Wing',
    summary:
      'A three-cell hinge bends two pairs together so cells seeing both wings cannot hold their shared digit.',
  },
  swordfish: {
    label: 'Swordfish',
    summary:
      'A digit across three rows spans only three columns (or vice versa), clearing it from the rest of those three lines.',
  },
};

export function getTechniqueGuide(technique: string): TechniqueGuide {
  const known = TECHNIQUE_GUIDES[technique];
  if (known) {
    return known;
  }
  const readable = technique
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return {
    label: readable || 'Logical Step',
    summary: 'Follow the highlighted candidates to deduce the next safe move.',
  };
}

export type ActiveHintState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'issue';
      readonly status: 'conflict' | 'wrong_entry';
      readonly cells: readonly number[];
      readonly message: string;
    }
  | {
      readonly kind: 'step';
      readonly tier: 1 | 2 | 3;
      readonly step: HintStep;
    }
  | {
      readonly kind: 'notice';
      readonly message: string;
    };

export function boardToDigitsString(cells: readonly SudokuCell[]): string {
  let out = '';
  for (let i = 0; i < cells.length; i += 1) {
    const val = cells[i]?.value ?? 0;
    out += val >= 1 && val <= GRID_SIZE ? String(val) : '0';
  }
  return out;
}

export function getTier1Region(step: HintStep): HintRegion {
  if (step.region.kind === 'cell') {
    const idx = step.region.index;
    const boxIdx = isValidCellIndex(idx) ? (BOX_OF[idx] ?? 0) : 0;
    return { kind: 'box', index: boxIdx };
  }
  return step.region;
}

export function getRegionCells(region: HintRegion): readonly number[] {
  switch (region.kind) {
    case 'row':
      return ROWS[region.index] ?? [];
    case 'column':
      return COLS[region.index] ?? [];
    case 'box':
      return BOXES[region.index] ?? [];
    case 'cell':
      return isValidCellIndex(region.index) ? [region.index] : [];
  }
}

export function formatRegionLabel(region: HintRegion): string {
  switch (region.kind) {
    case 'row':
      return `Row ${region.index + 1}`;
    case 'column':
      return `Column ${region.index + 1}`;
    case 'box':
      return `Box ${region.index + 1}`;
    case 'cell': {
      const row = (ROW_OF[region.index] ?? 0) + 1;
      const col = (COL_OF[region.index] ?? 0) + 1;
      return `Row ${row}, Column ${col}`;
    }
  }
}

export function formatCellCoord(cell: number): string {
  const row = (ROW_OF[cell] ?? 0) + 1;
  const col = (COL_OF[cell] ?? 0) + 1;
  return `R${row}C${col}`;
}

export function formatHintTierMessage(
  step: HintStep,
  tier: 1 | 2 | 3,
): { readonly headline: string; readonly detail: string } {
  const guide = getTechniqueGuide(step.technique);

  if (tier === 1) {
    const region = getTier1Region(step);
    const regionLabel = formatRegionLabel(region);
    return {
      headline: `Hint 1/4 · Look closely at ${regionLabel}`,
      detail: `Check ${regionLabel} carefully—there is a clean logical move nearby.`,
    };
  }

  if (tier === 2) {
    const regionLabel = formatRegionLabel(step.region);
    return {
      headline: `Hint 2/4 · ${guide.label}`,
      detail: `${guide.summary} Focus on ${regionLabel}.`,
    };
  }

  const firstPlacement = step.placements[0];
  if (firstPlacement) {
    return {
      headline: `Hint 3/4 · ${guide.label}`,
      detail: `Place ${firstPlacement.digit} in ${formatRegionLabel({ kind: 'cell', index: firstPlacement.cell })} (${formatCellCoord(firstPlacement.cell)}).`,
    };
  }

  const elimDigits = Array.from(new Set(step.eliminations.map((e) => e.digit))).sort((a, b) => a - b);
  const elimCells = new Set(step.eliminations.map((e) => e.cell)).size;
  return {
    headline: `Hint 3/4 · ${guide.label}`,
    detail: `Remove candidate${elimDigits.length === 1 ? '' : 's'} ${elimDigits.join(', ')} from ${elimCells} highlighted ${elimCells === 1 ? 'cell' : 'cells'}.`,
  };
}

export function createActiveHintFromResponse(response: SudokuHintResponse): ActiveHintState {
  if (!response.ok) {
    return {
      kind: 'notice',
      message: response.error ?? 'Could not analyze the board right now.',
    };
  }

  switch (response.status) {
    case 'conflict': {
      const cells = response.conflictCells ?? [];
      return {
        kind: 'issue',
        status: 'conflict',
        cells,
        message: 'Two matching digits share a row, column, or box. Fix that conflict before the next hint.',
      };
    }

    case 'wrong_entry': {
      const cells = response.wrongCells ?? [];
      const count = cells.length;
      return {
        kind: 'issue',
        status: 'wrong_entry',
        cells,
        message: `${count} entered ${count === 1 ? 'digit does' : 'digits do'} not match the solution yet. Review it before the next hint.`,
      };
    }

    case 'ok':
      if (!response.step) {
        return { kind: 'notice', message: 'No logical hint was returned for this board.' };
      }
      return {
        kind: 'step',
        tier: 1,
        step: response.step,
      };

    case 'solved':
      return { kind: 'notice', message: 'Every cell on the board is already solved!' };

    case 'unsolvable':
      return {
        kind: 'notice',
        message: 'Current entries lead to a dead end. Try Undo or Check Board first.',
      };

    case 'no_logical_step':
    default:
      return {
        kind: 'notice',
        message: 'No standard logical step applies from the current entries.',
      };
  }
}

export function advanceActiveHint(current: ActiveHintState): {
  readonly next: ActiveHintState;
  readonly shouldApplyStep: boolean;
} {
  if (current.kind !== 'step') {
    return { next: current, shouldApplyStep: false };
  }
  if (current.tier === 1) {
    return { next: { kind: 'step', tier: 2, step: current.step }, shouldApplyStep: false };
  }
  if (current.tier === 2) {
    return { next: { kind: 'step', tier: 3, step: current.step }, shouldApplyStep: false };
  }
  return { next: { kind: 'idle' }, shouldApplyStep: true };
}
