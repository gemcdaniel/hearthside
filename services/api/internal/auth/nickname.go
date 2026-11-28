package auth

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MaxNicknameLength limits profile nicknames displayed on household and friends leaderboards (D38).
const MaxNicknameLength = 24

// ErrInvalidNickname indicates a profile nickname violates D38 child-safe formatting rules.
var ErrInvalidNickname = errors.New("invalid nickname")

var forbiddenURLFragments = []string{
	"http://",
	"https://",
	"://",
	"www.",
	".com",
	".net",
	".org",
	".io",
	".co",
	".gg",
	".tv",
	".me",
	".info",
	".biz",
	".edu",
	".gov",
}

// ValidateNickname normalizes and validates a profile nickname under D38 guardrails:
// collapses internal whitespace runs, enforces 1..24 runes of Unicode letters, digits,
// spaces, hyphens, and apostrophes, and rejects control characters, markup, or URLs.
func ValidateNickname(raw string) (string, error) {
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", fmt.Errorf("%w: control characters are not allowed", ErrInvalidNickname)
		}
	}

	if strings.ContainsAny(raw, "<>") {
		return "", fmt.Errorf("%w: markup brackets are not allowed", ErrInvalidNickname)
	}

	normalized := strings.Join(strings.Fields(raw), " ")
	if normalized == "" {
		return "", fmt.Errorf("%w: nickname must not be empty", ErrInvalidNickname)
	}

	lower := strings.ToLower(normalized)
	for _, frag := range forbiddenURLFragments {
		if strings.Contains(lower, frag) {
			return "", fmt.Errorf("%w: links and URLs are not allowed", ErrInvalidNickname)
		}
	}

	if utf8.RuneCountInString(normalized) > MaxNicknameLength {
		return "", fmt.Errorf("%w: nickname exceeds %d characters", ErrInvalidNickname, MaxNicknameLength)
	}

	for _, r := range normalized {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ' ' || r == '-' || r == '\'' {
			continue
		}
		return "", fmt.Errorf("%w: only letters, numbers, spaces, hyphens, and apostrophes are allowed", ErrInvalidNickname)
	}

	return normalized, nil
}
