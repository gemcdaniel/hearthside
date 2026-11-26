// Package sudoku provides a pure standard-library Sudoku solver, generator, and grader.
package sudoku

// EngineVersion identifies the Sudoku engine build version for deterministic puzzle generation.
const EngineVersion = "0.1.0-dev"

// Version returns the current Sudoku engine version.
func Version() string {
	return EngineVersion
}
