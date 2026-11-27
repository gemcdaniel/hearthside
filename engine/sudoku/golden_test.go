package sudoku

import (
	"errors"
	"testing"
)

func TestGoldenPuzzles(t *testing.T) {
	tests := []struct {
		name           string
		puzzle         string
		wantErr        error
		wantDifficulty Difficulty
	}{
		{
			name:           "golden easy puzzle",
			puzzle:         "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
			wantDifficulty: DifficultyEasy,
		},
		{
			name:           "golden medium puzzle (sudokuwiki naked pair)",
			puzzle:         "400000938032094100095300240370609004529001673604703090957008300003900400240030709",
			wantDifficulty: DifficultyMedium,
		},
		{
			name:           "golden hard puzzle (sudokuwiki x-wing)",
			puzzle:         "100000569492056108056109240009640801064010000218035604040500016905061402621000005",
			wantDifficulty: DifficultyHard,
		},
		{
			name:    "golden extreme requires guessing (arto inkala 2012)",
			puzzle:  "800000000003600000070090200050007000000045700000100030001000068008500010090000400",
			wantErr: ErrRequiresGuessing,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			board, err := ParseBoardString(tc.puzzle)
			if err != nil {
				t.Fatalf("ParseBoardString failed: %v", err)
			}

			count, err := board.CountSolutions(2)
			if err != nil {
				t.Fatalf("CountSolutions failed: %v", err)
			}
			if count != 1 {
				t.Fatalf("expected unique solution (1), got %d", count)
			}

			res, err := Grade(&board)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("Grade error = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Grade unexpected error: %v", err)
			}
			if res.Difficulty != tc.wantDifficulty {
				t.Fatalf("Grade difficulty = %q, want %q (techniques=%v, steps=%d)",
					res.Difficulty, tc.wantDifficulty, res.TechniquesRequired, res.StepCount)
			}
			if len(res.TechniquesRequired) == 0 || res.StepCount == 0 {
				t.Fatal("expected non-empty techniquesRequired and stepCount")
			}
		})
	}
}
