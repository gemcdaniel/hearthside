// Package leaderboards validates puzzle solutions authoritatively against SQLite/engine records
// and serves household and friends leaderboard rankings without exposing user PII.
package leaderboards

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/puzzles"
)

const (
	canonicalTimestampLayout = "2006-01-02T15:04:05.000000Z"
	dateLayout               = "2006-01-02"
	maxFutureSkew            = 5 * time.Minute
)

var allDifficulties = []sudoku.Difficulty{
	sudoku.DifficultyEasy,
	sudoku.DifficultyMedium,
	sudoku.DifficultyHard,
}

// Service validates submitted puzzle completions and queries scoped leaderboards.
type Service struct {
	db      *sql.DB
	puzzles *puzzles.Service
	now     func() time.Time

	starterMu    sync.RWMutex
	starterCache map[string]sudoku.PuzzleRecord
}

// NewService constructs a leaderboard Service backed by database and puzzleSvc.
func NewService(database *sql.DB, puzzleSvc *puzzles.Service, nowFn func() time.Time) *Service {
	if nowFn == nil {
		nowFn = time.Now
	}
	return &Service{
		db:           database,
		puzzles:      puzzleSvc,
		now:          nowFn,
		starterCache: make(map[string]sudoku.PuzzleRecord),
	}
}

