import {
  countPuzzleClues,
  type HintStatus,
  type WasmBenchmarkWorkerRequest,
  type WasmGenerateBenchmarkEntry,
  type WasmGenerateBenchmarkWorkerRequest,
  type WasmGeneratePuzzleResponse,
  type WasmGradePuzzleResponse,
  type WasmNextHintResponse,
  type WasmWorkerRequest,
  type WasmWorkerResponse,
} from './wasmBenchmark';

interface GoWasmRuntime {
  readonly importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface HearthsideSudokuWasmApi {
  nextHint(requestJson: string): string;
  generatePuzzle(requestJson: string): string;
  gradePuzzle(requestJson: string): string;
  countSolutions(requestJson: string): string;
  nextStep(requestJson: string): string;
  version(): string;
}

interface WorkerGlobalLike {
  readonly location: { readonly origin: string };
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WasmWorkerRequest>) => void,
  ): void;
  postMessage(message: WasmWorkerResponse): void;
  Go?: new () => GoWasmRuntime;
  hearthsideSudoku?: HearthsideSudokuWasmApi;
}

const workerScope = globalThis as unknown as WorkerGlobalLike;

async function instantiateWasm(
  wasmHref: string,
  importObject: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  const response = await fetch(wasmHref);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM binary (${response.status} ${response.statusText}).`);
  }

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const streamingResult = await WebAssembly.instantiateStreaming(
        Promise.resolve(response.clone()),
        importObject,
      );
      return streamingResult.instance;
    } catch {
      // Fallback when MIME type is not application/wasm (e.g. certain dev servers).
    }
  }

  const buffer = await response.arrayBuffer();
  const instantiated = await WebAssembly.instantiate(buffer, importObject);
  return instantiated.instance;
}

async function waitForApi(timeoutMs = 5000): Promise<HearthsideSudokuWasmApi> {
  const deadline = performance.now() + timeoutMs;
  while (!workerScope.hearthsideSudoku && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  if (!workerScope.hearthsideSudoku) {
    throw new Error('Timed out waiting for hearthsideSudoku WASM exports.');
  }
  return workerScope.hearthsideSudoku;
}

async function loadWasmApi(
  wasmUrl: string,
  glueUrl: string,
): Promise<{ api: HearthsideSudokuWasmApi; coldStartMs: number }> {
  const startTime = performance.now();
  const origin = workerScope.location.origin;
  const glueHref = new URL(glueUrl, origin).href;
  const wasmHref = new URL(wasmUrl, origin).href;

  await import(/* @vite-ignore */ glueHref);
  if (typeof workerScope.Go !== 'function') {
    throw new Error('WASM glue did not register globalThis.Go.');
  }

  const go = new workerScope.Go();
  const instance = await instantiateWasm(wasmHref, go.importObject);

  let runtimeError: Error | null = null;
  void go.run(instance).catch((err: unknown) => {
    runtimeError = err instanceof Error ? err : new Error(String(err));
  });

  const api = await waitForApi();
  if (runtimeError !== null) {
    throw runtimeError;
  }

  return {
    api,
    coldStartMs: performance.now() - startTime,
  };
}

async function executeBenchmark(request: WasmBenchmarkWorkerRequest): Promise<WasmWorkerResponse> {
  const { api, coldStartMs } = await loadWasmApi(request.wasmUrl, request.glueUrl);
  const boardJson = JSON.stringify({ board: request.puzzle });

  const hintSamplesMs: number[] = [];
  let lastHintRaw = '';
  for (let i = 0; i < request.iterations; i += 1) {
    const t0 = performance.now();
    lastHintRaw = api.nextHint(boardJson);
    hintSamplesMs.push(performance.now() - t0);
  }

  const countSamplesMs: number[] = [];
  let lastCountRaw = '';
  for (let i = 0; i < request.iterations; i += 1) {
    const t0 = performance.now();
    lastCountRaw = api.countSolutions(boardJson);
    countSamplesMs.push(performance.now() - t0);
  }

  const parsedHint = JSON.parse(lastHintRaw) as WasmNextHintResponse;
  if (!parsedHint.ok) {
    throw new Error(parsedHint.error ?? 'WASM nextHint failed.');
  }

  const parsedCount = JSON.parse(lastCountRaw) as {
    ok?: boolean;
    solutions?: number;
    error?: string;
  };
  if (!parsedCount.ok) {
    throw new Error(parsedCount.error ?? 'WASM countSolutions failed.');
  }

  const hintStatus: HintStatus = parsedHint.status ?? 'no_logical_step';
  const hintFound = hintStatus === 'ok' && Boolean(parsedHint.step);
  const hintTechnique = parsedHint.step?.technique ?? 'none';

  return {
    ok: true,
    kind: 'benchmark',
    engineVersion: api.version(),
    coldStartMs,
    hintSamplesMs,
    countSamplesMs,
    hintStatus,
    hintFound,
    hintTechnique,
    solutionCount: parsedCount.solutions ?? 0,
  };
}

async function executeGenerateBenchmark(
  request: WasmGenerateBenchmarkWorkerRequest,
): Promise<WasmWorkerResponse> {
  const { api, coldStartMs } = await loadWasmApi(request.wasmUrl, request.glueUrl);
  const entries: WasmGenerateBenchmarkEntry[] = [];

  for (const difficulty of request.difficulties) {
    const genStart = performance.now();
    const genRaw = api.generatePuzzle(JSON.stringify({ seed: request.seed, difficulty }));
    const generateMs = performance.now() - genStart;

    const parsedGen = JSON.parse(genRaw) as WasmGeneratePuzzleResponse;
    if (!parsedGen.ok || !parsedGen.puzzle) {
      throw new Error(parsedGen.error ?? `WASM generatePuzzle(${difficulty}) failed.`);
    }

    const gradeStart = performance.now();
    const gradeRaw = api.gradePuzzle(JSON.stringify({ clues: parsedGen.puzzle.clues }));
    const gradeMs = performance.now() - gradeStart;

    const parsedGrade = JSON.parse(gradeRaw) as WasmGradePuzzleResponse;
    if (!parsedGrade.ok || !parsedGrade.grade) {
      throw new Error(parsedGrade.error ?? `WASM gradePuzzle(${difficulty}) failed.`);
    }

    entries.push({
      difficulty,
      puzzleId: parsedGen.puzzle.id,
      clueCount: countPuzzleClues(parsedGen.puzzle.clues),
      generateMs,
      gradeMs,
      gradedDifficulty: parsedGrade.grade.difficulty,
      gradeMatched: parsedGrade.grade.difficulty === difficulty,
      techniquesRequired: parsedGrade.grade.techniquesRequired,
    });
  }

  return {
    ok: true,
    kind: 'generateBenchmark',
    engineVersion: api.version(),
    coldStartMs,
    seed: request.seed,
    entries,
  };
}

async function handleWorkerRequest(request: WasmWorkerRequest): Promise<WasmWorkerResponse> {
  if (request.kind === 'generateBenchmark') {
    return executeGenerateBenchmark(request);
  }
  return executeBenchmark(request);
}

workerScope.addEventListener('message', (event) => {
  void handleWorkerRequest(event.data)
    .then((result) => {
      workerScope.postMessage(result);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'WASM benchmark failed.';
      workerScope.postMessage({ ok: false, error: message });
    });
});
