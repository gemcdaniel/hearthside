//go:build js && wasm

// Command wasm exposes the Hearthside Sudoku engine to JavaScript via syscall/js.
package main

import (
	"syscall/js"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
)

const missingArgJSON = `{"ok":false,"error":"missing requestJson argument"}`

func wrapJSONCall(fn func(string) string) js.Func {
	return js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 1 {
			return missingArgJSON
		}
		return fn(args[0].String())
	})
}

func versionJS(_ js.Value, _ []js.Value) any {
	return sudoku.Version()
}

func main() {
	api := js.Global().Get("Object").New()
	api.Set("nextHint", wrapJSONCall(sudoku.NextHintJSON))
	api.Set("generatePuzzle", wrapJSONCall(sudoku.GeneratePuzzleJSON))
	api.Set("gradePuzzle", wrapJSONCall(sudoku.GradePuzzleJSON))
	api.Set("countSolutions", wrapJSONCall(sudoku.CountSolutionsJSON))
	api.Set("nextStep", wrapJSONCall(sudoku.NextStepJSON))
	api.Set("version", js.FuncOf(versionJS))
	js.Global().Set("hearthsideSudoku", api)

	// Keep the WASM runtime alive so exported callbacks remain callable from the Web Worker.
	select {}
}