type queryRower interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// SubmitResult validates solutionGrid authoritatively, enforces bounds, locks the first
// verified completion per (profileId, gameId, puzzleId), and returns household ranking metadata.
func (s *Service) SubmitResult(ctx context.Context, householdID string, in SubmitResultInput) (*SubmitResultResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("leaderboard database unavailable")
	}

	profileID := strings.TrimSpace(in.ProfileID)
	gameID := strings.TrimSpace(in.GameID)
	if gameID == "" {
		gameID = GameSudoku
	}
	puzzleID := strings.TrimSpace(in.PuzzleID)
	mode := strings.TrimSpace(in.Mode)
	dailyDate := strings.TrimSpace(in.DailyDate)

	if err := authorizeProfile(ctx, s.db, householdID, profileID); err != nil {
		return nil, err
	}
	if gameID != GameSudoku {
		return nil, fmt.Errorf("%w: unsupported gameId %q", ErrInvalidInput, gameID)
	}
	if puzzleID == "" || len(puzzleID) > 128 {
		return nil, fmt.Errorf("%w: puzzleId is required", ErrInvalidInput)
	}
	if mode != ModeStandard && mode != ModeDaily {
		return nil, fmt.Errorf("%w: mode must be standard or daily", ErrInvalidInput)
	}
	if mode == ModeDaily {
		if err := validateDateKey(dailyDate); err != nil {
			return nil, err
		}
	} else if dailyDate != "" {
		return nil, fmt.Errorf("%w: dailyDate is only allowed for daily mode", ErrInvalidInput)
	}

	if in.ElapsedMs < MinElapsedMs || in.ElapsedMs > MaxElapsedMs {
		return nil, fmt.Errorf("%w: elapsedMs must be between %d and %d", ErrInvalidInput, MinElapsedMs, MaxElapsedMs)
	}
	if in.HintsUsed < 0 {
		return nil, fmt.Errorf("%w: hintsUsed must be non-negative", ErrInvalidInput)
	}

	serverNow := s.now().UTC()
	completedAt, err := normalizeCompletedAt(in.CompletedAt, serverNow)
	if err != nil {
		return nil, err
	}
	submittedAt := serverNow.Format(canonicalTimestampLayout)

	authPuzzle, err := s.resolveAuthoritativePuzzle(ctx, puzzleID, mode, dailyDate)
	if err != nil {
		return nil, err
	}

	if !isValidSolutionGrid(in.SolutionGrid) || in.SolutionGrid != authPuzzle.Solution {
		return nil, ErrInvalidSolution
	}

	var dailyDateArg any
	if mode == ModeDaily {
		dailyDateArg = dailyDate
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin leaderboard submit tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := authorizeProfile(ctx, tx, householdID, profileID); err != nil {
		return nil, err
	}

	res, err := tx.ExecContext(ctx, `
		INSERT INTO leaderboard_entries (
			id, profile_id, household_id, game_id, puzzle_id,
			mode, daily_date, difficulty, elapsed_ms, hints_used,
			completed_at, submitted_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (profile_id, game_id, puzzle_id) DO NOTHING
	`, auth.NewID(), profileID, householdID, gameID, authPuzzle.ID, mode, dailyDateArg, string(authPuzzle.Difficulty), in.ElapsedMs, in.HintsUsed, completedAt, submittedAt)
	if err != nil {
		return nil, fmt.Errorf("insert leaderboard entry: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("check inserted leaderboard rows: %w", err)
	}

	householdEntries, err := queryRankedEntries(ctx, tx, householdID, `le.game_id = ? AND le.puzzle_id = ? AND le.household_id = ?`, gameID, authPuzzle.ID, householdID)
	if err != nil {
		return nil, err
	}

	var canonical LeaderboardEntry
	var found bool
	for _, entry := range householdEntries {
		if entry.ProfileID == profileID {
			canonical = entry
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("canonical leaderboard entry missing after insert")
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit leaderboard submit tx: %w", err)
	}

	return &SubmitResultResponse{
		Created:               affected == 1,
		Entry:                 canonical,
		HouseholdRank:         canonical.Rank,
		TotalHouseholdEntries: len(householdEntries),
	}, nil
}

// GetDailyLeaderboard returns the ranked Daily leaderboard filtered by date, difficulty, scope, and hints.
func (s *Service) GetDailyLeaderboard(ctx context.Context, householdID string, opts DailyQueryOptions) (*DailyLeaderboardResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("leaderboard database unavailable")
	}

	dateStr := strings.TrimSpace(opts.Date)
	if dateStr == "" {
		dateStr = s.now().UTC().Format(dateLayout)
	}
	if err := validateDateKey(dateStr); err != nil {
		return nil, err
	}

	diff, err := validateDifficulty(opts.Difficulty)
	if err != nil {
		return nil, err
	}

	scope, err := validateScope(opts.Scope)
	if err != nil {
		return nil, err
	}

	whereClause, args := buildScopedWhere(
		`le.game_id = ? AND le.mode = ? AND le.daily_date = ? AND le.difficulty = ?`,
		[]any{GameSudoku, ModeDaily, dateStr, string(diff)},
		householdID,
		scope,
		opts.NoHintsOnly,
	)

	entries, err := queryRankedEntries(ctx, s.db, householdID, whereClause, args...)
	if err != nil {
		return nil, err
	}

	return &DailyLeaderboardResponse{
		GameID:      GameSudoku,
		Date:        dateStr,
		Difficulty:  string(diff),
		Scope:       scope,
		NoHintsOnly: opts.NoHintsOnly,
		Entries:     entries,
	}, nil
}

// GetPuzzleLeaderboard returns the ranked leaderboard for puzzleID under scope and hint filtering.
func (s *Service) GetPuzzleLeaderboard(ctx context.Context, householdID, puzzleID string, opts QueryOptions) (*PuzzleLeaderboardResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("leaderboard database unavailable")
	}

	cleanPuzzleID := strings.TrimSpace(puzzleID)
	if cleanPuzzleID == "" || len(cleanPuzzleID) > 128 {
		return nil, fmt.Errorf("%w: puzzleId is required", ErrInvalidInput)
	}

	scope, err := validateScope(opts.Scope)
	if err != nil {
		return nil, err
	}

	whereClause, args := buildScopedWhere(
		`le.game_id = ? AND le.puzzle_id = ?`,
		[]any{GameSudoku, cleanPuzzleID},
		householdID,
		scope,
		opts.NoHintsOnly,
	)

	entries, err := queryRankedEntries(ctx, s.db, householdID, whereClause, args...)
	if err != nil {
		return nil, err
	}

	return &PuzzleLeaderboardResponse{
		GameID:      GameSudoku,
		PuzzleID:    cleanPuzzleID,
		Scope:       scope,
		NoHintsOnly: opts.NoHintsOnly,
		Entries:     entries,
	}, nil
}

