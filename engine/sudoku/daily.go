package sudoku

import (
	"fmt"
	"hash/fnv"
	"strings"
	"time"
)

const (
	safe53BitMask   uint64 = 0x1fffffffffffff
	dailyDateLayout        = "2006-01-02"
)

// DailySeed computes the canonical deterministic 53-bit-safe seed from
// (dateYYYYMMDD, difficulty, engineVersion), matching the TypeScript client's
// computeDailySeed FNV-1a 64-bit hash and 53-bit mask bit-for-bit.
func DailySeed(dateYYYYMMDD string, diff Difficulty, engineVersion string) (uint64, error) {
	if len(dateYYYYMMDD) != len(dailyDateLayout) {
		return 0, fmt.Errorf("%w: invalid daily date %q (expected YYYY-MM-DD)", ErrInvalidInput, dateYYYYMMDD)
	}
	parsed, err := time.Parse(dailyDateLayout, dateYYYYMMDD)
	if err != nil || parsed.Format(dailyDateLayout) != dateYYYYMMDD {
		return 0, fmt.Errorf("%w: invalid daily date %q (expected YYYY-MM-DD)", ErrInvalidInput, dateYYYYMMDD)
	}

	if diff != DifficultyEasy && diff != DifficultyMedium && diff != DifficultyHard {
		return 0, fmt.Errorf("%w: unsupported difficulty %q", ErrInvalidInput, diff)
	}

	if strings.TrimSpace(engineVersion) == "" {
		return 0, fmt.Errorf("%w: engineVersion must not be empty", ErrInvalidInput)
	}

	h := fnv.New64a()
	_, _ = h.Write([]byte(dateYYYYMMDD + ":" + string(diff) + ":" + engineVersion))
	masked := h.Sum64() & safe53BitMask
	if masked < 1 {
		return 1, nil
	}
	return masked, nil
}
