package sudoku

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestGenerateProperties(t *testing.T) {
	tiers := []Difficulty{DifficultyEasy, DifficultyMedium, DifficultyHard}
	seeds := []uint64{1, 42, 2026}

	for _, tier := range tiers {
		for _, seed := range seeds {
			rec1, err := Generate(seed, tier)
			if err != nil {
				t.Fatalf("Generate(seed=%d, tier=%s) failed: %v", seed, tier, err)
			}
			rec2, err := Generate(seed, tier)
			if err != nil {
				t.Fatalf("second Generate(seed=%d, tier=%s) failed: %v", seed, tier, err)
			}

			raw1, err := json.Marshal(rec1)
			if err != nil {
				t.Fatalf("json.Marshal(rec1) failed: %v", err)
			}
			raw2, err := json.Marshal(rec2)
			if err != nil {
				t.Fatalf("json.Marshal(rec2) failed: %v", err)
			}
			if !bytes.Equal(raw1, raw2) {
				t.Fatalf("Generate(seed=%d, tier=%s) is not deterministic:\n%s\nvs\n%s", seed, tier, raw1, raw2)
			}

			if rec1.ID == "" || rec1.EngineVersion != EngineVersion || rec1.Difficulty != tier {
				t.Fatalf("unexpected record metadata: %+v", rec1)
			}

			board, err := ParseBoardString(rec1.Clues)
			if err != nil {
				t.Fatalf("ParseBoardString(Clues) failed: %v", err)
			}
			cnt, err := board.CountSolutions(2)
			if err != nil || cnt != 1 {
				t.Fatalf("generated puzzle uniqueness count = %d, err = %v", cnt, err)
			}

			solved, ok, err := board.SolveBacktrack()
			if err != nil || !ok {
				t.Fatalf("SolveBacktrack failed: ok=%v err=%v", ok, err)
			}
			if solved.String() != rec1.Solution {
				t.Fatalf("SolveBacktrack() = %s, want Solution = %s", solved.String(), rec1.Solution)
			}

			gradeRes, err := Grade(&board)
			if err != nil {
				t.Fatalf("Grade failed on generated puzzle: %v", err)
			}
			if gradeRes.Difficulty != tier {
				t.Fatalf("Grade difficulty = %s, want %s", gradeRes.Difficulty, tier)
			}
		}
	}
}

func FuzzBoardParseAndGrade(f *testing.F) {
	f.Add(easyPuzzleFixture)
	f.Add(hardPuzzleFixture)
	f.Add("800000000003600000070090200050007000000045700000100030001000068008500010090000400")
	f.Add("")
	f.Add("invalid")

	f.Fuzz(func(_ *testing.T, input string) {
		board, err := ParseBoardString(input)
		if err != nil {
			return
		}
		_, _ = board.CountSolutions(2)
		_, _, _ = board.SolveBacktrack()
		_, _, _ = NextStep(board)
		_, _ = Grade(&board)
	})
}

func BenchmarkGenerateEasy(b *testing.B) {
	for i := range b.N {
		if _, err := Generate(uint64(i+1), DifficultyEasy); err != nil {
			b.Fatalf("Generate Easy failed: %v", err)
		}
	}
}

func BenchmarkGenerateMedium(b *testing.B) {
	for i := range b.N {
		if _, err := Generate(uint64(i+1), DifficultyMedium); err != nil {
			b.Fatalf("Generate Medium failed: %v", err)
		}
	}
}

func BenchmarkGenerateHard(b *testing.B) {
	for i := range b.N {
		if _, err := Generate(uint64(i+1), DifficultyHard); err != nil {
			b.Fatalf("Generate Hard failed: %v", err)
		}
	}
}

func BenchmarkGradeHard(b *testing.B) {
	rec, err := Generate(1, DifficultyHard)
	if err != nil {
		b.Fatalf("setup Generate Hard failed: %v", err)
	}
	board, err := ParseBoardString(rec.Clues)
	if err != nil {
		b.Fatalf("ParseBoardString failed: %v", err)
	}

	b.ResetTimer()
	for range b.N {
		res, gradeErr := Grade(&board)
		if gradeErr != nil || res.Difficulty != DifficultyHard {
			b.Fatalf("Grade failed: res=%+v err=%v", res, gradeErr)
		}
	}
}
