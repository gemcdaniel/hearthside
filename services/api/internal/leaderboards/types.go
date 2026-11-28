package leaderboards

import "errors"

// Domain errors returned by Service methods.
var (
	ErrNotFound        = errors.New("not found")
	ErrPuzzleNotFound  = errors.New("puzzle not found")
	ErrInvalidInput    = errors.New("invalid leaderboard input")
	ErrInvalidSolution = errors.New("submitted solution does not match puzzle solution")
)

// Leaderboard constraints, scopes, and game modes (D35–D37).
const (
	GameSudoku = "sudoku"

	ModeStandard = "standard"
	ModeDaily    = "daily"

	ScopeHousehold = "household"
	ScopeFriends   = "friends"

	MinElapsedMs int64 = 1_000
	MaxElapsedMs int64 = 86_400_000
)

// SubmitResultInput describes a completed puzzle submission to verify and record.
type SubmitResultInput struct {
	ProfileID    string `json:"profileId"`
	GameID       string `json:"gameId"`
	PuzzleID     string `json:"puzzleId"`
	Mode         string `json:"mode"`
	DailyDate    string `json:"dailyDate,omitempty"`
	SolutionGrid string `json:"solutionGrid"`
	ElapsedMs    int64  `json:"elapsedMs"`
	HintsUsed    int    `json:"hintsUsed"`
	CompletedAt  string `json:"completedAt,omitempty"`
}

// LeaderboardEntry is a zero-PII ranked entry row (never exposing emails or user IDs).
type LeaderboardEntry struct {
	Rank           int    `json:"rank"`
	ProfileID      string `json:"profileId"`
	ProfileName    string `json:"profileName"`
	AvatarID       string `json:"avatarId"`
	AccentColor    string `json:"accentColor"`
	IsChild        bool   `json:"isChild"`
	HouseholdName  string `json:"householdName"`
	IsOwnHousehold bool   `json:"isOwnHousehold"`
	ElapsedMs      int64  `json:"elapsedMs"`
	HintsUsed      int    `json:"hintsUsed"`
	CompletedAt    string `json:"completedAt"`
}

// SubmitResultResponse reports whether a verified completion created the canonical lock entry.
type SubmitResultResponse struct {
	Created               bool             `json:"created"`
	Entry                 LeaderboardEntry `json:"entry"`
	HouseholdRank         int              `json:"householdRank"`
	TotalHouseholdEntries int              `json:"totalHouseholdEntries"`
}

// QueryOptions configures scope and hint filtering on leaderboard queries.
type QueryOptions struct {
	Scope       string
	NoHintsOnly bool
}

// DailyQueryOptions configures a Daily leaderboard query.
type DailyQueryOptions struct {
	Date        string
	Difficulty  string
	Scope       string
	NoHintsOnly bool
}

// DailyLeaderboardResponse returns the ranked Daily leaderboard for a date, difficulty, and scope.
type DailyLeaderboardResponse struct {
	GameID      string             `json:"gameId"`
	Date        string             `json:"date"`
	Difficulty  string             `json:"difficulty"`
	Scope       string             `json:"scope"`
	NoHintsOnly bool               `json:"noHintsOnly"`
	Entries     []LeaderboardEntry `json:"entries"`
}

// PuzzleLeaderboardResponse returns the ranked leaderboard for a specific puzzleId and scope.
type PuzzleLeaderboardResponse struct {
	GameID      string             `json:"gameId"`
	PuzzleID    string             `json:"puzzleId"`
	Scope       string             `json:"scope"`
	NoHintsOnly bool               `json:"noHintsOnly"`
	Entries     []LeaderboardEntry `json:"entries"`
}

// DailyTierStatus holds one profile's Daily completion status for a difficulty tier.
type DailyTierStatus struct {
	Solved      bool   `json:"solved"`
	ElapsedMs   *int64 `json:"elapsedMs,omitempty"`
	HintsUsed   *int   `json:"hintsUsed,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
}

// HouseholdDailyProfileSummary summarizes one household member's Today's Family Daily progress.
type HouseholdDailyProfileSummary struct {
	ProfileID      string          `json:"profileId"`
	ProfileName    string          `json:"profileName"`
	AvatarID       string          `json:"avatarId"`
	AccentColor    string          `json:"accentColor"`
	IsChild        bool            `json:"isChild"`
	FriendsVisible bool            `json:"friendsVisible"`
	Easy           DailyTierStatus `json:"easy"`
	Medium         DailyTierStatus `json:"medium"`
	Hard           DailyTierStatus `json:"hard"`
}

// HouseholdDailySummaryResponse summarizes Daily Puzzle progress across all household profiles.
type HouseholdDailySummaryResponse struct {
	GameID        string                         `json:"gameId"`
	Date          string                         `json:"date"`
	HouseholdName string                         `json:"householdName"`
	Profiles      []HouseholdDailyProfileSummary `json:"profiles"`
}
