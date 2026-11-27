package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
)

func TestGenbankDeterministicGenerateAndVerify(t *testing.T) {
	dir := t.TempDir()
	outA := filepath.Join(dir, "bank-a.json")
	outB := filepath.Join(dir, "bank-b.json")

	var stdoutA, stderrA bytes.Buffer
	if err := run([]string{
		"-easy", "2",
		"-medium", "2",
		"-hard", "2",
		"-seed-start", "10",
		"-out", outA,
	}, &stdoutA, &stderrA); err != nil {
		t.Fatalf("first genbank run failed: %v (stderr=%s)", err, stderrA.String())
	}

	var stdoutB, stderrB bytes.Buffer
	if err := run([]string{
		"-easy", "2",
		"-medium", "2",
		"-hard", "2",
		"-seed-start", "10",
		"-out", outB,
	}, &stdoutB, &stderrB); err != nil {
		t.Fatalf("second genbank run failed: %v (stderr=%s)", err, stderrB.String())
	}

	rawA, err := os.ReadFile(outA)
	if err != nil {
		t.Fatalf("read outA: %v", err)
	}
	rawB, err := os.ReadFile(outB)
	if err != nil {
		t.Fatalf("read outB: %v", err)
	}
	if !bytes.Equal(rawA, rawB) {
		t.Fatal("genbank produced non-deterministic JSON across identical runs")
	}

	var bank PuzzleBank
	if err := json.Unmarshal(rawA, &bank); err != nil {
		t.Fatalf("unmarshal generated bank: %v", err)
	}
	if bank.SchemaVersion != BankSchemaVersion {
		t.Fatalf("schemaVersion = %d, want %d", bank.SchemaVersion, BankSchemaVersion)
	}
	if bank.Counts != (BankCounts{Easy: 2, Medium: 2, Hard: 2}) {
		t.Fatalf("unexpected counts: %+v", bank.Counts)
	}
	if len(bank.Puzzles) != 6 {
		t.Fatalf("len(puzzles) = %d, want 6", len(bank.Puzzles))
	}

	summary := stdoutA.String()
	for _, needle := range []string{"Clue Counts by Difficulty:", "Technique Frequency Distribution", "Min", "Avg", "Max"} {
		if !strings.Contains(summary, needle) {
			t.Fatalf("expected summary stdout to contain %q, got:\n%s", needle, summary)
		}
	}

	var verifyOut, verifyErr bytes.Buffer
	if err := run([]string{"-verify", outA}, &verifyOut, &verifyErr); err != nil {
		t.Fatalf("verify generated bank failed: %v", err)
	}
	if !strings.Contains(verifyOut.String(), "Verified puzzle bank:") {
		t.Fatalf("unexpected verify output:\n%s", verifyOut.String())
	}
}

func TestGenbankVerifyErrorDetection(t *testing.T) {
	dir := t.TempDir()
	validPath := filepath.Join(dir, "valid.json")

	var outBuf, errBuf bytes.Buffer
	if err := run([]string{
		"-easy", "1",
		"-medium", "1",
		"-hard", "0",
		"-seed-start", "1",
		"-out", validPath,
	}, &outBuf, &errBuf); err != nil {
		t.Fatalf("seed bank generation failed: %v", err)
	}

	raw, err := os.ReadFile(validPath)
	if err != nil {
		t.Fatalf("read valid bank: %v", err)
	}
	var base PuzzleBank
	if err := json.Unmarshal(raw, &base); err != nil {
		t.Fatalf("unmarshal valid bank: %v", err)
	}

	writeTempBank := func(name string, b PuzzleBank) string {
		t.Helper()
		p := filepath.Join(dir, name)
		data, marshalErr := json.MarshalIndent(b, "", "  ")
		if marshalErr != nil {
			t.Fatalf("marshal %s: %v", name, marshalErr)
		}
		if writeErr := os.WriteFile(p, data, 0o644); writeErr != nil {
			t.Fatalf("write %s: %v", name, writeErr)
		}
		return p
	}

	cloneBank := func() PuzzleBank {
		c := base
		c.Puzzles = slicesCopy(base.Puzzles)
		return c
	}

	t.Run("tampered solution", func(t *testing.T) {
		b := cloneBank()
		sol := []byte(b.Puzzles[0].Solution)
		if sol[0] == '1' {
			sol[0] = '2'
		} else {
			sol[0] = '1'
		}
		b.Puzzles[0].Solution = string(sol)
		p := writeTempBank("bad-sol.json", b)
		if err := run([]string{"-verify", p}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatal("expected verify failure for tampered solution")
		}
	})

	t.Run("mismatched difficulty label", func(t *testing.T) {
		b := cloneBank()
		b.Puzzles[0].Difficulty = sudoku.DifficultyHard
		p := writeTempBank("bad-diff.json", b)
		if err := run([]string{"-verify", p}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatal("expected verify failure for mismatched difficulty")
		}
	})

	t.Run("multiple solutions", func(t *testing.T) {
		b := cloneBank()
		// Replace clues with nearly empty board having multiple solutions.
		b.Puzzles[0].Clues = "5" + strings.Repeat("0", 80)
		p := writeTempBank("non-unique.json", b)
		if err := run([]string{"-verify", p}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatal("expected verify failure for multiple solutions")
		}
	})

	t.Run("requires guessing extreme puzzle", func(t *testing.T) {
		extreme := "800000000003600000070090200050007000000045700000100030001000068008500010090000400"
		board, parseErr := sudoku.ParseBoardString(extreme)
		if parseErr != nil {
			t.Fatalf("ParseBoardString failed: %v", parseErr)
		}
		sol, ok, solveErr := board.SolveBacktrack()
		if solveErr != nil || !ok {
			t.Fatalf("SolveBacktrack failed: %v", solveErr)
		}
		b := cloneBank()
		b.Puzzles[0].Clues = extreme
		b.Puzzles[0].Solution = sol.String()
		b.Puzzles[0].Difficulty = sudoku.DifficultyHard
		p := writeTempBank("guessing.json", b)
		if err := run([]string{"-verify", p}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatal("expected verify failure for guessing-required puzzle")
		}
	})

	t.Run("mismatched counts metadata", func(t *testing.T) {
		b := cloneBank()
		b.Counts.Easy = 99
		p := writeTempBank("bad-counts.json", b)
		if err := run([]string{"-verify", p}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatal("expected verify failure for mismatched counts metadata")
		}
	})

	t.Run("duplicate puzzle id", func(t *testing.T) {
		b := cloneBank()
		b.Puzzles[1].ID = b.Puzzles[0].ID
		p := writeTempBank("dup-id.json", b)
		if err := run([]string{"-verify", p}, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatal("expected verify failure for duplicate puzzle id")
		}
	})
}

func slicesCopy(in []sudoku.PuzzleRecord) []sudoku.PuzzleRecord {
	out := make([]sudoku.PuzzleRecord, len(in))
	copy(out, in)
	return out
}
