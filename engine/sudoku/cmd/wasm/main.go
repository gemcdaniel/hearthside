//go:build js && wasm

// Command wasm exposes the Hearthside Sudoku engine to JavaScript via syscall/js.
package main

import (
	"syscall/js"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
)

func nextHintJS(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return `{"ok":false,"error":"missing boardJson argument"}`
	}
	return sudoku.NextHintJSON(args[0].String())
}

func countSolutionsJS(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return `{"ok":false,"error":"missing boardJson argument"}`
	}
	return sudoku.CountSolutionsJSON(args[0].String())
}

func versionJS(_ js.Value, _ []js.Value) any {
	return sudoku.Version()
}

func main() {
	api := js.Global().Get("Object").New()
	api.Set("nextHint", js.FuncOf(nextHintJS))
	api.Set("countSolutions", js.FuncOf(countSolutionsJS))
	api.Set("version", js.FuncOf(versionJS))
	js.Global().Set("hearthsideSudoku", api)

	// Keep the WASM runtime alive so exported callbacks remain callable from the Web Worker.
	select {}
}
