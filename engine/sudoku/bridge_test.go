package sudoku

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func TestNextHintJSONStatuses(t *testing.T) {
	easyBoard, err := ParseBoardString(easyPuzzleFixture)
	if err != nil {
		t.Fatalf("ParseBoardString failed: %v", err)
	}
	easySolved, ok, err := easyBoard.SolveBacktrack()
	if err != nil || !ok {
		t.Fatalf("SolveBacktrack failed: ok=%v err=%v", ok, err)
	}
	easySolStr := easySolved.String()

	t.Run("ok returns full Step with non-nil slices", func(t *testing.T) {
		req := `{"board":"` + easyPuzzleFixture + `","solution":"` + easySolStr + `"}`
		raw := NextHintJSON(req)

		var resp nextHintResponse
		if err := json.Unmarshal([]byte(raw), &resp); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if !resp.OK || resp.Status != HintStatusOK || resp.Step == nil {
			t.Fatalf("unexpected response: %s", raw)
		}
		if len(resp.Step.Placements) == 0 && len(resp.Step.Eliminations) == 0 {
			t.Fatalf("expected non-empty placements or eliminations in %s", raw)
		}
		if strings.Contains(raw, `"drivingCells":null`) ||
			strings.Contains(raw, `"placements":null`) ||
			strings.Contains(raw, `"eliminations":null`) {
			t.Fatalf("expected empty slices instead of null in step JSON: %s", raw)
		}
	})

	t.Run("conflict reports all conflicting cell indices", func(t *testing.T) {
		// easyPuzzleFixture starts with "530070000..."; placing '5' at index 2 conflicts with index 0.
		conflictStr := "535070000" + easyPuzzleFixture[9:]
		raw := NextHintJSON(`{"board":"` + conflictStr + `"}`)

		var resp nextHintResponse
		if err := json.Unmarshal([]byte(raw), &resp); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if !resp.OK || resp.Status != HintStatusConflict {
			t.Fatalf("expected status=%q, got %s", HintStatusConflict, raw)
		}
		if !slices.Equal(resp.ConflictCells, []int{0, 2}) {
			t.Fatalf("conflictCells = %v, want [0 2]", resp.ConflictCells)
		}
	})

	t.Run("wrong_entry detects entries disagreeing with solution without peer conflicts", func(t *testing.T) {
		// Find first empty cell and pick a valid peer-safe digit different from the true solution.
		digits := easyBoard.Digits()
		wrongCell := -1
		var wrongDigit uint8
		for i := range BoardSize {
			if digits[i] != 0 {
				continue
			}
			for d := uint8(1); d <= GridSize; d++ {
				if d == easySolved.Cells[i].Value {
					continue
				}
				candidate := easyBoard
				if candidate.Place(i, d) == nil {
					wrongCell = i
					wrongDigit = d
					break
				}
			}
			if wrongCell >= 0 {
				break
			}
		}
		if wrongCell < 0 {
			t.Fatal("failed to locate a peer-safe wrong digit")
		}

		digits[wrongCell] = wrongDigit
		var bStr [BoardSize]byte
		for i, d := range digits {
			bStr[i] = '0' + d
		}

		req := `{"board":"` + string(bStr[:]) + `","solution":"` + easySolStr + `"}`
		raw := NextHintJSON(req)

		var resp nextHintResponse
		if err := json.Unmarshal([]byte(raw), &resp); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if !resp.OK || resp.Status != HintStatusWrongEntry {
			t.Fatalf("expected status=%q, got %s", HintStatusWrongEntry, raw)
		}
		if !slices.Equal(resp.WrongCells, []int{wrongCell}) {
			t.Fatalf("wrongCells = %v, want [%d]", resp.WrongCells, wrongCell)
		}
	})

	t.Run("unsolvable detects zero-solution valid board when solution omitted", func(t *testing.T) {
		// Standard unsolvable fixture (no direct peer conflict, but cell (0,0) has no valid path).
		// Row 0 has 123456780, col 8 has 9 elsewhere -> putting 1..8 across row 0 and 9 in col 8 makes (0,8) impossible.
		unsolvable := "123456780" +
			"000000009" +
			strings.Repeat("0", 63)
		raw := NextHintJSON(`{"board":"` + unsolvable + `"}`)

		var resp nextHintResponse
		if err := json.Unmarshal([]byte(raw), &resp); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if !resp.OK || resp.Status != HintStatusUnsolvable {
			t.Fatalf("expected status=%q, got %s", HintStatusUnsolvable, raw)
		}
	})

	t.Run("solved detects completed valid board", func(t *testing.T) {
		raw := NextHintJSON(`{"board":"` + easySolStr + `","solution":"` + easySolStr + `"}`)

		var resp nextHintResponse
		if err := json.Unmarshal([]byte(raw), &resp); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if !resp.OK || resp.Status != HintStatusSolved {
			t.Fatalf("expected status=%q, got %s", HintStatusSolved, raw)
		}
	})

	t.Run("no_logical_step on guessing-required board", func(t *testing.T) {
		extreme := "800000000003600000070090200050007000000045700000100030001000068008500010090000400"
		raw := NextHintJSON(`{"board":"` + extreme + `"}`)

		var resp nextHintResponse
		if err := json.Unmarshal([]byte(raw), &resp); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if !resp.OK || resp.Status != HintStatusNoLogicalStep {
			t.Fatalf("expected status=%q, got %s", HintStatusNoLogicalStep, raw)
		}
	})

	t.Run("error cases return ok=false", func(t *testing.T) {
		cases := []string{
			`{bad`,
			`{}`,
			`{"board":"123"}`,
			`{"board":"` + easyPuzzleFixture + `","solution":"` + easyPuzzleFixture + `"}`,
		}
		for _, payload := range cases {
			raw := NextHintJSON(payload)
			var resp nextHintResponse
			if err := json.Unmarshal([]byte(raw), &resp); err != nil {
				t.Fatalf("unmarshal failed for %s: %v", payload, err)
			}
			if resp.OK || resp.Error == "" {
				t.Fatalf("expected error for %s, got %s", payload, raw)
			}
		}
	})
}

