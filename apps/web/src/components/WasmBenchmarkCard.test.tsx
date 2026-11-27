import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as wasmBenchmark from '../diagnostics/wasmBenchmark';
import { WasmBenchmarkCard } from './WasmBenchmarkCard';

describe('WasmBenchmarkCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the generatePuzzle (E/M/H) benchmark action and displays verified results', async () => {
    vi.spyOn(wasmBenchmark, 'loadWasmManifest').mockResolvedValue({
      generatedAt: '2026-11-27T13:30:00Z',
      goVersion: 'go version go1.27.4 linux/amd64',
      tinygoVersion: null,
      variants: [
        {
          id: 'go',
          label: 'Standard Go',
          wasmUrl: '/wasm/sudoku-go.wasm',
          glueUrl: '/wasm/wasm_exec-go.js',
          wasmRawBytes: 4_600_000,
          wasmGzipBytes: 1_260_000,
          glueRawBytes: 17_000,
          glueGzipBytes: 4_400,
        },
      ],
    });

    const generateSpy = vi.spyOn(wasmBenchmark, 'runWasmGenerateBenchmark').mockResolvedValue({
      variant: {
        id: 'go',
        label: 'Standard Go',
        wasmUrl: '/wasm/sudoku-go.wasm',
        glueUrl: '/wasm/wasm_exec-go.js',
        wasmRawBytes: 4_600_000,
        wasmGzipBytes: 1_260_000,
        glueRawBytes: 17_000,
        glueGzipBytes: 4_400,
      },
      engineVersion: '0.1.0-dev',
      coldStartMs: 24.5,
      seed: 1,
      entries: [
        {
          difficulty: 'easy',
          puzzleId: 'hs-easy-1',
          clueCount: 28,
          generateMs: 2.3,
          gradeMs: 0.15,
          gradedDifficulty: 'easy',
          gradeMatched: true,
          techniquesRequired: ['naked_single'],
        },
        {
          difficulty: 'medium',
          puzzleId: 'hs-medium-1',
          clueCount: 24,
          generateMs: 18.4,
          gradeMs: 0.25,
          gradedDifficulty: 'medium',
          gradeMatched: true,
          techniquesRequired: ['naked_single', 'pointing_line'],
        },
        {
          difficulty: 'hard',
          puzzleId: 'hs-hard-1',
          clueCount: 25,
          generateMs: 42.7,
          gradeMs: 0.35,
          gradedDifficulty: 'hard',
          gradeMatched: true,
          techniquesRequired: ['naked_single', 'skyscraper'],
        },
      ],
    });

    render(<WasmBenchmarkCard />);

    const genBtn = await screen.findByRole('button', { name: 'Benchmark Generate (E/M/H)' });
    await waitFor(() => {
      expect(genBtn).not.toBeDisabled();
    });

    fireEvent.click(genBtn);

    await waitFor(() => {
      expect(screen.getByText(/hs-hard-1/)).toBeInTheDocument();
    });

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Verified')).toHaveLength(3);
  });
});
