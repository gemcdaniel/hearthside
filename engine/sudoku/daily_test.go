package sudoku

import (
	"errors"
	"testing"
)

func TestDailySeedGoldenVectors(t *testing.T) {
	// Shared golden vectors verified bit-for-bit against games/sudoku/src/engine/daily.ts.
	vectors := []struct {
		date          string
		difficulty    Difficulty
		engineVersion string
		want          uint64
	}{
		{date: "2026-01-01", difficulty: DifficultyEasy, engineVersion: EngineVersion, want: 38857924464638},
		{date: "2026-01-01", difficulty: DifficultyMedium, engineVersion: EngineVersion, want: 7786398870909375},
		{date: "2026-01-01", difficulty: DifficultyHard, engineVersion: EngineVersion, want: 2509204912584121},
		{date: "2026-02-28", difficulty: DifficultyEasy, engineVersion: EngineVersion, want: 73372166395216},
		{date: "2026-02-28", difficulty: DifficultyMedium, engineVersion: EngineVersion, want: 8909620767171853},
		{date: "2026-02-28", difficulty: DifficultyHard, engineVersion: EngineVersion, want: 2803896412866403},
		{date: "2026-11-27", difficulty: DifficultyEasy, engineVersion: EngineVersion, want: 5384261240580451},
		{date: "2026-11-27", difficulty: DifficultyMedium, engineVersion: EngineVersion, want: 5038883581582286},
		{date: "2026-11-27", difficulty: DifficultyHard, engineVersion: EngineVersion, want: 4246444013539808},
		{date: "2027-06-15", difficulty: DifficultyEasy, engineVersion: EngineVersion, want: 3103044816375837},
		{date: "2027-06-15", difficulty: DifficultyMedium, engineVersion: EngineVersion, want: 6133141650307316},
		{date: "2027-06-15", difficulty: DifficultyHard, engineVersion: EngineVersion, want: 5926366238029018},
		{date: "2028-02-29", difficulty: DifficultyEasy, engineVersion: EngineVersion, want: 8820532581852875},
		{date: "2028-02-29", difficulty: DifficultyMedium, engineVersion: EngineVersion, want: 1530999194735286},
		{date: "2028-02-29", difficulty: DifficultyHard, engineVersion: EngineVersion, want: 4462973969286824},
		{date: "2026-11-27", difficulty: DifficultyMedium, engineVersion: "1.0.0", want: 3550963403440380},
	}

	for _, tc := range vectors {
		got, err := DailySeed(tc.date, tc.difficulty, tc.engineVersion)
		if err != nil {
			t.Fatalf("DailySeed(%q, %q, %q) returned error: %v", tc.date, tc.difficulty, tc.engineVersion, err)
		}
		if got != tc.want {
			t.Fatalf("DailySeed(%q, %q, %q) = %d, want %d", tc.date, tc.difficulty, tc.engineVersion, got, tc.want)
		}
		if got < 1 || got > safe53BitMask {
			t.Fatalf("DailySeed output %d outside 53-bit positive range", got)
		}
	}
}

func TestDailySeedValidation(t *testing.T) {
	badCases := []struct {
		name    string
		date    string
		diff    Difficulty
		version string
	}{
		{name: "short date", date: "2026-11-2", diff: DifficultyEasy, version: EngineVersion},
		{name: "invalid calendar date", date: "2027-02-29", diff: DifficultyEasy, version: EngineVersion},
		{name: "uppercase difficulty", date: "2026-11-27", diff: Difficulty("Easy"), version: EngineVersion},
		{name: "unknown difficulty", date: "2026-11-27", diff: Difficulty("extreme"), version: EngineVersion},
		{name: "empty engine version", date: "2026-11-27", diff: DifficultyMedium, version: ""},
	}

	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DailySeed(tc.date, tc.diff, tc.version); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput for %s, got %v", tc.name, err)
			}
		})
	}
}
