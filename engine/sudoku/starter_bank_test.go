package sudoku

import "testing"

func TestParseStarterBankID(t *testing.T) {
	cases := []struct {
		id       string
		wantOK   bool
		wantDiff Difficulty
		wantSeed uint64
	}{
		{
			id:       FormatPuzzleID(EngineVersion, DifficultyEasy, 1),
			wantOK:   true,
			wantDiff: DifficultyEasy,
			wantSeed: 1,
		},
		{
			id:       FormatPuzzleID(EngineVersion, DifficultyMedium, 25),
			wantOK:   true,
			wantDiff: DifficultyMedium,
			wantSeed: 25,
		},
		{
			id:       FormatPuzzleID(EngineVersion, DifficultyHard, 50),
			wantOK:   true,
			wantDiff: DifficultyHard,
			wantSeed: 50,
		},
		{id: FormatPuzzleID(EngineVersion, DifficultyEasy, 0), wantOK: false},
		{id: FormatPuzzleID(EngineVersion, DifficultyHard, 51), wantOK: false},
		{id: "hs-0.1.0-dev-easy-000000000000000A", wantOK: false},
		{id: "hs-0.1.0-dev-easy-00000000000001", wantOK: false},
		{id: "hs-0.1.0-dev-expert-0000000000000001", wantOK: false},
		{id: "hs-other-easy-0000000000000001", wantOK: false},
		{id: "", wantOK: false},
	}

	for _, tc := range cases {
		diff, seed, ok := ParseStarterBankID(tc.id)
		if ok != tc.wantOK {
			t.Fatalf("ParseStarterBankID(%q) ok = %v, want %v", tc.id, ok, tc.wantOK)
		}
		if ok && (diff != tc.wantDiff || seed != tc.wantSeed) {
			t.Fatalf("ParseStarterBankID(%q) = (%s, %d), want (%s, %d)", tc.id, diff, seed, tc.wantDiff, tc.wantSeed)
		}
	}
}

func TestGenerateStarterBankPuzzle(t *testing.T) {
	id := "hs-0.1.0-dev-easy-0000000000000001"
	rec, found, err := GenerateStarterBankPuzzle(id)
	if err != nil {
		t.Fatalf("GenerateStarterBankPuzzle(%q) returned error: %v", id, err)
	}
	if !found {
		t.Fatalf("GenerateStarterBankPuzzle(%q) found = false, want true", id)
	}
	wantClues := "000008050000370602080050009030000590015000230078000010200040060301027000060100000"
	wantSolution := "723968154549371682186254379432716598615489237978532416257843961391627845864195723"
	if rec.Clues != wantClues {
		t.Fatalf("clues mismatch:\n got: %s\nwant: %s", rec.Clues, wantClues)
	}
	if rec.Solution != wantSolution {
		t.Fatalf("solution mismatch:\n got: %s\nwant: %s", rec.Solution, wantSolution)
	}

	if _, found, err := GenerateStarterBankPuzzle("hs-0.1.0-dev-easy-0000000000000099"); err != nil || found {
		t.Fatalf("out-of-range seed should return found=false, nil; got found=%v err=%v", found, err)
	}
}