func TestGenerateAndGradePuzzleJSON(t *testing.T) {
	tiers := []Difficulty{DifficultyEasy, DifficultyMedium, DifficultyHard}
	for _, tier := range tiers {
		genReq := `{"seed":42,"difficulty":"` + string(tier) + `"}`
		genRaw := GeneratePuzzleJSON(genReq)

		var genResp generatePuzzleResponse
		if err := json.Unmarshal([]byte(genRaw), &genResp); err != nil {
			t.Fatalf("unmarshal GeneratePuzzleJSON(%s) failed: %v", tier, err)
		}
		if !genResp.OK || genResp.Puzzle == nil {
			t.Fatalf("GeneratePuzzleJSON(%s) failed: %s", tier, genRaw)
		}
		if genResp.Puzzle.Difficulty != tier {
			t.Fatalf("generated difficulty = %q, want %q", genResp.Puzzle.Difficulty, tier)
		}

		// Verify determinism via second call.
		if second := GeneratePuzzleJSON(genReq); second != genRaw {
			t.Fatalf("non-deterministic GeneratePuzzleJSON output for %s", tier)
		}

		gradeRaw := GradePuzzleJSON(`{"clues":"` + genResp.Puzzle.Clues + `"}`)
		var gradeResp gradePuzzleResponse
		if err := json.Unmarshal([]byte(gradeRaw), &gradeResp); err != nil {
			t.Fatalf("unmarshal GradePuzzleJSON(%s) failed: %v", tier, err)
		}
		if !gradeResp.OK || gradeResp.Grade == nil {
			t.Fatalf("GradePuzzleJSON(%s) failed: %s", tier, gradeRaw)
		}
		if gradeResp.Grade.Difficulty != tier {
			t.Fatalf("graded difficulty = %q, want %q", gradeResp.Grade.Difficulty, tier)
		}
		if !slices.Equal(gradeResp.Grade.TechniquesRequired, genResp.Puzzle.TechniquesRequired) {
			t.Fatalf("techniquesRequired mismatch: graded=%v generated=%v",
				gradeResp.Grade.TechniquesRequired, genResp.Puzzle.TechniquesRequired)
		}
	}

	// Reject unsupported difficulty and guessing-required board.
	badGen := GeneratePuzzleJSON(`{"seed":1,"difficulty":"expert"}`)
	if !strings.Contains(badGen, `"ok":false`) {
		t.Fatalf("expected error for unsupported difficulty, got %s", badGen)
	}

	extreme := "800000000003600000070090200050007000000045700000100030001000068008500010090000400"
	badGrade := GradePuzzleJSON(`{"clues":"` + extreme + `"}`)
	if !strings.Contains(badGrade, `"ok":false`) {
		t.Fatalf("expected error for guessing puzzle, got %s", badGrade)
	}
}

func TestCountSolutionsJSONCases(t *testing.T) {
	raw := CountSolutionsJSON(`{"board":"` + easyPuzzleFixture + `"}`)
	var resp countSolutionsResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if !resp.OK || resp.Solutions != 1 || !resp.Unique {
		t.Fatalf("unexpected unique response: %s", raw)
	}

	emptyRaw := CountSolutionsJSON(`{"puzzle":"` + strings.Repeat("0", 81) + `"}`)
	var emptyResp countSolutionsResponse
	if err := json.Unmarshal([]byte(emptyRaw), &emptyResp); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if !emptyResp.OK || emptyResp.Solutions != 2 || emptyResp.Unique {
		t.Fatalf("unexpected non-unique response: %s", emptyRaw)
	}
}