// GetHouseholdDailySummary returns Today's Family Daily grid covering all profiles in householdID.
func (s *Service) GetHouseholdDailySummary(ctx context.Context, householdID, dateYYYYMMDD string) (*HouseholdDailySummaryResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("leaderboard database unavailable")
	}

	dateStr := strings.TrimSpace(dateYYYYMMDD)
	if dateStr == "" {
		dateStr = s.now().UTC().Format(dateLayout)
	}
	if err := validateDateKey(dateStr); err != nil {
		return nil, err
	}

	var householdName string
	if err := s.db.QueryRowContext(ctx, `SELECT name FROM households WHERE id = ?`, householdID).Scan(&householdName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query household name: %w", err)
	}

	profileRows, err := s.db.QueryContext(ctx, `
		SELECT id, name, avatar_id, accent_color, is_child, friends_visible
		FROM profiles
		WHERE household_id = ?
		ORDER BY is_child ASC, name COLLATE NOCASE ASC, id ASC
	`, householdID)
	if err != nil {
		return nil, fmt.Errorf("query household summary profiles: %w", err)
	}
	defer func() {
		_ = profileRows.Close()
	}()

	profiles := make([]HouseholdDailyProfileSummary, 0)
	indexByID := make(map[string]int)
	for profileRows.Next() {
		var p HouseholdDailyProfileSummary
		var isChildInt, friendsVisibleInt int
		if err := profileRows.Scan(&p.ProfileID, &p.ProfileName, &p.AvatarID, &p.AccentColor, &isChildInt, &friendsVisibleInt); err != nil {
			return nil, fmt.Errorf("scan household summary profile: %w", err)
		}
		p.IsChild = isChildInt == 1
		p.FriendsVisible = friendsVisibleInt == 1
		indexByID[p.ProfileID] = len(profiles)
		profiles = append(profiles, p)
	}
	if err := profileRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate household summary profiles: %w", err)
	}

	entryRows, err := s.db.QueryContext(ctx, `
		SELECT profile_id, difficulty, elapsed_ms, hints_used, completed_at
		FROM leaderboard_entries
		WHERE household_id = ? AND game_id = ? AND mode = ? AND daily_date = ?
	`, householdID, GameSudoku, ModeDaily, dateStr)
	if err != nil {
		return nil, fmt.Errorf("query household daily entries: %w", err)
	}
	defer func() {
		_ = entryRows.Close()
	}()

	for entryRows.Next() {
		var pid, diffStr, completedAt string
		var elapsedMs int64
		var hintsUsed int
		if err := entryRows.Scan(&pid, &diffStr, &elapsedMs, &hintsUsed, &completedAt); err != nil {
			return nil, fmt.Errorf("scan household daily entry: %w", err)
		}
		idx, ok := indexByID[pid]
		if !ok {
			continue
		}
		elapsedCopy := elapsedMs
		hintsCopy := hintsUsed
		status := DailyTierStatus{
			Solved:      true,
			ElapsedMs:   &elapsedCopy,
			HintsUsed:   &hintsCopy,
			CompletedAt: completedAt,
		}
		switch sudoku.Difficulty(diffStr) {
		case sudoku.DifficultyEasy:
			profiles[idx].Easy = status
		case sudoku.DifficultyMedium:
			profiles[idx].Medium = status
		case sudoku.DifficultyHard:
			profiles[idx].Hard = status
		}
	}
	if err := entryRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate household daily entries: %w", err)
	}

	return &HouseholdDailySummaryResponse{
		GameID:        GameSudoku,
		Date:          dateStr,
		HouseholdName: householdName,
		Profiles:      profiles,
	}, nil
}

