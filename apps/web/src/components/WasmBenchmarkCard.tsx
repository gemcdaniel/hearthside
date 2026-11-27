import { useEffect, useState } from 'react';
import {
  DEFAULT_BENCHMARK_ITERATIONS,
  DEFAULT_GENERATE_SEED,
  WASM_MAX_GZIP_BYTES,
  WASM_MAX_HINT_MS,
  WASM_MAX_STARTUP_MS,
  formatBenchmarkMarkdownRow,
  formatBytes,
  formatMs,
  loadWasmManifest,
  runWasmBenchmark,
  runWasmGenerateBenchmark,
  type WasmBenchmarkResult,
  type WasmGenerateBenchmarkResult,
  type WasmManifest,
} from '../diagnostics/wasmBenchmark';

export function WasmBenchmarkCard() {
  const [manifest, setManifest] = useState<WasmManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<'go' | 'tinygo'>('go');
  const [runningMode, setRunningMode] = useState<'idle' | 'benchmark' | 'generate'>('idle');
  const [result, setResult] = useState<WasmBenchmarkResult | null>(null);
  const [generateResult, setGenerateResult] = useState<WasmGenerateBenchmarkResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const running = runningMode !== 'idle';

  useEffect(() => {
    let active = true;
    void loadWasmManifest()
      .then((loaded) => {
        if (!active) {
          return;
        }
        if (!loaded) {
          setManifestError('WASM manifest missing. Run `bun run build:wasm` to build artifacts.');
          return;
        }
        setManifest(loaded);
        const firstVariant = loaded.variants[0];
        if (firstVariant) {
          setSelectedId(firstVariant.id);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setManifestError(
            err instanceof Error ? err.message : 'Unable to load /wasm/manifest.json.',
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedVariant =
    manifest?.variants.find((v) => v.id === selectedId) ?? manifest?.variants[0] ?? null;

  async function handleRunBenchmark() {
    if (!selectedVariant) {
      return;
    }
    setRunningMode('benchmark');
    setRunError(null);
    setCopyStatus(null);
    try {
      const benchmark = await runWasmBenchmark(selectedVariant, DEFAULT_BENCHMARK_ITERATIONS);
      setResult(benchmark);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'WASM benchmark failed.');
    } finally {
      setRunningMode('idle');
    }
  }

  async function handleRunGenerateBenchmark() {
    if (!selectedVariant) {
      return;
    }
    setRunningMode('generate');
    setRunError(null);
    try {
      const generated = await runWasmGenerateBenchmark(selectedVariant, DEFAULT_GENERATE_SEED);
      setGenerateResult(generated);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'WASM generatePuzzle benchmark failed.');
    } finally {
      setRunningMode('idle');
    }
  }

  const markdownRow =
    result !== null
      ? formatBenchmarkMarkdownRow(
          result,
          typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        )
      : null;

  async function handleCopyMarkdown() {
    if (!markdownRow) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setCopyStatus('Clipboard unavailable — copy from the preview box below.');
      return;
    }
    try {
      await navigator.clipboard.writeText(markdownRow);
      setCopyStatus('Copied Markdown table row to clipboard.');
    } catch {
      setCopyStatus('Clipboard blocked — copy from the preview box below.');
    }
  }

  return (
    <div className="hs-diag-card">
      <div className="hs-diag-row">
        <span className="hs-diag-label">WASM Engine Benchmark</span>
        <div className="hs-btn-group">
          {manifest ? (
            <label className="hs-select-label">
              <span className="hs-sr-only">WASM build variant</span>
              <select
                className="hs-select"
                aria-label="WASM build variant"
                value={selectedVariant?.id ?? 'go'}
                disabled={running}
                onChange={(event) => {
                  const val = event.target.value;
                  if (val === 'go' || val === 'tinygo') {
                    setSelectedId(val);
                  }
                }}
              >
                {manifest.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="hs-btn hs-btn-primary"
            disabled={running || !selectedVariant}
            onClick={() => void handleRunBenchmark()}
          >
            {runningMode === 'benchmark' ? 'Running...' : 'Run Benchmark'}
          </button>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            disabled={running || !selectedVariant}
            onClick={() => void handleRunGenerateBenchmark()}
          >
            {runningMode === 'generate' ? 'Generating...' : 'Benchmark Generate (E/M/H)'}
          </button>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            disabled={!markdownRow}
            onClick={() => void handleCopyMarkdown()}
          >
            Copy Markdown Row
          </button>
        </div>
      </div>

      {manifestError ? <p className="hs-diag-output">{manifestError}</p> : null}

      {selectedVariant ? (
        <p className="hs-diag-output">
          Artifact ({selectedVariant.label}): WASM raw {formatBytes(selectedVariant.wasmRawBytes)},
          gzip-9 {formatBytes(selectedVariant.wasmGzipBytes)} | glue raw{' '}
          {formatBytes(selectedVariant.glueRawBytes)}, gzip-9{' '}
          {formatBytes(selectedVariant.glueGzipBytes)}
        </p>
      ) : null}

      {runError ? <p className="hs-diag-output">Error: {runError}</p> : null}

      {result ? (
        <div className="hs-benchmark-results" aria-live="polite">
          <div className="hs-diag-row">
            <span className="hs-diag-output">
              Gzip-9 size ({formatBytes(result.variant.wasmGzipBytes)} /{' '}
              {formatBytes(WASM_MAX_GZIP_BYTES)} budget)
            </span>
            <span className="hs-badge" data-tone={result.budgets.gzipPass ? 'success' : 'error'}>
              {result.budgets.gzipPass ? 'Pass' : 'Fail'}
            </span>
          </div>
          <div className="hs-diag-row">
            <span className="hs-diag-output">
              Cold start ({formatMs(result.coldStartMs)} / &lt; {WASM_MAX_STARTUP_MS} ms)
            </span>
            <span className="hs-badge" data-tone={result.budgets.startupPass ? 'success' : 'error'}>
              {result.budgets.startupPass ? 'Pass' : 'Fail'}
            </span>
          </div>
          <div className="hs-diag-row">
            <span className="hs-diag-output">
              nextHint ({result.iterations}x): median {formatMs(result.hintStats.medianMs)}, p95{' '}
              {formatMs(result.hintStats.p95Ms)} (&lt; {WASM_MAX_HINT_MS} ms, status=
              {result.hintStatus}, technique={result.hintTechnique})
            </span>
            <span className="hs-badge" data-tone={result.budgets.hintPass ? 'success' : 'error'}>
              {result.budgets.hintPass ? 'Pass' : 'Fail'}
            </span>
          </div>
          <div className="hs-diag-row">
            <span className="hs-diag-output">
              countSolutions ({result.iterations}x): median {formatMs(result.countStats.medianMs)},
              p95 {formatMs(result.countStats.p95Ms)} (solutions={result.solutionCount}, engine=
              {result.engineVersion})
            </span>
            <span className="hs-badge" data-tone={result.budgets.allPassed ? 'success' : 'error'}>
              {result.budgets.allPassed ? 'All Budgets Passed' : 'Budget Exceeded'}
            </span>
          </div>
        </div>
      ) : null}

      {generateResult ? (
        <div className="hs-benchmark-results" aria-live="polite">
          <p className="hs-diag-output">
            generatePuzzle (seed={generateResult.seed}): cold start{' '}
            {formatMs(generateResult.coldStartMs)} (engine={generateResult.engineVersion})
          </p>
          {generateResult.entries.map((entry) => (
            <div className="hs-diag-row" key={entry.difficulty}>
              <span className="hs-diag-output">
                {entry.difficulty}: gen {formatMs(entry.generateMs)}, grade{' '}
                {formatMs(entry.gradeMs)}, {entry.clueCount} clues ({entry.puzzleId}) [
                {entry.techniquesRequired.join(', ')}]
              </span>
              <span className="hs-badge" data-tone={entry.gradeMatched ? 'success' : 'error'}>
                {entry.gradeMatched ? 'Verified' : 'Mismatch'}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {copyStatus ? <p className="hs-diag-output">{copyStatus}</p> : null}

      {markdownRow ? (
        <textarea
          className="hs-markdown-preview"
          readOnly
          rows={2}
          aria-label="Benchmark Markdown row"
          value={markdownRow}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}
