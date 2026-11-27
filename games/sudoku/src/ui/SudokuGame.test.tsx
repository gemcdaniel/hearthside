import {
  createDefaultProfileSettings,
  type AudioCue,
  type AudioService,
  type CompletedPuzzleRecord,
  type GameStatsRecord,
  type GameStorageService,
  type Profile,
  type SaveEnvelope,
  type ShellServices,
} from '@hearthside/game-core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SudokuGame } from './SudokuGame';

function createMemoryStorage(): GameStorageService {
  const saves = new Map<string, SaveEnvelope>();
  let stats: GameStatsRecord | null = null;
  const completed: CompletedPuzzleRecord[] = [];

  return {
    async loadSave<TPayload = unknown>(slot: string) {
      return (saves.get(slot) as SaveEnvelope<TPayload> | undefined) ?? null;
    },
    async saveGame<TPayload = unknown>(envelope: SaveEnvelope<TPayload>) {
      saves.set(envelope.slot, envelope);
    },
    async deleteSave(slot: string) {
      saves.delete(slot);
    },
    async listSaves() {
      return Array.from(saves.values());
    },
    async loadStats<TStats = unknown>() {
      return stats as GameStatsRecord<TStats> | null;
    },
    async saveStats<TStats = unknown>(record: GameStatsRecord<TStats>) {
      stats = record;
    },
    async recordCompletedPuzzle(record: CompletedPuzzleRecord) {
      completed.push(record);
    },
    async listCompletedPuzzles() {
      return [...completed];
    },
  };
}

function createMockAudio() {
  const playSfx = vi.fn<(cue: AudioCue) => void>();
  const service: AudioService = {
    unlock: vi.fn().mockResolvedValue(undefined),
    playSfx,
    setSfxEnabled: vi.fn(),
    setSfxVolume: vi.fn(),
    setMusicEnabled: vi.fn(),
    setMusicVolume: vi.fn(),
    playMusicTrack: vi.fn(),
    stopMusic: vi.fn(),
  };
  return { ...service, playSfx };
}

function createTestServices(
  overrides: {
    readonly flagDuplicateConflicts?: boolean;
    readonly flagWrongValues?: boolean;
    readonly storage?: GameStorageService;
    readonly audio?: AudioService;
  } = {},
): ShellServices {
  const profile: Profile = {
    id: 'profile-1',
    name: 'Tester',
    avatarId: 'hearth',
    accentColor: 'cobalt',
    createdAt: '2026-11-27T00:00:00.000Z',
  };
  const defaults = createDefaultProfileSettings('light');
  return {
    activeProfile: profile,
    settings: {
      ...defaults,
      sudoku: {
        flagDuplicateConflicts: overrides.flagDuplicateConflicts ?? true,
        flagWrongValues: overrides.flagWrongValues ?? false,
      },
    },
    storage: overrides.storage ?? createMemoryStorage(),
    audio: overrides.audio ?? createMockAudio(),
    onExitToLibrary: vi.fn(),
  };
}