func (s *Service) resolveAuthoritativePuzzle(ctx context.Context, puzzleID, mode, dailyDate string) (puzzles.Puzzle, error) {
	if s.puzzles != nil {
		p, err := s.puzzles.GetByID(ctx, puzzleID)
		if err == nil {
			if mode == ModeDaily {
				if err := s.verifyMatchesDaily(ctx, dailyDate, p.Difficulty, p.ID); err != nil {
					return puzzles.Puzzle{}, err
				}
			}
			return p, nil
		}
		if !errors.Is(err, puzzles.ErrNotFound) {
			return puzzles.Puzzle{}, err
		}

		if mode == ModeDaily {
			for _, diff := range allDifficulties {
				seed, seedErr := sudoku.DailySeed(dailyDate, diff, sudoku.EngineVersion)
				if seedErr != nil {
					return puzzles.Puzzle{}, fmt.Errorf("%w: %w", ErrInvalidInput, seedErr)
				}
				if sudoku.FormatPuzzleID(sudoku.EngineVersion, diff, seed) != puzzleID {
					continue
				}
				daily, dailyErr := s.puzzles.GetDaily(ctx, dailyDate, diff)
				if dailyErr != nil {
					if errors.Is(dailyErr, puzzles.ErrDateOutOfRange) || errors.Is(dailyErr, puzzles.ErrInvalidInput) {
						return puzzles.Puzzle{}, fmt.Errorf("%w: %w", ErrInvalidInput, dailyErr)
					}
					return puzzles.Puzzle{}, dailyErr
				}
				if daily.ID == puzzleID {
					return daily, nil
				}
			}
		}
	}

	starter, found, err := s.resolveStarterBankPuzzle(puzzleID)
	if err != nil {
		return puzzles.Puzzle{}, err
	}
	if found {
		if mode == ModeDaily && s.puzzles != nil {
			if err := s.verifyMatchesDaily(ctx, dailyDate, starter.Difficulty, starter.ID); err != nil {
				return puzzles.Puzzle{}, err
			}
		}
		return puzzleFromEngineRecord(starter), nil
	}

	return puzzles.Puzzle{}, ErrPuzzleNotFound
}

