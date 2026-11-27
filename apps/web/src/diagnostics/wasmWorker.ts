import type { WasmWorkerRequest, WasmWorkerResponse } from './wasmBenchmark';

interface GoWasmRuntime {
  readonly importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface HearthsideSudokuWasmApi {
  nextHint(boardJson: string): string;
  countSolutions(boardJson: string): string;
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

async function executeBenchmark(request: WasmWorkerRequest): Promise<WasmWorkerResponse> {
  const startTime = performance.now();
  const origin = workerScope.location.origin;
  const glueHref = new URL(request.glueUrl, origin).href;
  const wasmHref = new URL(request.wasmUrl, origin).href;

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

  const coldStartMs = performance.now() - startTime;
  const boardJson = JSON.stringify({ puzzle: request.puzzle });

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

  const parsedHint = JSON.parse(lastHintRaw) as {
    ok?: boolean;
    hint?: { found?: boolean; technique?: string };
    error?: string;
  };
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

  return {
    ok: true,
    engineVersion: api.version(),
    coldStartMs,
    hintSamplesMs,
    countSamplesMs,
    hintFound: Boolean(parsedHint.hint?.found),
    hintTechnique: parsedHint.hint?.technique ?? 'none',
    solutionCount: parsedCount.solutions ?? 0,
  };
}

workerScope.addEventListener('message', (event) => {
  void executeBenchmark(event.data)
    .then((result) => {
      workerScope.postMessage(result);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'WASM benchmark failed.';
      workerScope.postMessage({ ok: false, error: message });
    });
});
