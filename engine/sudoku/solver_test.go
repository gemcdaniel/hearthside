package sudoku

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

const (
	easyPuzzleFixture = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
	hardPuzzleFixture = "000000907000420180000705026100904000050000040000507009920108000034059000507000000"
)

func uniformCandidateBoard() Board {
	var b Board
	for i := range BoardSize {
		b.Cells[i].Candidates = AllCandidates
	}
	return b
}

func TestTechniqueDifficultyMapping(t *testing.T) {
	tests := []struct {
		tech Technique
		want Difficulty
	}{
		{TechniqueNakedSingle, DifficultyEasy},
		{TechniqueHiddenSingle, DifficultyEasy},
		{TechniquePointingLine, DifficultyMedium},
		{TechniqueBoxLineReduction, DifficultyMedium},
		{TechniqueNakedPair, DifficultyMedium},
		{TechniqueHiddenPair, DifficultyMedium},
		{TechniqueNakedTriple, DifficultyMedium},
		{TechniqueHiddenTriple, DifficultyMedium},
	}

	for _, tc := range tests {
		if got := tc.tech.Difficulty(); got != tc.want {
			t.Fatalf("Technique(%q).Difficulty() = %q, want %q", tc.tech, got, tc.want)
		}
	}
}

func TestIsolatedEasyAndMediumTechniques(t *testing.T) {
	t.Run("NakedSingle", func(t *testing.T) {
		b := uniformCandidateBoard()
		b.Cells[0].Candidates = DigitMask(7)

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueNakedSingle || step.Difficulty != DifficultyEasy {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionCell, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0}) {
			t.Fatalf("DrivingCells = %v, want [0]", step.DrivingCells)
		}
		if !slices.Equal(step.Placements, []Placement{{Cell: 0, Digit: 7}}) {
			t.Fatalf("Placements = %+v", step.Placements)
		}
		if len(step.Eliminations) != 20 {
			t.Fatalf("expected 20 peer eliminations, got %d", len(step.Eliminations))
		}
	})

	t.Run("HiddenSingle", func(t *testing.T) {
		b := uniformCandidateBoard()
		for col := 1; col < GridSize; col++ {
			b.Cells[col].Candidates &^= DigitMask(4)
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueHiddenSingle || step.Difficulty != DifficultyEasy {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0}) {
			t.Fatalf("DrivingCells = %v, want [0]", step.DrivingCells)
		}
		if !slices.Equal(step.Placements, []Placement{{Cell: 0, Digit: 4}}) {
			t.Fatalf("Placements = %+v", step.Placements)
		}
		// 8 peers in row 0 already lack 4; 12 remaining peers in col 0 and box 0 have 4.
		if len(step.Eliminations) != 12 {
			t.Fatalf("expected 12 peer eliminations, got %d", len(step.Eliminations))
		}
	})

	t.Run("PointingLine", func(t *testing.T) {
		b := uniformCandidateBoard()
		for _, c := range []int{2, 9, 10, 11, 18, 19, 20} {
			b.Cells[c].Candidates &^= DigitMask(5)
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniquePointingLine || step.Difficulty != DifficultyMedium {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionBox, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 1}) {
			t.Fatalf("DrivingCells = %v, want [0 1]", step.DrivingCells)
		}
		if len(step.Placements) != 0 {
			t.Fatalf("expected no placements, got %+v", step.Placements)
		}
		wantElims := []Elimination{
			{Cell: 3, Digit: 5},
			{Cell: 4, Digit: 5},
			{Cell: 5, Digit: 5},
			{Cell: 6, Digit: 5},
			{Cell: 7, Digit: 5},
			{Cell: 8, Digit: 5},
		}
		if !slices.Equal(step.Eliminations, wantElims) {
			t.Fatalf("Eliminations = %+v, want %+v", step.Eliminations, wantElims)
		}
	})

	t.Run("BoxLineReduction", func(t *testing.T) {
		b := uniformCandidateBoard()
		for _, c := range []int{2, 3, 4, 5, 6, 7, 8} {
			b.Cells[c].Candidates &^= DigitMask(6)
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueBoxLineReduction || step.Difficulty != DifficultyMedium {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 1}) {
			t.Fatalf("DrivingCells = %v, want [0 1]", step.DrivingCells)
		}
		wantElims := []Elimination{
			{Cell: 9, Digit: 6},
			{Cell: 10, Digit: 6},
			{Cell: 11, Digit: 6},
			{Cell: 18, Digit: 6},
			{Cell: 19, Digit: 6},
			{Cell: 20, Digit: 6},
		}
		if !slices.Equal(step.Eliminations, wantElims) {
			t.Fatalf("Eliminations = %+v, want %+v", step.Eliminations, wantElims)
		}
	})

	t.Run("NakedPair", func(t *testing.T) {
		b := uniformCandidateBoard()
		pairMask := DigitMask(1) | DigitMask(2)
		b.Cells[0].Candidates = pairMask
		b.Cells[1].Candidates = pairMask

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueNakedPair || step.Difficulty != DifficultyMedium {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 1}) {
			t.Fatalf("DrivingCells = %v, want [0 1]", step.DrivingCells)
		}
		if len(step.Eliminations) != 14 {
			t.Fatalf("expected 14 eliminations across cells 2..8, got %d", len(step.Eliminations))
		}
		if err := b.ApplyStep(step); err != nil {
			t.Fatalf("ApplyStep failed: %v", err)
		}
		if HasCandidate(b.Cells[5].Candidates, 1) || HasCandidate(b.Cells[5].Candidates, 2) {
			t.Fatal("expected ApplyStep to eliminate 1 and 2 from cell 5")
		}
	})

	t.Run("HiddenPair", func(t *testing.T) {
		b := uniformCandidateBoard()
		remove89 := DigitMask(8) | DigitMask(9)
		for _, c := range []int{1, 2, 4, 5, 6, 7, 8} {
			b.Cells[c].Candidates &^= remove89
		}

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueHiddenPair || step.Difficulty != DifficultyMedium {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 3}) {
			t.Fatalf("DrivingCells = %v, want [0 3]", step.DrivingCells)
		}
		if len(step.Eliminations) != 14 {
			t.Fatalf("expected 14 eliminations (1..7 from cells 0 and 3), got %d", len(step.Eliminations))
		}
	})

	t.Run("NakedTriple", func(t *testing.T) {
		b := uniformCandidateBoard()
		b.Cells[0].Candidates = DigitMask(1) | DigitMask(2)
		b.Cells[3].Candidates = DigitMask(2) | DigitMask(3)
		b.Cells[6].Candidates = DigitMask(1) | DigitMask(3)

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueNakedTriple || step.Difficulty != DifficultyMedium {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 3, 6}) {
			t.Fatalf("DrivingCells = %v, want [0 3 6]", step.DrivingCells)
		}
		if len(step.Eliminations) != 18 {
			t.Fatalf("expected 18 eliminations across the other 6 row cells, got %d", len(step.Eliminations))
		}
	})

	t.Run("HiddenTriple", func(t *testing.T) {
		b := uniformCandidateBoard()
		remove789 := DigitMask(7) | DigitMask(8) | DigitMask(9)
		for _, c := range []int{1, 2, 4, 5, 7, 8} {
			b.Cells[c].Candidates &^= remove789
		}
		b.Cells[0].Candidates = DigitMask(1) | DigitMask(2) | DigitMask(7) | DigitMask(8)
		b.Cells[3].Candidates = DigitMask(2) | DigitMask(3) | DigitMask(8) | DigitMask(9)
		b.Cells[6].Candidates = DigitMask(1) | DigitMask(3) | DigitMask(7) | DigitMask(9)

		step, ok, err := NextStep(b)
		if err != nil || !ok {
			t.Fatalf("NextStep failed: ok=%v err=%v", ok, err)
		}
		if step.Technique != TechniqueHiddenTriple || step.Difficulty != DifficultyMedium {
			t.Fatalf("unexpected technique/difficulty: %+v", step)
		}
		if step.Region != (Region{Kind: RegionRow, Index: 0}) {
			t.Fatalf("unexpected region: %+v", step.Region)
		}
		if !slices.Equal(step.DrivingCells, []int{0, 3, 6}) {
			t.Fatalf("DrivingCells = %v, want [0 3 6]", step.DrivingCells)
		}
		wantElims := []Elimination{
			{Cell: 0, Digit: 1},
			{Cell: 0, Digit: 2},
			{Cell: 3, Digit: 2},
			{Cell: 3, Digit: 3},
			{Cell: 6, Digit: 1},
			{Cell: 6, Digit: 3},
		}
		if !slices.Equal(step.Eliminations, wantElims) {
			t.Fatalf("Eliminations = %+v, want %+v", step.Eliminations, wantElims)
		}
	})
}

