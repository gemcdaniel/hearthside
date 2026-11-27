import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WASM_MAX_GZIP_BYTES,
  computeTimingStats,
  evaluateWasmBudgets,
  formatBenchmarkMarkdownRow,
  formatBytes,
  loadWasmManifest,
  parseWasmManifest,
  type WasmBenchmarkResult,
} from './wasmBenchmark';

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
      variant: {
        id: 'go',
        label: 'Standard Go',
        wasmUrl: '/wasm/sudoku-go.wasm',
        glueUrl: '/wasm/wasm_exec-go.js',
        wasmRawBytes: 2_621_440,
        wasmGzipBytes: 716_800,
        glueRawBytes: 17_000,
        glueGzipBytes: 6_000,
      },
      engineVersion: '0.1.0-dev',
      iterations: 10,
      coldStartMs: 123.44,
      hintStats: { minMs: 0.5, medianMs: 1.25, p95Ms: 2.5, maxMs: 2.5 },
      countStats: { minMs: 1.0, medianMs: 3.5, p95Ms: 5.0, maxMs: 5.0 },
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
});
