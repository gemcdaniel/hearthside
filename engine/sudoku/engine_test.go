package sudoku

import "testing"

func TestVersion(t *testing.T) {
	got := Version()
	if got == "" {
		t.Fatal("Version() returned empty string")
	}
	if got != EngineVersion {
		t.Fatalf("Version() = %q, want %q", got, EngineVersion)
	}
}
