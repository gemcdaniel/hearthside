import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WASM_MAX_GZIP_BYTES,
  computeTimingStats,
  countPuzzleClues,
  evaluateWasmBudgets,
  formatBenchmarkMarkdownRow,
  formatBytes,
  loadWasmManifest,
  parseWasmManifest,
  runWasmBenchmark,
  runWasmGenerateBenchmark,
  type WasmBenchmarkResult,
  type WasmVariantInfo,
  type WasmWorkerResponse,
} from './wasmBenchmark';

const sampleVariant: WasmVariantInfo = {
  id: 'go',
  label: 'Standard Go',
  wasmUrl: '/wasm/sudoku-go.wasm',
  glueUrl: '/wasm/wasm_exec-go.js',
  wasmRawBytes: 2_621_440,
  wasmGzipBytes: 716_800,
  glueRawBytes: 17_000,
  glueGzipBytes: 6_000,
};

function stubMockWorker(response: WasmWorkerResponse) {
  const postMessageSpy = vi.fn();
  const terminateSpy = vi.fn();

  class MockWorker {
    private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

    addEventListener(type: string, listener: (event: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }

    postMessage(payload: unknown) {
      postMessageSpy(payload);
      const handlers = this.listeners.get('message') ?? [];
      for (const handler of handlers) {
        handler({ data: response });
      }
    }

    terminate() {
      terminateSpy();
    }
  }

  vi.stubGlobal('Worker', MockWorker);
  return { postMessageSpy, terminateSpy };
}

describe('wasmBenchmark helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computes min, median, p95, and max timing stats', () => {
    expect(computeTimingStats([])).toEqual({
      minMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
    });

    const stats = computeTimingStats([10, 2, 8, 4, 6, 12, 14, 16, 18, 20]);
    expect(stats).toEqual({
      minMs: 2,
      medianMs: 11,
      p95Ms: 20,
      maxMs: 20,
    });
  });

  it('counts non-empty digit clues accurately', () => {
    expect(countPuzzleClues('000.5.901')).toBe(3);
    expect(countPuzzleClues('530070000600195000098000060800060003')).toBe(13);
  });

  it('evaluates Phase 0 WASM performance budgets accurately', () => {
    expect(evaluateWasmBudgets(1_500_000, 450, 12)).toEqual({
      gzipPass: true,
      startupPass: true,
      hintPass: true,
      allPassed: true,
    });

    expect(evaluateWasmBudgets(WASM_MAX_GZIP_BYTES + 1, 1000, 200)).toEqual({
      gzipPass: false,
      startupPass: false,
      hintPass: false,
      allPassed: false,
    });
  });

  it('formats byte sizes and Markdown table rows', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MiB');

    const result: WasmBenchmarkResult = {
      variant: sampleVariant,
      engineVersion: '0.1.0-dev',
      iterations: 10,
      coldStartMs: 123.44,
      hintStats: { minMs: 0.5, medianMs: 1.25, p95Ms: 2.5, maxMs: 2.5 },
      countStats: { minMs: 1.0, medianMs: 3.5, p95Ms: 5.0, maxMs: 5.0 },
      hintStatus: 'no_logical_step',
      hintFound: false,
      hintTechnique: 'none',
      solutionCount: 1,
      budgets: {
        gzipPass: true,
        startupPass: true,
        hintPass: true,
        allPassed: true,
      },
    };

    const row = formatBenchmarkMarkdownRow(result, 'Mozilla/5.0 | Test');
    expect(row).toBe(
      '| Mozilla/5.0 \\| Test | Standard Go | 2.50 MiB | 700.0 KiB | 123.4 ms | 1.25 / 2.50 ms | 3.50 / 5.00 ms | Pass |',
    );
  });

  it('parses and loads /wasm/manifest.json safely', async () => {
    expect(parseWasmManifest(null)).toBeNull();
    expect(parseWasmManifest({ variants: [] })).toBeNull();

    const sampleManifest = {
      generatedAt: '2026-11-26T20:15:00Z',
      goVersion: 'go version go1.27.4 linux/amd64',
      tinygoVersion: null,
      variants: [
        {
          id: 'go',
          label: 'Standard Go',
          wasmUrl: '/wasm/sudoku-go.wasm',
          glueUrl: '/wasm/wasm_exec-go.js',
          wasmRawBytes: 2_500_000,
          wasmGzipBytes: 650_000,
          glueRawBytes: 16_992,
          glueGzipBytes: 5_500,
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => sampleManifest,
      }),
    );

    const loaded = await loadWasmManifest();
    expect(loaded).toEqual(sampleManifest);
  });

  it('dispatches benchmark and generateBenchmark worker requests cleanly', async () => {
    const benchStub = stubMockWorker({
      ok: true,
      kind: 'benchmark',
      engineVersion: '0.1.0-dev',
      coldStartMs: 25,
      hintSamplesMs: [0.4, 0.6],
      countSamplesMs: [0.2, 0.3],
      hintStatus: 'ok',
      hintFound: true,
      hintTechnique: 'x_wing',
      solutionCount: 1,
    });

    const benchRes = await runWasmBenchmark(sampleVariant, 2);
    expect(benchStub.postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'benchmark', iterations: 2 }),
    );
    expect(benchStub.terminateSpy).toHaveBeenCalledTimes(1);
    expect(benchRes.hintStatus).toBe('ok');
    expect(benchRes.hintTechnique).toBe('x_wing');

    const genStub = stubMockWorker({
      ok: true,
      kind: 'generateBenchmark',
      engineVersion: '0.1.0-dev',
      coldStartMs: 22,
      seed: 7,
      entries: [
        {
          difficulty: 'easy',
          puzzleId: 'hs-0.1.0-dev-easy-0000000000000007',
          clueCount: 28,
          generateMs: 2.1,
          gradeMs: 0.2,
          gradedDifficulty: 'easy',
          gradeMatched: true,
          techniquesRequired: ['naked_single', 'hidden_single'],
        },
      ],
    });

    const genRes = await runWasmGenerateBenchmark(sampleVariant, 7);
    expect(genStub.postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'generateBenchmark',
        seed: 7,
        difficulties: ['easy', 'medium', 'hard'],
      }),
    );
    expect(genStub.terminateSpy).toHaveBeenCalledTimes(1);
    expect(genRes.entries[0]?.gradeMatched).toBe(true);
  });
});
