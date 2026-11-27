package sudoku

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const (
	easyPuzzleFixture = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
	hardPuzzleFixture = "000000907000420180000705026100904000050000040000507009920108000034059000507000000"
)

func TestSolveLogicalEasyPuzzleAndUniqueness(t *testing.T) {
	board, err := ParseBoardString(easyPuzzleFixture)
	if err != nil {
		t.Fatalf("ParseBoardString failed: %v", err)
	}

	if !HasUniqueSolution(board) {
		t.Fatal("expected easy puzzle to have a unique solution")
	}

	solved, steps, ok := SolveLogical(board)
	if !ok {
		t.Fatalf("expected easy puzzle to solve logically, stopped after %d steps", len(steps))
	}
	if !solved.IsSolved() {
		t.Fatal("expected solved board to report IsSolved() == true")
	}
	if len(steps) == 0 {
		t.Fatal("expected non-empty step trace")
	}
}

func TestNextHintNakedAndHiddenSingles(t *testing.T) {
	// Cell 0 (row 0, col 0) sees 2..9 in row 0, leaving only 1 -> naked single.
	nakedRow := "023456789" + strings.Repeat("0", 72)
	bNaked, err := ParseBoardString(nakedRow)
	if err != nil {
		t.Fatalf("ParseBoardString naked failed: %v", err)
	}
	hint, err := NextHint(bNaked)
	if err != nil {
		t.Fatalf("NextHint failed: %v", err)
	}
	if !hint.Found || hint.Technique != TechniqueNakedSingle || hint.Cell != 0 || hint.Digit != 1 {
		t.Fatalf("unexpected naked single hint: %+v", hint)
	}

	// Construct a board with NO naked singles, but a hidden single for digit 1 in row 0.
	// Row 0 has cells 1..6 filled (digits 2..7), leaving cells 0, 7, and 8 empty.
	// Placing 1 at (1,7) [index 16, box 2] blocks digit 1 from both cell 7 and cell 8,
	// leaving {8,9} there and {1,8,9} at cell 0, so cell 0 is a hidden single for 1.
	var digits [BoardSize]uint8
	digits[1] = 2
	digits[2] = 3
	digits[3] = 4
	digits[4] = 5
	digits[5] = 6
	digits[6] = 7
	digits[16] = 1
	bHidden, err := NewBoardFromDigits(digits)
	if err != nil {
		t.Fatalf("NewBoardFromDigits hidden failed: %v", err)
	}
	hint, err = NextHint(bHidden)
	if err != nil {
		t.Fatalf("NextHint hidden failed: %v", err)
	}
	if !hint.Found || hint.Technique != TechniqueHiddenSingle || hint.Cell != 0 || hint.Digit != 1 {
		t.Fatalf("unexpected hidden single hint: %+v", hint)
	}
	if len(hint.Eliminations) == 0 {
		t.Fatal("expected peer eliminations on hidden single hint")
	}
}

func TestCountSolutionsUnsolvableAndMultiSolution(t *testing.T) {
	// Conflicting board rejected by NewBoardFromDigits.
	var conflict [BoardSize]uint8
	conflict[0] = 5
	conflict[1] = 5
	if _, err := NewBoardFromDigits(conflict); !errors.Is(err, ErrInvalidBoard) {
		t.Fatalf("expected ErrInvalidBoard, got %v", err)
	}

	// Unsolvable board without direct peer conflicts: cell 0 has no candidates because
	// row 0 holds 1..8 and col 0 holds 9.
	unsolvableStr := "012345678" +
		"900000000" +
		strings.Repeat("0", 63)
	bUnsolvable, err := ParseBoardString(unsolvableStr)
	if err != nil {
		t.Fatalf("ParseBoardString unsolvable failed: %v", err)
	}
	cnt, err := CountSolutions(bUnsolvable, 2)
	if err != nil {
		t.Fatalf("CountSolutions unsolvable error: %v", err)
	}
	if cnt != 0 {
		t.Fatalf("expected 0 solutions for unsolvable board, got %d", cnt)
	}

	// Empty board has many solutions; CountSolutions(..., 2) must stop at 2.
	emptyBoard, err := ParseBoardString(strings.Repeat("0", BoardSize))
	if err != nil {
		t.Fatalf("ParseBoardString empty failed: %v", err)
	}
	cnt, err = CountSolutions(emptyBoard, 2)
	if err != nil {
		t.Fatalf("CountSolutions empty error: %v", err)
	}
	if cnt != 2 {
		t.Fatalf("expected CountSolutions to stop at 2, got %d", cnt)
	}
}

func TestHardPuzzleFixtureUniqueAndHintSafe(t *testing.T) {
	board, err := ParseBoardString(hardPuzzleFixture)
	if err != nil {
		t.Fatalf("ParseBoardString hard failed: %v", err)
	}
	cnt, err := CountSolutions(board, 2)
	if err != nil {
		t.Fatalf("CountSolutions hard error: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("expected hard fixture to have 1 unique solution, got %d", cnt)
	}
	if _, err := NextHint(board); err != nil {
		t.Fatalf("NextHint hard error: %v", err)
	}
}

func TestJSONBridge(t *testing.T) {
	payload := `{"puzzle":"` + easyPuzzleFixture + `"}`

	hintRaw := NextHintJSON(payload)
	var hintResp struct {
		OK            bool      `json:"ok"`
		EngineVersion string    `json:"engineVersion"`
		Hint          *HintStep `json:"hint"`
		Error         string    `json:"error"`
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

	badRaw := NextHintJSON(`{"puzzle":"too-short"}`)
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
