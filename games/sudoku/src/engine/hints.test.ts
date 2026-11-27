import { describe, expect, it } from 'vitest';
import {
  TECHNIQUE_GUIDES,
  advanceActiveHint,
  createActiveHintFromResponse,
  formatHintTierMessage,
  getTier1Region,
  type HintStep,
} from './hints';

const SAMPLE_STEP: HintStep = {
  technique: 'naked_single',
  difficulty: 'easy',
  region: { kind: 'cell', index: 40 },
  drivingCells: [31, 39],
  placements: [{ cell: 40, digit: 5 }],
  eliminations: [],
};

describe('Sudoku 4-tier progressive hint state machine', () => {
  it('provides plain-English guides for all 13 Go engine techniques', () => {
    const techniques = [
      'naked_single',
      'hidden_single',
      'pointing_line',
      'box_line_reduction',
      'naked_pair',
      'hidden_pair',
      'naked_triple',
      'hidden_triple',
      'skyscraper',
      'x_wing',
      'w_wing',
      'xy_wing',
      'swordfish',
    ];
    for (const tech of techniques) {
      expect(TECHNIQUE_GUIDES[tech]?.label.length).toBeGreaterThan(0);
      expect(TECHNIQUE_GUIDES[tech]?.summary.length).toBeGreaterThan(0);
    }
  });

  it('guards against conflicts and unflagged wrong entries before logical steps (D21)', () => {
    const conflict = createActiveHintFromResponse({
      ok: true,
      engineVersion: '0.1.0-dev',
      status: 'conflict',
      conflictCells: [0, 5],
    });
    expect(conflict.kind).toBe('issue');
    if (conflict.kind === 'issue') {
      expect(conflict.status).toBe('conflict');
      expect(conflict.cells).toEqual([0, 5]);
    }

    const wrong = createActiveHintFromResponse({
      ok: true,
      engineVersion: '0.1.0-dev',
      status: 'wrong_entry',
      wrongCells: [12],
    });
    expect(wrong.kind).toBe('issue');
    if (wrong.kind === 'issue') {
      expect(wrong.status).toBe('wrong_entry');
      expect(wrong.cells).toEqual([12]);
    }
  });

  it('steps cleanly through Tier 1 (region) -> Tier 2 (technique) -> Tier 3 (target) -> Tier 4 (apply)', () => {
    expect(getTier1Region(SAMPLE_STEP)).toEqual({ kind: 'box', index: 4 });

    const tier1 = createActiveHintFromResponse({
      ok: true,
      engineVersion: '0.1.0-dev',
      status: 'ok',
      step: SAMPLE_STEP,
    });
    expect(tier1).toEqual({ kind: 'step', tier: 1, step: SAMPLE_STEP });
    expect(formatHintTierMessage(SAMPLE_STEP, 1).headline).toContain('Box 5');

    const step2 = advanceActiveHint(tier1);
    expect(step2.shouldApplyStep).toBe(false);
    expect(step2.next).toEqual({ kind: 'step', tier: 2, step: SAMPLE_STEP });
    expect(formatHintTierMessage(SAMPLE_STEP, 2).headline).toContain('Naked Single');

    const step3 = advanceActiveHint(step2.next);
    expect(step3.shouldApplyStep).toBe(false);
    expect(step3.next).toEqual({ kind: 'step', tier: 3, step: SAMPLE_STEP });
    expect(formatHintTierMessage(SAMPLE_STEP, 3).detail).toContain('Place 5 in Row 5, Column 5');

    const step4 = advanceActiveHint(step3.next);
    expect(step4.shouldApplyStep).toBe(true);
    expect(step4.next).toEqual({ kind: 'idle' });
  });
});
