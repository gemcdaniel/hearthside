// Package health reports API and engine readiness.
package health

import "github.com/gemcdaniel/hearthside/engine/sudoku"

// Status describes the health check response for the API service.
type Status struct {
	Status        string
	EngineVersion string
}

// Check returns the current health status including the Sudoku engine version.
func Check() Status {
	return Status{
		Status:        "ok",
		EngineVersion: sudoku.Version(),
	}
}
