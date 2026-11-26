package health

import (
	"testing"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
)

func TestCheck(t *testing.T) {
	got := Check()
	if got.Status != "ok" {
		t.Fatalf("Status = %q, want %q", got.Status, "ok")
	}
	if got.EngineVersion != sudoku.Version() {
		t.Fatalf("EngineVersion = %q, want %q", got.EngineVersion, sudoku.Version())
	}
}