func (s *Service) verifyMatchesDaily(ctx context.Context, dailyDate string, diff sudoku.Difficulty, puzzleID string) error {
	daily, err := s.puzzles.GetDaily(ctx, dailyDate, diff)
	if err != nil {
		if errors.Is(err, puzzles.ErrDateOutOfRange) || errors.Is(err, puzzles.ErrInvalidInput) {
			return fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return err
	}
	if daily.ID != puzzleID {
		return fmt.Errorf("%w: puzzleId does not match daily puzzle for %s (%s)", ErrInvalidInput, dailyDate, diff)
	}
	return nil
}

func (s *Service) resolveStarterBankPuzzle(puzzleID string) (sudoku.PuzzleRecord, bool, error) {
	s.starterMu.RLock()
	cached, ok := s.starterCache[puzzleID]
	s.starterMu.RUnlock()
	if ok {
		return cached, true, nil
	}

	rec, found, err := sudoku.GenerateStarterBankPuzzle(puzzleID)
	if err != nil || !found {
		return sudoku.PuzzleRecord{}, found, err
	}

	s.starterMu.Lock()
	if existing, exists := s.starterCache[puzzleID]; exists {
		s.starterMu.Unlock()
		return existing, true, nil
	}
	s.starterCache[puzzleID] = rec
	s.starterMu.Unlock()
	return rec, true, nil
}

func puzzleFromEngineRecord(rec sudoku.PuzzleRecord) puzzles.Puzzle {
	techs := make([]string, 0, len(rec.TechniquesRequired))
	for _, tech := range rec.TechniquesRequired {
		techs = append(techs, string(tech))
	}
	return puzzles.Puzzle{
		ID:                 rec.ID,
		Seed:               rec.Seed,
		EngineVersion:      rec.EngineVersion,
		Difficulty:         rec.Difficulty,
		TechniquesRequired: techs,
		Clues:              rec.Clues,
		Solution:           rec.Solution,
	}
}

func authorizeProfile(ctx context.Context, q queryRower, householdID, profileID string) error {
	trimmedHousehold := strings.TrimSpace(householdID)
	trimmedProfile := strings.TrimSpace(profileID)
	if trimmedHousehold == "" || trimmedProfile == "" {
		return ErrNotFound
	}

	var ownerHouseholdID string
	err := q.QueryRowContext(ctx, `SELECT household_id FROM profiles WHERE id = ?`, trimmedProfile).Scan(&ownerHouseholdID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("query profile household: %w", err)
	}
	if ownerHouseholdID != trimmedHousehold {
		return ErrNotFound
	}
	return nil
}

func buildScopedWhere(baseWhere string, baseArgs []any, householdID, scope string, noHintsOnly bool) (string, []any) {
	var b strings.Builder
	b.WriteString(baseWhere)
	args := append([]any(nil), baseArgs...)

	if scope == ScopeHousehold {
		b.WriteString(` AND le.household_id = ?`)
		args = append(args, householdID)
	} else {
		b.WriteString(` AND p.friends_visible = 1`)
	}

	if noHintsOnly {
		b.WriteString(` AND le.hints_used = 0`)
	}

	return b.String(), args
}

func queryRankedEntries(ctx context.Context, q queryRower, callerHouseholdID, whereClause string, args ...any) ([]LeaderboardEntry, error) {
	query := `
		SELECT le.profile_id, p.name, p.avatar_id, p.accent_color, p.is_child,
		       h.id, h.name, le.elapsed_ms, le.hints_used, le.completed_at
		FROM leaderboard_entries le
		JOIN profiles p ON p.id = le.profile_id
		JOIN households h ON h.id = le.household_id
		WHERE ` + whereClause + `
		ORDER BY le.elapsed_ms ASC, le.hints_used ASC, le.completed_at ASC, le.submitted_at ASC, le.id ASC
	`

	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query leaderboard entries: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	entries := make([]LeaderboardEntry, 0)
	rank := 1
	for rows.Next() {
		var entry LeaderboardEntry
		var isChildInt int
		var entryHouseholdID string
		if err := rows.Scan(
			&entry.ProfileID,
			&entry.ProfileName,
			&entry.AvatarID,
			&entry.AccentColor,
			&isChildInt,
			&entryHouseholdID,
			&entry.HouseholdName,
			&entry.ElapsedMs,
			&entry.HintsUsed,
			&entry.CompletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan leaderboard entry: %w", err)
		}
		entry.Rank = rank
		entry.IsChild = isChildInt == 1
		entry.IsOwnHousehold = entryHouseholdID == callerHouseholdID
		entries = append(entries, entry)
		rank++
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate leaderboard entries: %w", err)
	}

	return entries, nil
}

func validateDateKey(raw string) error {
	if len(raw) != len(dateLayout) {
		return fmt.Errorf("%w: date must use YYYY-MM-DD format", ErrInvalidInput)
	}
	parsed, err := time.Parse(dateLayout, raw)
	if err != nil || parsed.Format(dateLayout) != raw {
		return fmt.Errorf("%w: invalid calendar date %q", ErrInvalidInput, raw)
	}
	return nil
}

func validateDifficulty(raw string) (sudoku.Difficulty, error) {
	diff := sudoku.Difficulty(strings.TrimSpace(raw))
	switch diff {
	case sudoku.DifficultyEasy, sudoku.DifficultyMedium, sudoku.DifficultyHard:
		return diff, nil
	default:
		return "", fmt.Errorf("%w: difficulty must be easy, medium, or hard", ErrInvalidInput)
	}
}

func validateScope(raw string) (string, error) {
	scope := strings.TrimSpace(raw)
	if scope == "" {
		return ScopeHousehold, nil
	}
	if scope != ScopeHousehold && scope != ScopeFriends {
		return "", fmt.Errorf("%w: scope must be household or friends", ErrInvalidInput)
	}
	return scope, nil
}

func normalizeCompletedAt(raw string, serverNow time.Time) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return serverNow.Format(canonicalTimestampLayout), nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, trimmed)
		if err != nil {
			return "", fmt.Errorf("%w: completedAt must be valid RFC3339", ErrInvalidInput)
		}
	}
	parsedUTC := parsed.UTC()
	if parsedUTC.After(serverNow.Add(maxFutureSkew)) {
		parsedUTC = serverNow
	}
	return parsedUTC.Format(canonicalTimestampLayout), nil
}

func isValidSolutionGrid(grid string) bool {
	if len(grid) != sudoku.BoardSize {
		return false
	}
	for i := range len(grid) {
		ch := grid[i]
		if ch < '1' || ch > '9' {
			return false
		}
	}
	return true
}
