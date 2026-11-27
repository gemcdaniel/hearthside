#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENGINE_DIR="$REPO_ROOT/engine/sudoku"
OUT_DIR="$REPO_ROOT/apps/web/public/wasm"

mkdir -p "$OUT_DIR"

byte_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

gzip_size() {
  gzip -9 -c "$1" | wc -c | tr -d '[:space:]'
}

GO_ROOT=$(go env GOROOT)
if [ -f "$GO_ROOT/lib/wasm/wasm_exec.js" ]; then
  GO_WASM_EXEC="$GO_ROOT/lib/wasm/wasm_exec.js"
elif [ -f "$GO_ROOT/misc/wasm/wasm_exec.js" ]; then
  GO_WASM_EXEC="$GO_ROOT/misc/wasm/wasm_exec.js"
else
  echo "error: could not locate wasm_exec.js under GOROOT=$GO_ROOT" >&2
  exit 1
fi

echo "Building Standard Go WASM..."
(
  cd "$ENGINE_DIR"
  GOWORK=off GOOS=js GOARCH=wasm go build -ldflags="-s -w" -trimpath -o "$OUT_DIR/sudoku-go.wasm" ./cmd/wasm
)
cp "$GO_WASM_EXEC" "$OUT_DIR/wasm_exec-go.js"

GO_WASM_BYTES=$(byte_size "$OUT_DIR/sudoku-go.wasm")
GO_WASM_GZIP=$(gzip_size "$OUT_DIR/sudoku-go.wasm")
GO_GLUE_BYTES=$(byte_size "$OUT_DIR/wasm_exec-go.js")
GO_GLUE_GZIP=$(gzip_size "$OUT_DIR/wasm_exec-go.js")
GO_VERSION=$(go version | sed 's/"/\\"/g')
ENGINE_VERSION=$(sed -n 's/^const EngineVersion = "\(.*\)"/\1/p' "$ENGINE_DIR/engine.go" | head -n 1)
if [ -z "$ENGINE_VERSION" ]; then
  ENGINE_VERSION="unknown"
fi

HAS_TINYGO=0
TINYGO_VERSION=""
if command -v tinygo >/dev/null 2>&1; then
  echo "Building TinyGo WASM..."
  TINYGO_ROOT=$(tinygo env TINYGOROOT)
  if [ -f "$TINYGO_ROOT/targets/wasm_exec.js" ]; then
    (
      cd "$ENGINE_DIR"
      GOWORK=off tinygo build -target=wasm -opt=z -no-debug -o "$OUT_DIR/sudoku-tinygo.wasm" ./cmd/wasm
    )
    cp "$TINYGO_ROOT/targets/wasm_exec.js" "$OUT_DIR/wasm_exec-tinygo.js"
    TINYGO_WASM_BYTES=$(byte_size "$OUT_DIR/sudoku-tinygo.wasm")
    TINYGO_WASM_GZIP=$(gzip_size "$OUT_DIR/sudoku-tinygo.wasm")
    TINYGO_GLUE_BYTES=$(byte_size "$OUT_DIR/wasm_exec-tinygo.js")
    TINYGO_GLUE_GZIP=$(gzip_size "$OUT_DIR/wasm_exec-tinygo.js")
    TINYGO_VERSION=$(tinygo version | sed 's/"/\\"/g')
    HAS_TINYGO=1
  else
    echo "warning: tinygo found, but targets/wasm_exec.js missing under TINYGOROOT=$TINYGO_ROOT" >&2
    rm -f "$OUT_DIR/sudoku-tinygo.wasm" "$OUT_DIR/wasm_exec-tinygo.js"
  fi
else
  rm -f "$OUT_DIR/sudoku-tinygo.wasm" "$OUT_DIR/wasm_exec-tinygo.js"
fi

GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

{
  printf '{\n'
  printf '  "generatedAt": "%s",\n' "$GENERATED_AT"
  printf '  "engineVersion": "%s",\n' "$ENGINE_VERSION"
  printf '  "goVersion": "%s",\n' "$GO_VERSION"
  if [ "$HAS_TINYGO" -eq 1 ]; then
    printf '  "tinygoVersion": "%s",\n' "$TINYGO_VERSION"
  else
    printf '  "tinygoVersion": null,\n'
  fi
  printf '  "variants": [\n'
  printf '    {\n'
  printf '      "id": "go",\n'
  printf '      "label": "Standard Go",\n'
  printf '      "wasmUrl": "/wasm/sudoku-go.wasm",\n'
  printf '      "glueUrl": "/wasm/wasm_exec-go.js",\n'
  printf '      "wasmRawBytes": %s,\n' "$GO_WASM_BYTES"
  printf '      "wasmGzipBytes": %s,\n' "$GO_WASM_GZIP"
  printf '      "glueRawBytes": %s,\n' "$GO_GLUE_BYTES"
  printf '      "glueGzipBytes": %s\n' "$GO_GLUE_GZIP"
  if [ "$HAS_TINYGO" -eq 1 ]; then
    printf '    },\n'
    printf '    {\n'
    printf '      "id": "tinygo",\n'
    printf '      "label": "TinyGo",\n'
    printf '      "wasmUrl": "/wasm/sudoku-tinygo.wasm",\n'
    printf '      "glueUrl": "/wasm/wasm_exec-tinygo.js",\n'
    printf '      "wasmRawBytes": %s,\n' "$TINYGO_WASM_BYTES"
    printf '      "wasmGzipBytes": %s,\n' "$TINYGO_WASM_GZIP"
    printf '      "glueRawBytes": %s,\n' "$TINYGO_GLUE_BYTES"
    printf '      "glueGzipBytes": %s\n' "$TINYGO_GLUE_GZIP"
    printf '    }\n'
  else
    printf '    }\n'
  fi
  printf '  ]\n'
  printf '}\n'
} > "$OUT_DIR/manifest.json"

echo "WASM build complete:"
printf "  Standard Go: wasm raw=%s B, wasm gzip-9=%s B, glue raw=%s B, glue gzip-9=%s B\n" \
  "$GO_WASM_BYTES" "$GO_WASM_GZIP" "$GO_GLUE_BYTES" "$GO_GLUE_GZIP"
if [ "$HAS_TINYGO" -eq 1 ]; then
  printf "  TinyGo:      wasm raw=%s B, wasm gzip-9=%s B, glue raw=%s B, glue gzip-9=%s B\n" \
    "$TINYGO_WASM_BYTES" "$TINYGO_WASM_GZIP" "$TINYGO_GLUE_BYTES" "$TINYGO_GLUE_GZIP"
else
  echo "  TinyGo:      skipped (tinygo not installed on PATH)"
fi
