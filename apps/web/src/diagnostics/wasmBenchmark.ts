export const WASM_MAX_GZIP_BYTES = 2 * 1024 * 1024;
export const WASM_MAX_STARTUP_MS = 1000;
export const WASM_MAX_HINT_MS = 200;
export const DEFAULT_BENCHMARK_ITERATIONS = 10;
export const DEFAULT_GENERATE_SEED = 1;

export const HARD_BENCHMARK_PUZZLE =
  '000000907000420180000705026100904000050000040000507009920108000034059000507000000';

export type SudokuDifficulty = 'easy' | 'medium' | 'hard';

export const ALL_DIFFICULTIES: readonly SudokuDifficulty[] = ['easy', 'medium', 'hard'];

export type HintStatus =
  'ok' | 'conflict' | 'wrong_entry' | 'unsolvable' | 'solved' | 'no_logical_step';

export interface WasmRegion {
  readonly kind: 'cell' | 'row' | 'column' | 'box';
  readonly index: number;
}

export interface WasmPlacement {
  readonly cell: number;
  readonly digit: number;
}

export interface WasmElimination {
  readonly cell: number;
  readonly digit: number;
}

export interface WasmStep {
  readonly technique: string;
  readonly difficulty: SudokuDifficulty;
  readonly region: WasmRegion;
  readonly drivingCells: readonly number[];
  readonly placements: readonly WasmPlacement[];
  readonly eliminations: readonly WasmElimination[];
}

export interface WasmNextHintResponse {
  readonly ok: boolean;
  readonly engineVersion: string;
  readonly status?: HintStatus;
  readonly conflictCells?: readonly number[];
  readonly wrongCells?: readonly number[];
  readonly step?: WasmStep;
  readonly error?: string;
}

export interface WasmPuzzleRecord {
  readonly id: string;
  readonly seed: number;
  readonly engineVersion: string;
  readonly difficulty: SudokuDifficulty;
  readonly techniquesRequired: readonly string[];
  readonly clues: string;
  readonly solution: string;
}

export interface WasmGeneratePuzzleResponse {
  readonly ok: boolean;
  readonly engineVersion: string;
  readonly puzzle?: WasmPuzzleRecord;
  readonly error?: string;
}

export interface WasmGradeResult {
  readonly difficulty: SudokuDifficulty;
  readonly techniquesRequired: readonly string[];
  readonly stepCount: number;
  readonly steps?: readonly WasmStep[];
}

export interface WasmGradePuzzleResponse {
  readonly ok: boolean;
  readonly engineVersion: string;
  readonly grade?: WasmGradeResult;
  readonly error?: string;
}

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

export interface WasmBenchmarkWorkerRequest {
  readonly kind: 'benchmark';
  readonly variantId: 'go' | 'tinygo';
  readonly wasmUrl: string;
  readonly glueUrl: string;
  readonly puzzle: string;
  readonly iterations: number;
}

export interface WasmGenerateBenchmarkWorkerRequest {
  readonly kind: 'generateBenchmark';
  readonly variantId: 'go' | 'tinygo';
  readonly wasmUrl: string;
  readonly glueUrl: string;
  readonly seed: number;
  readonly difficulties: readonly SudokuDifficulty[];
}

export type WasmWorkerRequest = WasmBenchmarkWorkerRequest | WasmGenerateBenchmarkWorkerRequest;

export interface WasmWorkerBenchmarkSuccess {
  readonly ok: true;
  readonly kind: 'benchmark';
  readonly engineVersion: string;
  readonly coldStartMs: number;
  readonly hintSamplesMs: readonly number[];
  readonly countSamplesMs: readonly number[];
  readonly hintStatus: HintStatus;
  readonly hintFound: boolean;
  readonly hintTechnique: string;
  readonly solutionCount: number;
}

export interface WasmGenerateBenchmarkEntry {
  readonly difficulty: SudokuDifficulty;
  readonly puzzleId: string;
  readonly clueCount: number;
  readonly generateMs: number;
  readonly gradeMs: number;
  readonly gradedDifficulty: SudokuDifficulty;
  readonly gradeMatched: boolean;
  readonly techniquesRequired: readonly string[];
}

