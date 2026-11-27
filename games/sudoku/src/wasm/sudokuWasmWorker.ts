import type { SudokuHintResponse } from '../engine/hints';
import type { PuzzleRecord, SudokuDifficulty } from '../engine/types';

interface GoWasmRuntime {
  readonly importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface HearthsideSudokuWasmApi {
  nextHint(requestJson: string): string;
  generatePuzzle(requestJson: string): string;
}

export type SudokuWorkerRequest =
  | {
      readonly id: number;
      readonly kind: 'nextHint';
      readonly board: string;
      readonly solution: string;
    }
  | {
      readonly id: number;
      readonly kind: 'generatePuzzle';
      readonly seed: number;
      readonly difficulty: SudokuDifficulty;
    };

export type SudokuWorkerResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: 'nextHint';
      readonly result: SudokuHintResponse;
    }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: 'generatePuzzle';
      readonly result: PuzzleRecord;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };

interface WorkerGlobalLike {
  readonly location: { readonly origin: string };
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<SudokuWorkerRequest>) => void,
  ): void;
  postMessage(message: SudokuWorkerResponse): void;
  Go?: new () => GoWasmRuntime;
  hearthsideSudoku?: HearthsideSudokuWasmApi;
}

const workerScope = globalThis as unknown as WorkerGlobalLike;
const WASM_URL = '/wasm/sudoku-go.wasm';
const GLUE_URL = '/wasm/wasm_exec-go.js';

let cachedApiPromise: Promise<HearthsideSudokuWasmApi> | null = null;

async function instantiateWasm(
  wasmHref: string,
  importObject: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  const response = await fetch(wasmHref);
  if (!response.ok) {
    throw new Error(`Failed to fetch Sudoku WASM (${response.status} ${response.statusText}).`);
  }

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const streamingResult = await WebAssembly.instantiateStreaming(
        Promise.resolve(response.clone()),
        importObject,
      );
      return streamingResult.instance;
    } catch {
      // Fallback when server does not send application/wasm.
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

async function getSudokuApi(): Promise<HearthsideSudokuWasmApi> {
  if (cachedApiPromise) {
    return cachedApiPromise;
  }

  cachedApiPromise = (async () => {
    const origin = workerScope.location.origin;
    const glueHref = new URL(GLUE_URL, origin).href;
    const wasmHref = new URL(WASM_URL, origin).href;

    if (typeof workerScope.Go !== 'function') {
      await import(/* @vite-ignore */ glueHref);
    }
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
    return api;
  })().catch((err: unknown) => {
    cachedApiPromise = null;
    throw err;
  });

  return cachedApiPromise;
}

interface GeneratePuzzleWasmResponse {
  readonly ok: boolean;
  readonly puzzle?: PuzzleRecord;
  readonly error?: string;
}

async function handleRequest(request: SudokuWorkerRequest): Promise<SudokuWorkerResponse> {
  const api = await getSudokuApi();

  if (request.kind === 'nextHint') {
    const raw = api.nextHint(
      JSON.stringify({
        board: request.board,
        solution: request.solution,
      }),
    );
    const parsed = JSON.parse(raw) as SudokuHintResponse;
    return {
      id: request.id,
      ok: true,
      kind: 'nextHint',
      result: parsed,
    };
  }

  const raw = api.generatePuzzle(
    JSON.stringify({
      seed: request.seed,
      difficulty: request.difficulty,
    }),
  );
  const parsed = JSON.parse(raw) as GeneratePuzzleWasmResponse;
  if (!parsed.ok || !parsed.puzzle) {
    throw new Error(parsed.error ?? 'WASM generatePuzzle failed.');
  }

  return {
    id: request.id,
    ok: true,
    kind: 'generatePuzzle',
    result: parsed.puzzle,
  };
}

workerScope.addEventListener('message', (event) => {
  const request = event.data;
  void handleRequest(request)
    .then((response) => {
      workerScope.postMessage(response);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Sudoku WASM worker error.';
      workerScope.postMessage({
        id: request.id,
        ok: false,
        error: message,
      });
    });
});
