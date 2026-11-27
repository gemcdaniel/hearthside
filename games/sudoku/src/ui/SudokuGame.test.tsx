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
import type { SudokuHintResponse } from '../engine/hints';
import { getStarterPuzzle } from '../engine/starterBank';
import type { PuzzleRecord } from '../engine/types';
import type { SudokuWasmClient } from '../wasm/sudokuWasmClient';
import { SudokuGame } from './SudokuGame';

function createMemoryStorage(): GameStorageService {
  const saves = new Map<string, SaveEnvelope>();
  let stats: GameStatsRecord | null = null;
  const completed: CompletedPuzzleRecord[] = [];
  const cachedPuzzles = new Map<string, unknown>();

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
    async loadCachedPuzzle<TPuzzle = unknown>(cacheKey: string) {
      return (cachedPuzzles.get(cacheKey) as TPuzzle | undefined) ?? null;
    },
    async saveCachedPuzzle<TPuzzle = unknown>(cacheKey: string, puzzle: TPuzzle) {
      cachedPuzzles.set(cacheKey, puzzle);
    },
  };
}

function createMockWasmClient(
  overrides: {
    readonly nextHint?: (board: string, solution: string) => Promise<SudokuHintResponse>;
    readonly generatePuzzle?: (seed: number) => Promise<PuzzleRecord>;
  } = {},
): SudokuWasmClient {
  return {
    nextHint:
      overrides.nextHint ??
      vi.fn(async (): Promise<SudokuHintResponse> => ({
        ok: true,
        engineVersion: '0.1.0-dev',
        status: 'ok',
        step: {
          technique: 'naked_single',
          difficulty: 'easy',
          region: { kind: 'cell', index: 0 },
          drivingCells: [1, 2],
          placements: [{ cell: 0, digit: 7 }],
          eliminations: [],
        },
      })),
    generatePuzzle: overrides.generatePuzzle ?? vi.fn(async () => getStarterPuzzle('easy', 1)),
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

    const notesBtn = screen.getByRole('button', { name: /^Notes/ });
    const numpad = screen.getByRole('group', { name: 'Number pad' });
    expect(notesBtn).toHaveAttribute('aria-pressed', 'false');
    expect(notesBtn).toHaveTextContent('OFF');
    expect(numpad).toHaveAttribute('data-notes-mode', 'false');

    // Enter manual note 7 in cell 0
    fireEvent.click(notesBtn);
    expect(notesBtn).toHaveAttribute('aria-pressed', 'true');
    expect(notesBtn).toHaveTextContent('ON');
    expect(numpad).toHaveAttribute('data-notes-mode', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Note 7,/ }));
    const note7 = cell0!.querySelector('[data-note-digit="7"]');
    expect(note7).toHaveAttribute('data-active', 'true');
    expect(note7).toHaveTextContent('7');
    expect(cell0).toHaveAttribute('aria-label', expect.stringContaining('notes 7'));

    // Selecting given cell 13 (value 7) emphasizes note 7 inside cell 0
    fireEvent.pointerDown(cell13!);
    expect(cell0!.querySelector('[data-note-digit="7"]')).toHaveAttribute(
      'data-note-match',
      'true',
    );

    // Status rail is always present (no conditional Auto-Show banner above board)
    const statusRail = screen.getByTestId('sudoku-status-rail');
    expect(statusRail).toHaveAttribute('data-has-message', 'false');

    // Toggle Auto-Show ON -> button reports aria-pressed=true and ON badge, candidates appear, zero banner
    const autoShowBtn = screen.getByRole('button', { name: /^Auto-Show/ });
    expect(autoShowBtn).toHaveAttribute('aria-pressed', 'false');
    expect(autoShowBtn).toHaveTextContent('OFF');
    fireEvent.click(autoShowBtn);
    expect(autoShowBtn).toHaveAttribute('aria-pressed', 'true');
    expect(autoShowBtn).toHaveTextContent('ON');
    expect(screen.queryByText(/Auto-Show Candidates active/i)).not.toBeInTheDocument();
    expect(statusRail).toHaveAttribute('data-has-message', 'false');
    expect(cell0!.querySelector('[data-note-digit="1"]')).toHaveAttribute('data-active', 'true');

    // Toggle Auto-Show OFF -> manual note 7 returns untouched while auto-show candidates vanish
    fireEvent.click(autoShowBtn);
    expect(autoShowBtn).toHaveAttribute('aria-pressed', 'false');
    expect(autoShowBtn).toHaveTextContent('OFF');
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

    // Place 8 into cell 0 -> duplicate conflict with cell 5 + nudge micro-interaction
    fireEvent.pointerDown(cell0);
    fireEvent.click(screen.getByRole('button', { name: /Enter 8,/ }));
    expect(cell0).toHaveAttribute('data-conflict', 'true');
    expect(cell5).toHaveAttribute('data-conflict', 'true');
    expect(cell0).toHaveAttribute('data-nudge', 'true');
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

  it('plays unitComplete + sweeps row without leaking solution, skips sweep on undo, and plays win on final cell', async () => {
    const storage = createMemoryStorage();
    // Row 0 is missing only cell 0 (=7); rest of board also has empty cells so completing row 0 is not final win.
    const rowNearlyDone: PuzzleRecord = {
      id: 'unit-sweep-test',
      seed: 12345,
      engineVersion: '0.1.0-dev',
      difficulty: 'easy',
      techniquesRequired: ['naked_single'],
      clues: '023968154549371682186254379432716598615489237978532416257843961391627845064195723',
      solution: '723968154549371682186254379432716598615489237978532416257843961391627845864195723',
    };
    const audio = createMockAudio();
    const wasmClient = createMockWasmClient({
      generatePuzzle: vi.fn(async () => rowNearlyDone),
    });
    // Use empty completed set but provide puzzle via daily mode so rowNearlyDone loads directly
    const services = createTestServices({ storage, audio });
    render(
      <SudokuGame
        services={services}
        initialMode="daily:2026-11-27:easy"
        wasmClient={wasmClient}
      />,
    );

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    const cells = within(grid).getAllByRole('gridcell');
    const cell0 = cells[0]!;
    const cell1 = cells[1]!;

    // Complete row 0 (not final win since cell 72 is empty) -> unitComplete SFX + sweep on row 0
    fireEvent.pointerDown(cell0);
    fireEvent.click(screen.getByRole('button', { name: /Enter 7,/ }));
    expect(audio.playSfx).toHaveBeenCalledWith('unitComplete');
    expect(cell0).toHaveAttribute('data-unit-complete', 'true');
    expect(cell1).toHaveAttribute('data-unit-complete', 'true');
    expect(cell0.querySelector('.hs-sudoku-digit')).toHaveAttribute('data-pop', 'true');

    // Undo clears sweep & plays tap (never unitComplete)
    audio.playSfx.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(audio.playSfx).toHaveBeenCalledWith('tap');
    expect(audio.playSfx).not.toHaveBeenCalledWith('unitComplete');
    expect(cell0).toHaveAttribute('data-unit-complete', 'false');

    // Finish both remaining cells -> final cell triggers 'win' + victory ripple (not unitComplete)
    fireEvent.pointerDown(cell0);
    fireEvent.click(screen.getByRole('button', { name: /Enter 7,/ }));
    audio.playSfx.mockClear();

    const cell72 = within(grid).getAllByRole('gridcell')[72]!;
    fireEvent.pointerDown(cell72);
    fireEvent.click(screen.getByRole('button', { name: /Enter 8,/ }));
    expect(audio.playSfx).toHaveBeenCalledWith('win');
    expect(audio.playSfx).not.toHaveBeenCalledWith('unitComplete');
    expect(grid).toHaveAttribute('data-victory-ripple', 'true');
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
    expect(screen.getByRole('button', { name: /^Notes/ })).toHaveAttribute('aria-pressed', 'true');
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

  it('guards wrong entries before stepping through 4-tier progressive hints and undo', async () => {
    const wasmClient = createMockWasmClient({
      nextHint: vi.fn(async (board: string): Promise<SudokuHintResponse> => {
        if (board.charAt(0) === '1') {
          return {
            ok: true,
            engineVersion: '0.1.0-dev',
            status: 'wrong_entry',
            wrongCells: [0],
          };
        }
        return {
          ok: true,
          engineVersion: '0.1.0-dev',
          status: 'ok',
          step: {
            technique: 'naked_single',
            difficulty: 'easy',
            region: { kind: 'cell', index: 0 },
            drivingCells: [1, 2],
            placements: [{ cell: 0, digit: 7 }],
            eliminations: [],
          },
        };
      }),
    });

    const audio = createMockAudio();
    const services = createTestServices({ audio, flagWrongValues: false });
    render(<SudokuGame services={services} initialMode="easy" wasmClient={wasmClient} />);

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    const cell0 = within(grid).getAllByRole('gridcell')[0]!;

    // Place unflagged wrong entry 1
    fireEvent.pointerDown(cell0);
    fireEvent.click(screen.getByRole('button', { name: /Enter 1,/ }));
    expect(cell0).toHaveTextContent('1');

    // Hint detects unflagged wrong entry and offers Show / Clear
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    const issueCard = await screen.findByTestId('sudoku-hint-card');
    expect(within(issueCard).getByText('Wrong Entry Found')).toBeInTheDocument();
    expect(cell0).toHaveAttribute('data-hint-role', 'issue');

    // Clicking Clear removes the wrong entry cleanly
    fireEvent.click(within(issueCard).getByRole('button', { name: 'Clear' }));
    expect(cell0).toHaveTextContent('');

    // Now request Hint -> Tier 1 (Box 1), Tier 2 (Naked Single), Tier 3 (Target highlight + preview), Tier 4 (Apply)
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    const tier1Card = await screen.findByTestId('sudoku-hint-card');
    expect(within(tier1Card).getByText(/Hint 1\/4/)).toBeInTheDocument();

    fireEvent.click(within(tier1Card).getByRole('button', { name: 'Next Hint' }));
    expect(
      within(screen.getByTestId('sudoku-hint-card')).getByText(/Hint 2\/4 · Naked Single/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next Hint' }));
    expect(
      within(screen.getByTestId('sudoku-hint-card')).getByText(/Hint 3\/4 · Naked Single/),
    ).toBeInTheDocument();
    expect(cell0).toHaveAttribute('data-hint-role', 'target');

    fireEvent.click(screen.getByRole('button', { name: 'Apply Step' }));
    expect(cell0).toHaveTextContent('7');
    expect(audio.playSfx).toHaveBeenCalledWith('hint');

    // Undo reverses Tier 4 hint placement
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cell0).toHaveTextContent('');
  });

  it('caches generated Daily Puzzle offline, updates stats, and shows Victory modal with Personal Best', async () => {
    const storage = createMemoryStorage();
    const nearlySolved: PuzzleRecord = {
      id: 'daily-test-nearly-solved',
      seed: 98765,
      engineVersion: '0.1.0-dev',
      difficulty: 'easy',
      techniquesRequired: ['naked_single'],
      clues: '023968154549371682186254379432716598615489237978532416257843961391627845864195723',
      solution: '723968154549371682186254379432716598615489237978532416257843961391627845864195723',
    };
    const generateSpy = vi.fn(async () => nearlySolved);
    const wasmClient = createMockWasmClient({ generatePuzzle: generateSpy });
    const services = createTestServices({ storage });

    const first = render(
      <SudokuGame
        services={services}
        initialMode="daily:2026-11-27:easy"
        wasmClient={wasmClient}
      />,
    );

    const grid = await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    expect(generateSpy).toHaveBeenCalledTimes(1);

    // Complete final cell 0 with 7 -> Victory modal with New Personal Best!
    const cell0 = within(grid).getAllByRole('gridcell')[0]!;
    fireEvent.pointerDown(cell0);
    fireEvent.click(screen.getByRole('button', { name: /Enter 7,/ }));

    const victoryDialog = await screen.findByRole('dialog', { name: /Puzzle Solved/i });
    expect(within(victoryDialog).getByText('New Personal Best!')).toBeInTheDocument();
    expect(within(victoryDialog).getByText(/Daily \(2026-11-27\)/)).toBeInTheDocument();
    expect(screen.getByTestId('sudoku-live-announcer')).toHaveTextContent(/Puzzle solved/i);

    // View Stats button opens live Stats modal cleanly in front of Victory modal
    fireEvent.click(within(victoryDialog).getByRole('button', { name: 'View Stats' }));
    const statsDialog = await screen.findByRole('dialog', { name: 'Sudoku Statistics' });
    expect(within(statsDialog).getByText('100%')).toBeInTheDocument();
    expect(statsDialog.parentElement).toHaveClass('hs-sudoku-stats-backdrop');
    expect(
      victoryDialog.compareDocumentPosition(statsDialog) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Closing Stats returns cleanly to Victory modal
    fireEvent.click(within(statsDialog).getByRole('button', { name: 'Close Statistics' }));
    expect(screen.queryByRole('dialog', { name: 'Sudoku Statistics' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Puzzle Solved/i })).toBeInTheDocument();

    first.unmount();

    // Launching same Daily date again uses IndexedDB cache without calling generatePuzzle a second time
    render(
      <SudokuGame
        services={services}
        initialMode="daily:2026-11-27:easy"
        wasmClient={wasmClient}
      />,
    );
    await screen.findByRole('grid', { name: '9 by 9 Sudoku board' });
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });
});