export interface WasmWorkerGenerateSuccess {
  readonly ok: true;
  readonly kind: 'generateBenchmark';
  readonly engineVersion: string;
  readonly coldStartMs: number;
  readonly seed: number;
  readonly entries: readonly WasmGenerateBenchmarkEntry[];
}

export interface WasmWorkerFailure {
  readonly ok: false;
  readonly error: string;
}

export type WasmWorkerResponse =
  WasmWorkerBenchmarkSuccess | WasmWorkerGenerateSuccess | WasmWorkerFailure;

export interface WasmBenchmarkResult {
  readonly variant: WasmVariantInfo;
  readonly engineVersion: string;
  readonly iterations: number;
  readonly coldStartMs: number;
  readonly hintStats: TimingStats;
  readonly countStats: TimingStats;
  readonly hintStatus: HintStatus;
  readonly hintFound: boolean;
  readonly hintTechnique: string;
  readonly solutionCount: number;
  readonly budgets: WasmBudgetCheck;
}

export interface WasmGenerateBenchmarkResult {
  readonly variant: WasmVariantInfo;
  readonly engineVersion: string;
  readonly coldStartMs: number;
  readonly seed: number;
  readonly entries: readonly WasmGenerateBenchmarkEntry[];
}

export function countPuzzleClues(clues: string): number {
  let count = 0;
  for (let i = 0; i < clues.length; i += 1) {
    const ch = clues.charAt(i);
    if (ch >= '1' && ch <= '9') {
      count += 1;
    }
  }
  return count;
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

function postWorkerRequest(request: WasmWorkerRequest): Promise<WasmWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./wasmWorker.ts', import.meta.url), { type: 'module' });

    const cleanup = () => {
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<WasmWorkerResponse>) => {
      cleanup();
      if (!event.data.ok) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data);
    });

    worker.addEventListener('error', (event) => {
      cleanup();
      reject(new Error(event.message || 'WASM benchmark worker crashed.'));
    });

    worker.postMessage(request);
  });
}

export async function runWasmBenchmark(
  variant: WasmVariantInfo,
  iterations = DEFAULT_BENCHMARK_ITERATIONS,
): Promise<WasmBenchmarkResult> {
  const response = await postWorkerRequest({
    kind: 'benchmark',
    variantId: variant.id,
    wasmUrl: variant.wasmUrl,
    glueUrl: variant.glueUrl,
    puzzle: HARD_BENCHMARK_PUZZLE,
    iterations,
  });

  if (!response.ok || response.kind !== 'benchmark') {
    throw new Error('Unexpected WASM worker response for benchmark.');
  }

  const hintStats = computeTimingStats(response.hintSamplesMs);
  const countStats = computeTimingStats(response.countSamplesMs);
  const budgets = evaluateWasmBudgets(variant.wasmGzipBytes, response.coldStartMs, hintStats.p95Ms);
  return {
    variant,
    engineVersion: response.engineVersion,
    iterations,
    coldStartMs: response.coldStartMs,
    hintStats,
    countStats,
    hintStatus: response.hintStatus,
    hintFound: response.hintFound,
    hintTechnique: response.hintTechnique,
    solutionCount: response.solutionCount,
    budgets,
  };
}

export async function runWasmGenerateBenchmark(
  variant: WasmVariantInfo,
  seed = DEFAULT_GENERATE_SEED,
): Promise<WasmGenerateBenchmarkResult> {
  const response = await postWorkerRequest({
    kind: 'generateBenchmark',
    variantId: variant.id,
    wasmUrl: variant.wasmUrl,
    glueUrl: variant.glueUrl,
    seed,
    difficulties: ALL_DIFFICULTIES,
  });

  if (!response.ok || response.kind !== 'generateBenchmark') {
    throw new Error('Unexpected WASM worker response for generateBenchmark.');
  }

  return {
    variant,
    engineVersion: response.engineVersion,
    coldStartMs: response.coldStartMs,
    seed: response.seed,
    entries: response.entries,
  };
}
