import type { SudokuHintResponse } from '../engine/hints';
import type { PuzzleRecord, SudokuDifficulty } from '../engine/types';
import type { SudokuWorkerRequest, SudokuWorkerResponse } from './sudokuWasmWorker';

export interface SudokuWasmClient {
  nextHint(board: string, solution: string): Promise<SudokuHintResponse>;
  generatePuzzle(seed: number, difficulty: SudokuDifficulty): Promise<PuzzleRecord>;
}

interface PendingCall {
  readonly resolve: (value: SudokuWorkerResponse) => void;
  readonly reject: (reason: Error) => void;
}

function createWorkerClient(): SudokuWasmClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, PendingCall>();

  function resetWorker(reason: Error) {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(reason);
    }
  }

  function ensureWorker(): Worker {
    if (worker) {
      return worker;
    }
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are unavailable in this environment.');
    }

    const created = new Worker(new URL('./sudokuWasmWorker.ts', import.meta.url), {
      type: 'module',
    });

    created.addEventListener('message', (event: MessageEvent<SudokuWorkerResponse>) => {
      const response = event.data;
      const entry = pending.get(response.id);
      if (!entry) {
        return;
      }
      pending.delete(response.id);
      entry.resolve(response);
    });

    created.addEventListener('error', (event) => {
      resetWorker(new Error(event.message || 'Sudoku WASM worker crashed.'));
    });

    worker = created;
    return created;
  }

  function sendRequest(
    buildRequest: (id: number) => SudokuWorkerRequest,
  ): Promise<SudokuWorkerResponse> {
    const id = nextId;
    nextId += 1;

    return new Promise((resolve, reject) => {
      try {
        const activeWorker = ensureWorker();
        pending.set(id, { resolve, reject });
        activeWorker.postMessage(buildRequest(id));
      } catch (err: unknown) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  return {
    async nextHint(board: string, solution: string): Promise<SudokuHintResponse> {
      const response = await sendRequest((id) => ({
        id,
        kind: 'nextHint',
        board,
        solution,
      }));
      if (!response.ok) {
        throw new Error(response.error);
      }
      if (response.kind !== 'nextHint') {
        throw new Error('Unexpected worker response kind for nextHint.');
      }
      return response.result;
    },

    async generatePuzzle(seed: number, difficulty: SudokuDifficulty): Promise<PuzzleRecord> {
      const response = await sendRequest((id) => ({
        id,
        kind: 'generatePuzzle',
        seed,
        difficulty,
      }));
      if (!response.ok) {
        throw new Error(response.error);
      }
      if (response.kind !== 'generatePuzzle') {
        throw new Error('Unexpected worker response kind for generatePuzzle.');
      }
      return response.result;
    },
  };
}

let defaultClient: SudokuWasmClient | null = null;

export function getDefaultSudokuWasmClient(): SudokuWasmClient {
  if (!defaultClient) {
    defaultClient = createWorkerClient();
  }
  return defaultClient;
}
