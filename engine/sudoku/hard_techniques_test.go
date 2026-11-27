package sudoku

import (
	"slices"
	"testing"
)

func TestHardTechniqueDifficultyMapping(t *testing.T) {
	hardTechs := []Technique{
		TechniqueSkyscraper,
		TechniqueXWing,
		TechniqueWWing,
		TechniqueXYWing,
		TechniqueSwordfish,
	}
	for _, tech := range hardTechs {
		if got := tech.Difficulty(); got != DifficultyHard {
			t.Fatalf("Technique(%q).Difficulty() = %q, want %q", tech, got, DifficultyHard)
		}
	}
}

func TestIsolatedHardTechniques(t *testing.T) {
	t.Run("Skyscraper", func(t *testing.T) {
		b := uniformCandidateBoard()
		// Keep digit 5 in row 0 at cols {0, 3} -> cells 0, 3
		// Keep digit 5 in row 3 at cols {0, 4} -> cells 27, 31
		// Base in col 0 (cells 0, 27); roofs at cell 3 (0,3) in box 1 and cell 31 (3,4) in box 4.
		for _, c := range []int{1, 2, 4, 5, 6, 7, 8, 28, 29, 30, 32, 33, 34, 35} {
			b.Cells[c].Candidates &^= DigitMask(5)
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueSkyscraper || step.Difficulty != DifficultyHard {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 3, 27, 31}) {
			t.Fatalf("DrivingCells = %v, want [0 3 27 31]", step.DrivingCells)
		}
		wantElims := []Elimination{
			{Cell: 13, Digit: 5},
			{Cell: 22, Digit: 5},
			{Cell: 39, Digit: 5},
			{Cell: 48, Digit: 5},
		}
		if !slices.Equal(step.Eliminations, wantElims) {
			t.Fatalf("Eliminations = %+v, want %+v", step.Eliminations, wantElims)
		}
		if err := b.ApplyStep(step); err != nil {
			t.Fatalf("ApplyStep failed: %v", err)
		}
		if HasCandidate(b.Cells[13].Candidates, 5) {
			t.Fatal("expected ApplyStep to eliminate 5 from cell 13")
		}
	})

	t.Run("XWing", func(t *testing.T) {
		b := uniformCandidateBoard()
		// Keep digit 5 in row 0 at cols {0, 4} (cells 0, 4) and row 3 at cols {0, 4} (cells 27, 31).
		for _, c := range []int{1, 2, 3, 5, 6, 7, 8, 28, 29, 30, 32, 33, 34, 35} {
			b.Cells[c].Candidates &^= DigitMask(5)
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueXWing || step.Difficulty != DifficultyHard {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 4, 27, 31}) {
			t.Fatalf("DrivingCells = %v, want [0 4 27 31]", step.DrivingCells)
		}
		if len(step.Eliminations) != 14 {
			t.Fatalf("expected 14 eliminations in cols 0 and 4, got %d", len(step.Eliminations))
		}
		for _, e := range step.Eliminations {
			if e.Digit != 5 || (ColOf[e.Cell] != 0 && ColOf[e.Cell] != 4) {
				t.Fatalf("unexpected XWing elimination: %+v", e)
			}
		}
	})

	t.Run("WWing", func(t *testing.T) {
		b := uniformCandidateBoard()
		// Two non-peer bivalue cells {1,2}: cell 0 (0,0) and cell 13 (1,4).
		pairMask := DigitMask(1) | DigitMask(2)
		b.Cells[0].Candidates = pairMask
		b.Cells[13].Candidates = pairMask
		// Strong link on digit 1 in row 5: only cell 45 (5,0) and cell 49 (5,4) keep candidate 1.
		for _, c := range []int{46, 47, 48, 50, 51, 52, 53} {
			b.Cells[c].Candidates &^= DigitMask(1)
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueWWing || step.Difficulty != DifficultyHard {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 5}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 13, 45, 49}) {
			t.Fatalf("DrivingCells = %v, want [0 13 45 49]", step.DrivingCells)
		}
		wantElims := []Elimination{
			{Cell: 3, Digit: 2},
			{Cell: 4, Digit: 2},
			{Cell: 5, Digit: 2},
			{Cell: 9, Digit: 2},
			{Cell: 10, Digit: 2},
			{Cell: 11, Digit: 2},
		}
		if !slices.Equal(step.Eliminations, wantElims) {
			t.Fatalf("Eliminations = %+v, want %+v", step.Eliminations, wantElims)
		}
	})

	t.Run("XYWing", func(t *testing.T) {
		b := uniformCandidateBoard()
		// Pivot cell 0 (0,0): {1,2}; pincer 1 at cell 3 (0,3): {1,3}; pincer 2 at cell 27 (3,0): {2,3}.
		b.Cells[0].Candidates = DigitMask(1) | DigitMask(2)
		b.Cells[3].Candidates = DigitMask(1) | DigitMask(3)
		b.Cells[27].Candidates = DigitMask(2) | DigitMask(3)

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueXYWing || step.Difficulty != DifficultyHard {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionCell, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 3, 27}) {
			t.Fatalf("DrivingCells = %v, want [0 3 27]", step.DrivingCells)
		}
		wantElims := []Elimination{{Cell: 30, Digit: 3}}
		if !slices.Equal(step.Eliminations, wantElims) {
			t.Fatalf("Eliminations = %+v, want %+v", step.Eliminations, wantElims)
		}
	})

	t.Run("Swordfish", func(t *testing.T) {
		b := uniformCandidateBoard()
		// Keep digit 5 in rows 0, 3, 6 strictly in cols {0, 4, 8} (3 per row so XWing/Skyscraper do not fire).
		for _, r := range []int{0, 3, 6} {
			for c := range GridSize {
				if c != 0 && c != 4 && c != 8 {
					b.Cells[Rows[r][c]].Candidates &^= DigitMask(5)
				}
			}
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueSwordfish || step.Difficulty != DifficultyHard {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		wantDriving := []int{0, 4, 8, 27, 31, 35, 54, 58, 62}
		if !slices.Equal(step.DrivingCells, wantDriving) {
			t.Fatalf("DrivingCells = %v, want %v", step.DrivingCells, wantDriving)
		}
		if len(step.Eliminations) != 18 {
			t.Fatalf("expected 18 eliminations across the other 6 rows in cols 0,4,8, got %d", len(step.Eliminations))
		}
	})
}
