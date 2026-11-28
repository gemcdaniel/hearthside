import type { SaveSyncConflict } from '@hearthside/game-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SyncConflictModal } from './SyncConflictModal';

function makeConflict(overrides: Partial<SaveSyncConflict> = {}): SaveSyncConflict {
  return {
    profileId: 'local-p1',
    gameId: 'sudoku',
    slot: 'medium',
    localSave: {
      schemaVersion: 1,
      profileId: 'local-p1',
      gameId: 'sudoku',
      slot: 'medium',
      updatedAt: '2026-11-27T16:05:00.000Z',
      clientUpdatedAt: '2026-11-27T16:05:00.000Z',
      baseRevision: 1,
      dirty: true,
      deleted: false,
      summary: {
        puzzleId: 'puz-a',
        completed: false,
        elapsedMs: 125_000,
        filledCells: 34,
      },
      payload: '{}',
    },
    serverSave: {
      profileId: 'remote-p1',
      gameId: 'sudoku',
      slot: 'medium',
      schemaVersion: 1,
      revision: 2,
      puzzleId: 'puz-b',
      completed: false,
      deleted: false,
      elapsedMs: 245_000,
      filledCells: 52,
      payload: '{}',
      clientUpdatedAt: '2026-11-27T16:04:00.000Z',
      updatedAt: '2026-11-27T16:04:01.000Z',
    },
    detectedAt: '2026-11-27T16:06:00.000Z',
    ...overrides,
  };
}

describe('SyncConflictModal', () => {
  it('renders side-by-side device vs cloud metadata and resolves Keep Local / Keep Cloud', async () => {
    const c1 = makeConflict();
    const c2 = makeConflict({
      slot: 'daily:2026-11-27:easy',
      localSave: {
        ...c1.localSave,
        slot: 'daily:2026-11-27:easy',
        deleted: true,
        summary: { puzzleId: 'daily-1', completed: false, elapsedMs: 0, filledCells: 0 },
      },
      serverSave: {
        ...c1.serverSave,
        slot: 'daily:2026-11-27:easy',
        puzzleId: 'daily-1',
        completed: true,
        filledCells: 81,
        elapsedMs: 95_000,
      },
    });

    const onKeepLocal = vi.fn().mockResolvedValue(undefined);
    const onKeepCloud = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <SyncConflictModal
        open={true}
        conflicts={[c1, c2]}
        onResolveKeepLocal={onKeepLocal}
        onResolveKeepCloud={onKeepCloud}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /Resolve Sync Conflict/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Sudoku — Medium')).toBeInTheDocument();
    expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument();
    expect(
      screen.getByText('These two devices were playing different puzzles on the same slot.'),
    ).toBeInTheDocument();
    expect(screen.getByText('34 / 81 cells')).toBeInTheDocument();
    expect(screen.getByText('02:05')).toBeInTheDocument();
    expect(screen.getByText('52 / 81 cells')).toBeInTheDocument();
    expect(screen.getByText('04:05')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep This Device' }));
    await waitFor(() => expect(onKeepLocal).toHaveBeenCalledWith(c1));

    // Step to second conflict (cleared local vs completed cloud)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Conflict 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Sudoku — Daily Easy (2026-11-27)')).toBeInTheDocument();
    expect(screen.getByText('Cleared / Abandoned')).toBeInTheDocument();
    expect(screen.getByText('81 / 81 cells (Solved)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Cloud Copy' }));
    await waitFor(() => expect(onKeepCloud).toHaveBeenCalledWith(c2));

    // Escape closes without resolving
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays inline error alert if resolving a conflict rejects', async () => {
    const conflict = makeConflict();
    const onKeepLocal = vi.fn().mockRejectedValue(new Error('Network unavailable'));

    render(
      <SyncConflictModal
        open={true}
        conflicts={[conflict]}
        onResolveKeepLocal={onKeepLocal}
        onResolveKeepCloud={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep This Device' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    });
  });
});
