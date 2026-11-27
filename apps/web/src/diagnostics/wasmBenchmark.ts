export const WASM_MAX_GZIP_BYTES = 2 * 1024 * 1024;
export const WASM_MAX_STARTUP_MS = 1000;
export const WASM_MAX_HINT_MS = 200;
export const DEFAULT_BENCHMARK_ITERATIONS = 10;

export const HARD_BENCHMARK_PUZZLE =
  '000000907000420180000705026100904000050000040000507009920108000034059000507000000';

export interface WasmVariantInfo {
  readonly id: 'go' | 'tinygo';
  readonly label: string;
  readonly wasmUrl: string;
  readonly glueUrl: string;
  readonly wasmRawBytes: number;
  readonly wasmGzipBytes: number;
  readonly glueRawBytes: number;
  readonly glueGzipBytes: number;
}

export interface WasmManifest {
  readonly generatedAt: string;
  readonly goVersion: string;
  readonly tinygoVersion: string | null;
  readonly variants: readonly WasmVariantInfo[];
}

export interface TimingStats {
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface WasmBudgetCheck {
  readonly gzipPass: boolean;
  readonly startupPass: boolean;
  readonly hintPass: boolean;
  readonly allPassed: boolean;
}

export interface WasmWorkerRequest {
  readonly variantId: 'go' | 'tinygo';
  readonly wasmUrl: string;
  readonly glueUrl: string;
  readonly puzzle: string;
  readonly iterations: number;
}

export interface WasmWorkerSuccess {
  readonly ok: true;
  readonly engineVersion: string;
  readonly coldStartMs: number;
  readonly hintSamplesMs: readonly number[];
  readonly countSamplesMs: readonly number[];
  readonly hintFound: boolean;
  readonly hintTechnique: string;
  readonly solutionCount: number;
}

export interface WasmWorkerFailure {
  readonly ok: false;
  readonly error: string;
}

export type WasmWorkerResponse = WasmWorkerSuccess | WasmWorkerFailure;

export interface WasmBenchmarkResult {
  readonly variant: WasmVariantInfo;
  readonly engineVersion: string;
  readonly iterations: number;
  readonly coldStartMs: number;
  readonly hintStats: TimingStats;
  readonly countStats: TimingStats;
  readonly hintFound: boolean;
  readonly hintTechnique: string;
  readonly solutionCount: number;
  readonly budgets: WasmBudgetCheck;
}

export function computeTimingStats(samplesMs: readonly number[]): TimingStats {
  if (samplesMs.length === 0) {
    return { minMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0 };
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const len = sorted.length;
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[len - 1] ?? 0;
  const mid = Math.floor(len / 2);
  const medianMs =
    len % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const p95Index = Math.min(len - 1, Math.ceil(0.95 * len) - 1);
  const p95Ms = sorted[p95Index] ?? maxMs;

  return { minMs, medianMs, p95Ms, maxMs };
}

export function evaluateWasmBudgets(
  wasmGzipBytes: number,
  coldStartMs: number,
  hintP95Ms: number,
): WasmBudgetCheck {
  const gzipPass = wasmGzipBytes <= WASM_MAX_GZIP_BYTES;
  const startupPass = coldStartMs < WASM_MAX_STARTUP_MS;
  const hintPass = hintP95Ms < WASM_MAX_HINT_MS;
  return {
    gzipPass,
    startupPass,
    hintPass,
    allPassed: gzipPass && startupPass && hintPass,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(2)} MiB`;
}

export function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function sanitizeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
}

export function formatBenchmarkMarkdownRow(result: WasmBenchmarkResult, userAgent: string): string {
  const rawStr = formatBytes(result.variant.wasmRawBytes);
  const gzipStr = formatBytes(result.variant.wasmGzipBytes);
  const coldStr = `${result.coldStartMs.toFixed(1)} ms`;
  const hintStr = `${result.hintStats.medianMs.toFixed(2)} / ${result.hintStats.p95Ms.toFixed(2)} ms`;
  const countStr = `${result.countStats.medianMs.toFixed(2)} / ${result.countStats.p95Ms.toFixed(2)} ms`;
  const verdict = result.budgets.allPassed ? 'Pass' : 'Fail';

  return `| ${sanitizeCell(userAgent)} | ${result.variant.label} | ${rawStr} | ${gzipStr} | ${coldStr} | ${hintStr} | ${countStr} | ${verdict} |`;
}

function isWasmVariantInfo(value: unknown): value is WasmVariantInfo {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.id === 'go' || v.id === 'tinygo') &&
    typeof v.label === 'string' &&
    typeof v.wasmUrl === 'string' &&
    typeof v.glueUrl === 'string' &&
    typeof v.wasmRawBytes === 'number' &&
    typeof v.wasmGzipBytes === 'number' &&
    typeof v.glueRawBytes === 'number' &&
    typeof v.glueGzipBytes === 'number'
  );
}

export function parseWasmManifest(raw: unknown): WasmManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.generatedAt !== 'string' ||
    typeof candidate.goVersion !== 'string' ||
    (candidate.tinygoVersion !== null && typeof candidate.tinygoVersion !== 'string') ||
    !Array.isArray(candidate.variants)
  ) {
    return null;
  }
  const variants = candidate.variants.filter(isWasmVariantInfo);
  if (variants.length === 0) {
    return null;
  }
  return {
    generatedAt: candidate.generatedAt,
    goVersion: candidate.goVersion,
    tinygoVersion: candidate.tinygoVersion,
    variants,
  };
}

export async function loadWasmManifest(): Promise<WasmManifest | null> {
  const response = await fetch('/wasm/manifest.json', { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }
  const data: unknown = await response.json();
  return parseWasmManifest(data);
}

export function runWasmBenchmark(
  variant: WasmVariantInfo,
  iterations = DEFAULT_BENCHMARK_ITERATIONS,
): Promise<WasmBenchmarkResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./wasmWorker.ts', import.meta.url), { type: 'module' });

    const cleanup = () => {
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<WasmWorkerResponse>) => {
      cleanup();
      const data = event.data;
      if (!data.ok) {
        reject(new Error(data.error));
        return;
      }
      const hintStats = computeTimingStats(data.hintSamplesMs);
      const countStats = computeTimingStats(data.countSamplesMs);
      const budgets = evaluateWasmBudgets(variant.wasmGzipBytes, data.coldStartMs, hintStats.p95Ms);
      resolve({
        variant,
        engineVersion: data.engineVersion,
        iterations,
        coldStartMs: data.coldStartMs,
        hintStats,
        countStats,
        hintFound: data.hintFound,
        hintTechnique: data.hintTechnique,
        solutionCount: data.solutionCount,
        budgets,
      });
    });

    worker.addEventListener('error', (event) => {
      cleanup();
      reject(new Error(event.message || 'WASM benchmark worker crashed.'));
    });

    const request: WasmWorkerRequest = {
      variantId: variant.id,
      wasmUrl: variant.wasmUrl,
      glueUrl: variant.glueUrl,
      puzzle: HARD_BENCHMARK_PUZZLE,
      iterations,
    };
    worker.postMessage(request);
  });
}
