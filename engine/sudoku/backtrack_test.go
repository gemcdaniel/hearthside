package sudoku

import (
	"errors"
	"strings"
	"testing"
)

func TestCountSolutionsAndSolveBacktrack(t *testing.T) {
	unsolvableStr := "012345678" +
		"900000000" +
		strings.Repeat("0", 63)

	// Almost complete grid with 2 solutions (swap 1 and 2 in a 2x2 rectangle).
	// Start from solved easy puzzle and clear cells (0,0)=5? Better: remove 4 symmetric clues from solved grid.
	solvedEasy, ok, err := func() (Board, bool, error) {
		b, parseErr := ParseBoardString(easyPuzzleFixture)
		if parseErr != nil {
			return Board{}, false, parseErr
		}
		return b.SolveBacktrack()
	}()
	if err != nil || !ok {
		t.Fatalf("failed to solve easy puzzle for multi-solution fixture: ok=%v err=%v", ok, err)
	}

	tests := []struct {
		name      string
		board     func() Board
		wantCount int
		wantSolve bool
	}{
		{
			name: "unique easy puzzle",
			board: func() Board {
				b, _ := ParseBoardString(easyPuzzleFixture)
				return b
			},
			wantCount: 1,
			wantSolve: true,
		},
		{
			name: "unique hard puzzle",
			board: func() Board {
				b, _ := ParseBoardString(hardPuzzleFixture)
				return b
			},
			wantCount: 1,
			wantSolve: true,
		},
		{
			name: "unsolvable puzzle",
			board: func() Board {
				b, _ := ParseBoardString(unsolvableStr)
				return b
			},
			wantCount: 0,
			wantSolve: false,
		},
		{
			name: "empty board stops at limit 2",
			board: func() Board {
				b, _ := ParseBoardString(strings.Repeat("0", BoardSize))
				return b
			},
			wantCount: 2,
			wantSolve: false,
		},
		{
			name: "conflicting board returns 0",
			board: func() Board {
				var b Board
				b.Cells[0].Value = 4
				b.Cells[1].Value = 4
				return b
			},
			wantCount: 0,
			wantSolve: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b := tc.board()
			cnt, countErr := b.CountSolutions(2)
			if countErr != nil {
				t.Fatalf("CountSolutions unexpected error: %v", countErr)
			}
			if cnt != tc.wantCount {
				t.Fatalf("CountSolutions = %d, want %d", cnt, tc.wantCount)
			}

			solved, solvedOK, solveErr := b.SolveBacktrack()
			if solveErr != nil {
				t.Fatalf("SolveBacktrack unexpected error: %v", solveErr)
			}
			if solvedOK != tc.wantSolve {
				t.Fatalf("SolveBacktrack ok = %v, want %v", solvedOK, tc.wantSolve)
			}
			if tc.wantSolve {
				if !solved.IsSolved() {
					t.Fatal("SolveBacktrack returned unsolved board")
				}
				for i := range BoardSize {
					if b.Cells[i].Given && solved.Cells[i].Value != b.Cells[i].Value {
						t.Fatalf("SolveBacktrack altered given cell %d", i)
					}
					if solved.Cells[i].Given != b.Cells[i].Given {
						t.Fatalf("SolveBacktrack altered Given flag at cell %d", i)
					}
				}
			}
		})
	}

	if !solvedEasy.IsSolved() {
		t.Fatal("expected solvedEasy to be solved")
	}

	var invalidBoard Board
	invalidBoard.Cells[0].Value = 12
	if _, err := invalidBoard.CountSolutions(2); !errors.Is(err, ErrInvalidBoard) {
		t.Fatalf("expected ErrInvalidBoard for digit 12, got %v", err)
	}
}