describe('SudokuGame UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders 81 borderless cells and the 12 thin / 4 thick SVG overlay lines', async () => {
    const services = createTestServices();
    render(<SudokuGame services={services} initialMode="easy" />);

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells).toHaveLength(81);

    const svg = screen.getByTestId('sudoku-grid-lines-svg');
    const thinLines = svg.querySelectorAll('line[data-line-kind="cell"]');
    const boxLines = svg.querySelectorAll('line[data-line-kind="box"]');
    expect(thinLines).toHaveLength(12);
    expect(boxLines).toHaveLength(4);

    for (const line of thinLines) {
      const coords = [
        line.getAttribute('x1'),
        line.getAttribute('y1'),
        line.getAttribute('x2'),
        line.getAttribute('y2'),
      ];
      expect(coords).not.toContain('300');
      expect(coords).not.toContain('600');
    }
  });

  it('renders selection highlights, D8/D12/D20 notes in the 3x3 sub-grid, and emphasizes matching note digits', async () => {
    const services = createTestServices();
    render(<SudokuGame services={services} initialMode="easy" />);

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    const cells = within(grid).getAllByRole('gridcell');
    const cell0 = cells[0];
    const cell1 = cells[1];
    const cell5 = cells[5]; // given 8 in row 0
    const cell13 = cells[13]; // given 7 in row 1 col 4 (not a peer of cell 0)
    const cell80 = cells[80];
    expect(cell0 && cell1 && cell5 && cell13 && cell80).toBeTruthy();

    fireEvent.pointerDown(cell0!);
    expect(cell0).toHaveAttribute('data-highlight', 'selected');
    expect(cell1).toHaveAttribute('data-highlight', 'peer');
    expect(cell80).toHaveAttribute('data-highlight', 'none');

    // Enter manual note 7 in cell 0
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: /Note 7,/ }));
    const note7 = cell0!.querySelector('[data-note-digit="7"]');
    expect(note7).toHaveAttribute('data-active', 'true');
    expect(note7).toHaveTextContent('7');

    // Selecting given cell 13 (value 7) emphasizes note 7 inside cell 0
    fireEvent.pointerDown(cell13!);
    expect(cell0!.querySelector('[data-note-digit="7"]')).toHaveAttribute(
      'data-note-match',
      'true',
    );

    // Status rail is always present (no conditional Auto-Show banner above board)
    const statusRail = screen.getByTestId('sudoku-status-rail');
    expect(statusRail).toHaveAttribute('data-has-message', 'false');

    // Toggle Auto-Show ON -> button reports aria-pressed=true, candidates appear, zero banner
    const autoShowBtn = screen.getByRole('button', { name: 'Auto-Show' });
    fireEvent.click(autoShowBtn);
    expect(autoShowBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Auto-Show Candidates active/i)).not.toBeInTheDocument();
    expect(statusRail).toHaveAttribute('data-has-message', 'false');
    expect(cell0!.querySelector('[data-note-digit="1"]')).toHaveAttribute('data-active', 'true');

    // Toggle Auto-Show OFF -> manual note 7 returns untouched while auto-show candidates vanish
    fireEvent.click(autoShowBtn);
    expect(autoShowBtn).toHaveAttribute('aria-pressed', 'false');
    expect(cell0!.querySelector('[data-note-digit="7"]')).toHaveAttribute('data-active', 'true');
    expect(cell0!.querySelector('[data-note-digit="1"]')).toHaveAttribute('data-active', 'false');
  });

  it('enforces D21 mistake toggles cleanly (conflicts vs kid-friendly wrong values & Check Board)', async () => {
    const audio = createMockAudio();
    const services = createTestServices({
      flagDuplicateConflicts: true,
      flagWrongValues: false,
      audio,
    });
    render(<SudokuGame services={services} initialMode="easy" />);

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    const cells = within(grid).getAllByRole('gridcell');
    const cell0 = cells[0]!; // solution[0] = 7; row 0 has 8 at cell 5
    const cell5 = cells[5]!;

    // Place 8 into cell 0 -> duplicate conflict with cell 5
    fireEvent.pointerDown(cell0);
    fireEvent.click(screen.getByRole('button', { name: /Enter 8,/ }));
    expect(cell0).toHaveAttribute('data-conflict', 'true');
    expect(cell5).toHaveAttribute('data-conflict', 'true');
    expect(audio.playSfx).toHaveBeenCalledWith('conflict');

    // Replace with 1 (no peer duplicate, but disagrees with solution=7).
    // Because flagWrongValues=false, it is NOT flagged yet.
    fireEvent.click(screen.getByRole('button', { name: /Enter 1,/ }));
    expect(cell0).toHaveAttribute('data-conflict', 'false');
    expect(cell0).toHaveAttribute('data-wrong', 'false');

    // Tapping Check Board transiently flags cell 0 inside the fixed status rail!
    fireEvent.click(screen.getByRole('button', { name: 'Check Board' }));
    expect(cell0).toHaveAttribute('data-wrong', 'true');
    const statusRail = screen.getByTestId('sudoku-status-rail');
    expect(statusRail).toHaveAttribute('data-has-message', 'true');
    expect(within(statusRail).getByText('1 wrong entry highlighted.')).toBeInTheDocument();

    // Entering the right digit 7 clears the check flag and plays place SFX
    fireEvent.click(screen.getByRole('button', { name: /Enter 7,/ }));
    expect(cell0).toHaveAttribute('data-wrong', 'false');
    expect(audio.playSfx).toHaveBeenCalledWith('place');
  });

  it('conceals board digits and notes under the Pause curtain and auto-pauses on visibilitychange', async () => {
    const services = createTestServices();
    render(<SudokuGame services={services} initialMode="easy" />);

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    expect(within(grid).getAllByRole('gridcell')[5]).toHaveTextContent('8');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByTestId('pause-curtain')).toBeInTheDocument();
    expect(within(grid).getAllByRole('gridcell')[5]).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button', { name: 'Resume Game' }));
    expect(screen.queryByTestId('pause-curtain')).not.toBeInTheDocument();
    expect(within(grid).getAllByRole('gridcell')[5]).toHaveTextContent('8');

    // Simulate hiding the document tab
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByTestId('pause-curtain')).toBeInTheDocument();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('handles keyboard shortcuts and auto-saves/resumes state across remounts', async () => {
    const storage = createMemoryStorage();
    const services = createTestServices({ storage });
    const firstRender = render(<SudokuGame services={services} initialMode="easy" />);

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    const cell0 = within(grid).getAllByRole('gridcell')[0]!;
    fireEvent.pointerDown(cell0);

    // ArrowRight moves to cell 1, ArrowLeft moves back to cell 0
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(within(grid).getAllByRole('gridcell')[1]).toHaveAttribute('data-highlight', 'selected');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(cell0).toHaveAttribute('data-highlight', 'selected');

    // Press N -> Notes mode ON, enter note 4, press N -> Notes mode OFF, enter digit 7
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: '4' });
    expect(cell0.querySelector('[data-note-digit="4"]')).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key: '7' });
    expect(cell0).toHaveTextContent('7');

    // Backspace clears value and restores manual note 4, Ctrl+Z undoes clear
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(cell0).toHaveTextContent('4');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(cell0).toHaveTextContent('7');

    await waitFor(async () => {
      const saved = await storage.loadSave('easy');
      expect(saved).not.toBeNull();
    });

    firstRender.unmount();

    // Remount -> resumes exact progress from storage
    render(<SudokuGame services={services} initialMode="easy" />);
    const remountGrid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    await waitFor(() => {
      expect(within(remountGrid).getAllByRole('gridcell')[0]).toHaveTextContent('7');
    });
  });
});
