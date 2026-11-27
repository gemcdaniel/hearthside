package sudoku

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

func TestLookupTablesInvariants(t *testing.T) {
	for i := range BoardSize {
		if !slices.IsSorted(Peers[i][:]) {
			t.Fatalf("Peers[%d] is not sorted: %v", i, Peers[i])
		}
		for j, p := range Peers[i] {
			if p == i {
				t.Fatalf("Peers[%d] contains self", i)
			}
			if !ArePeers(i, p) || !ArePeers(p, i) {
				t.Fatalf("ArePeers(%d, %d) not symmetric", i, p)
			}
			if j > 0 && Peers[i][j-1] == p {
				t.Fatalf("Peers[%d] has duplicate peer %d", i, p)
			}
		}
	}

	for u := range UnitCount {
		var seen [BoardSize]bool
		for _, cell := range Units[u] {
			if cell < 0 || cell >= BoardSize || seen[cell] {
				t.Fatalf("Units[%d] invalid or duplicate cell %d", u, cell)
			}
			seen[cell] = true
		}
	}
}

func TestCandidateBitmaskHelpers(t *testing.T) {
	if DigitMask(0) != 0 || DigitMask(10) != 0 {
		t.Fatal("expected 0 mask for out-of-range digits")
	}
	mask := DigitMask(2) | DigitMask(5) | DigitMask(9)
	if got := CandidateCount(mask); got != 3 {
		t.Fatalf("CandidateCount = %d, want 3", got)
	}
	if got := FirstCandidate(mask); got != 2 {
		t.Fatalf("FirstCandidate = %d, want 2", got)
	}
	if FirstCandidate(0) != 0 {
		t.Fatal("FirstCandidate(0) should be 0")
	}
	if !HasCandidate(mask, 5) || HasCandidate(mask, 4) {
		t.Fatal("HasCandidate mismatch")
	}
	digits := CandidateDigits(mask)
	if !slices.Equal(digits, []uint8{2, 5, 9}) {
		t.Fatalf("CandidateDigits = %v, want [2 5 9]", digits)
	}
}

func TestParseBoardStringAndValidation(t *testing.T) {
	easyDots := strings.ReplaceAll(easyPuzzleFixture, "0", ".")

	tests := []struct {
		name    string
		input   string
		wantErr error
	}{
		{
			name:    "valid zero empty",
			input:   "  " + easyPuzzleFixture + "\n",
			wantErr: nil,
		},
		{
			name:    "valid dot empty",
			input:   easyDots,
			wantErr: nil,
		},
		{
			name:    "too short",
			input:   "12345",
			wantErr: ErrInvalidInput,
		},
		{
			name:    "invalid character",
			input:   "x" + strings.Repeat("0", 80),
			wantErr: ErrInvalidInput,
		},
		{
			name:    "row conflict",
			input:   "55" + strings.Repeat("0", 79),
			wantErr: ErrInvalidBoard,
		},
		{
			name:    "column conflict",
			input:   "7" + strings.Repeat("0", 8) + "7" + strings.Repeat("0", 71),
			wantErr: ErrInvalidBoard,
		},
		{
			name:    "box conflict",
			input:   "3" + strings.Repeat("0", 9) + "3" + strings.Repeat("0", 70),
			wantErr: ErrInvalidBoard,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			board, err := ParseBoardString(tc.input)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("ParseBoardString error = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if board.String() != easyPuzzleFixture {
				t.Fatalf("String() roundtrip mismatch: got %s", board.String())
			}
			if board.DotString() != easyDots {
				t.Fatalf("DotString() roundtrip mismatch: got %s", board.DotString())
			}
			if !board.Cells[0].Given || board.Cells[2].Given {
				t.Fatal("Given flags not set accurately")
			}
		})
	}
}

func TestPlaceAndEliminate(t *testing.T) {
	board, err := ParseBoardString(strings.Repeat("0", BoardSize))
	if err != nil {
		t.Fatalf("ParseBoardString failed: %v", err)
	}

	if err := board.Place(0, 6); err != nil {
		t.Fatalf("Place(0, 6) failed: %v", err)
	}
	if board.Cells[0].Value != 6 || board.Cells[0].Candidates != 0 {
		t.Fatalf("cell 0 state after Place = %+v", board.Cells[0])
	}
	for _, peer := range Peers[0] {
		if HasCandidate(board.Cells[peer].Candidates, 6) {
			t.Fatalf("peer %d still has candidate 6 after Place(0, 6)", peer)
		}
	}

	if err := board.Place(1, 6); !errors.Is(err, ErrInvalidBoard) {
		t.Fatalf("conflicting Place error = %v, want ErrInvalidBoard", err)
	}
	if !board.Eliminate(1, 5) || board.Eliminate(1, 5) {
		t.Fatal("Eliminate return value mismatch")
	}
}
