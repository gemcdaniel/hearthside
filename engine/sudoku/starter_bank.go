package sudoku

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	// StarterBankSeedStart is the first deterministic seed used for each difficulty tier
	// in the bundled 150-puzzle starter bank.
	StarterBankSeedStart uint64 = 1

	// StarterBankPerDifficulty is the number of puzzles per tier in the bundled starter bank.
	StarterBankPerDifficulty uint64 = 50
)

// FormatPuzzleID builds the canonical deterministic puzzle identifier for (version, diff, seed).
func FormatPuzzleID(version string, diff Difficulty, seed uint64) string {
	return fmt.Sprintf("hs-%s-%s-%016x", version, diff, seed)
}

// ParseStarterBankID parses a bundled starter-bank puzzle ID for the active EngineVersion.
func ParseStarterBankID(id string) (Difficulty, uint64, bool) {
	prefix := "hs-" + EngineVersion + "-"
	if !strings.HasPrefix(id, prefix) {
		return "", 0, false
	}

	rest := strings.TrimPrefix(id, prefix)
	sepIdx := strings.IndexByte(rest, '-')
	if sepIdx <= 0 {
		return "", 0, false
	}

	diff := Difficulty(rest[:sepIdx])
	switch diff {
	case DifficultyEasy, DifficultyMedium, DifficultyHard:
	default:
		return "", 0, false
	}

	hexPart := rest[sepIdx+1:]
	if len(hexPart) != 16 {
		return "", 0, false
	}
	for i := range len(hexPart) {
		ch := hexPart[i]
		isHexDigit := (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')
		if !isHexDigit {
			return "", 0, false
		}
	}

	seed, err := strconv.ParseUint(hexPart, 16, 64)
	if err != nil {
		return "", 0, false
	}
	if seed < StarterBankSeedStart || seed >= StarterBankSeedStart+StarterBankPerDifficulty {
		return "", 0, false
	}
	if FormatPuzzleID(EngineVersion, diff, seed) != id {
		return "", 0, false
	}
	return diff, seed, true
}

// GenerateStarterBankPuzzle deterministically regenerates a bundled starter-bank puzzle by ID.
// It returns found=false cleanly without error when id is outside the starter-bank schedule.
func GenerateStarterBankPuzzle(id string) (PuzzleRecord, bool, error) {
	diff, seed, ok := ParseStarterBankID(id)
	if !ok {
		return PuzzleRecord{}, false, nil
	}
	rec, err := Generate(seed, diff)
	if err != nil {
		return PuzzleRecord{}, false, fmt.Errorf("generate starter-bank puzzle %s: %w", id, err)
	}
	if rec.ID != id {
		return PuzzleRecord{}, false, nil
	}
	return rec, true, nil
}