func TestSolveLogicalEasyPuzzleAndNoStepOnSolved(t *testing.T) {
	board, err := ParseBoardString(easyPuzzleFixture)
	if err != nil {
		t.Fatalf("ParseBoardString failed: %v", err)
	}

	solved, steps, ok := SolveLogical(board)
	if !ok {
		t.Fatalf("expected easy puzzle to solve logically, stopped after %d steps", len(steps))
	}
	if !solved.IsSolved() {
		t.Fatal("expected solved board to report IsSolved() == true")
	}

	step, found, err := NextStep(solved)
	if err != nil || found {
		t.Fatalf("expected no step on solved board, got found=%v step=%+v err=%v", found, step, err)
	}
}

func TestJSONBridge(t *testing.T) {
	payload := `{"puzzle":"` + easyPuzzleFixture + `"}`

	stepRaw := NextStepJSON(payload)
	var stepResp struct {
		OK            bool   `json:"ok"`
		EngineVersion string `json:"engineVersion"`
		Found         bool   `json:"found"`
		Step          *Step  `json:"step"`
		Error         string `json:"error"`
	}
	if err := json.Unmarshal([]byte(stepRaw), &stepResp); err != nil {
		t.Fatalf("unmarshal NextStepJSON failed: %v", err)
	}
	if !stepResp.OK || !stepResp.Found || stepResp.Step == nil {
		t.Fatalf("unexpected NextStepJSON response: %s", stepRaw)
	}

	hintRaw := NextHintJSON(payload)
	var hintResp struct {
		OK            bool         `json:"ok"`
		EngineVersion string       `json:"engineVersion"`
		Hint          *HintSummary `json:"hint"`
		Error         string       `json:"error"`
	}
	if err := json.Unmarshal([]byte(hintRaw), &hintResp); err != nil {
		t.Fatalf("unmarshal NextHintJSON failed: %v", err)
	}
	if !hintResp.OK || hintResp.Hint == nil || !hintResp.Hint.Found {
		t.Fatalf("unexpected NextHintJSON response: %s", hintRaw)
	}

	countRaw := CountSolutionsJSON(payload)
	var countResp struct {
		OK        bool   `json:"ok"`
		Solutions int    `json:"solutions"`
		Unique    bool   `json:"unique"`
		Error     string `json:"error"`
	}
	if err := json.Unmarshal([]byte(countRaw), &countResp); err != nil {
		t.Fatalf("unmarshal CountSolutionsJSON failed: %v", err)
	}
	if !countResp.OK || countResp.Solutions != 1 || !countResp.Unique {
		t.Fatalf("unexpected CountSolutionsJSON response: %s", countRaw)
	}

	badRaw := NextStepJSON(`{"puzzle":"` + strings.Repeat("x", 81) + `"}`)
	var badResp struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(badRaw), &badResp); err != nil {
		t.Fatalf("unmarshal bad response failed: %v", err)
	}
	if badResp.OK || badResp.Error == "" {
		t.Fatalf("expected error response for bad payload, got %s", badRaw)
	}
}
