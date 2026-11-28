package leaderboards

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
	"github.com/gemcdaniel/hearthside/services/api/internal/puzzles"
)

func openTestEnv(t *testing.T) (*sql.DB, *auth.Store, *puzzles.Service, *Service, *time.Time) {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "leaderboards.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	now := time.Date(2026, 11, 28, 12, 0, 0, 0, time.UTC)
	nowFn := func() time.Time { return now }
	authStore := auth.NewStore(database, nowFn)
	puzzleSvc := puzzles.NewService(database, config.PuzzleConfig{}, nil, nowFn)
	lbSvc := NewService(database, puzzleSvc, nowFn)
	return database, authStore, puzzleSvc, lbSvc, &now
}

func TestSubmitValidationSourcesClampingAndRanking(t *testing.T) {
	ctx := context.Background()
	database, authStore, puzzleSvc, lbSvc, now := openTestEnv(t)

	boot, err := authStore.BootstrapWithPassword(ctx, auth.BootstrapInput{
		HouseholdName: "Cedar Home",
		DisplayName:   "Sam",
		Email:         "sam@example.com",
		Password:      "cedar-pass-1234",
	}, "")
	if err != nil {
		t.Fatalf("BootstrapWithPassword failed: %v", err)
	}
	adultID := boot.Profiles[0].ID

	child, err := authStore.CreateChildProfile(ctx, boot.Household.ID, auth.CreateProfileInput{
		Name: "Maya",
	})
	if err != nil {
		t.Fatalf("CreateChildProfile failed: %v", err)
	}

	// 1. Authoritative Daily puzzle validation via DailySeed even before /puzzles/daily is called.
	dailyDate := "2026-11-28"
	dailySeed, err := sudoku.DailySeed(dailyDate, sudoku.DifficultyEasy, sudoku.EngineVersion)
	if err != nil {
		t.Fatalf("DailySeed failed: %v", err)
	}
	dailyGen, err := sudoku.Generate(dailySeed, sudoku.DifficultyEasy)
	if err != nil {
		t.Fatalf("Generate daily failed: %v", err)
	}

	// Future completedAt is clamped to serverNow; tampered solution is rejected.
	tamperedFirst := "1"
	if dailyGen.Solution[0] == '1' {
		tamperedFirst = "2"
	}
	if _, err := lbSvc.SubmitResult(ctx, boot.Household.ID, SubmitResultInput{
		ProfileID:    adultID,
		GameID:       GameSudoku,
		PuzzleID:     dailyGen.ID,
		Mode:         ModeDaily,
		DailyDate:    dailyDate,
		SolutionGrid: tamperedFirst + dailyGen.Solution[1:],
		ElapsedMs:    30_000,
		HintsUsed:    0,
	}); !errors.Is(err, ErrInvalidSolution) {
		t.Fatalf("expected ErrInvalidSolution for tampered solution, got %v", err)
	}

	futureTime := now.Add(2 * time.Hour).Format(time.RFC3339)
	subAdult, err := lbSvc.SubmitResult(ctx, boot.Household.ID, SubmitResultInput{
		ProfileID:    adultID,
		GameID:       GameSudoku,
		PuzzleID:     dailyGen.ID,
		Mode:         ModeDaily,
		DailyDate:    dailyDate,
		SolutionGrid: dailyGen.Solution,
		ElapsedMs:    45_000,
		HintsUsed:    1,
		CompletedAt:  futureTime,
	})
	if err != nil {
		t.Fatalf("SubmitResult(daily adult) failed: %v", err)
	}
	if !subAdult.Created || subAdult.HouseholdRank != 1 || subAdult.TotalHouseholdEntries != 1 {
		t.Fatalf("unexpected subAdult response: %+v", subAdult)
	}
	wantClamped := now.UTC().Format(canonicalTimestampLayout)
	if subAdult.Entry.CompletedAt != wantClamped {
		t.Fatalf("clamped CompletedAt = %q, want %q", subAdult.Entry.CompletedAt, wantClamped)
	}

	// First-completion lock ignores faster duplicate submission.
	subDup, err := lbSvc.SubmitResult(ctx, boot.Household.ID, SubmitResultInput{
		ProfileID:    adultID,
		GameID:       GameSudoku,
		PuzzleID:     dailyGen.ID,
		Mode:         ModeDaily,
		DailyDate:    dailyDate,
		SolutionGrid: dailyGen.Solution,
		ElapsedMs:    12_000,
		HintsUsed:    0,
	})
	if err != nil {
		t.Fatalf("SubmitResult(duplicate) failed: %v", err)
	}
	if subDup.Created || subDup.Entry.ElapsedMs != 45_000 || subDup.Entry.HintsUsed != 1 {
		t.Fatalf("duplicate submission mutated canonical row: %+v", subDup)
	}

	// Same elapsedMs (45s), fewer hints (0 < 1) -> Child ranks #1 ahead of Adult!
	subChild, err := lbSvc.SubmitResult(ctx, boot.Household.ID, SubmitResultInput{
		ProfileID:    child.ID,
		GameID:       GameSudoku,
		PuzzleID:     dailyGen.ID,
		Mode:         ModeDaily,
		DailyDate:    dailyDate,
		SolutionGrid: dailyGen.Solution,
		ElapsedMs:    45_000,
		HintsUsed:    0,
		CompletedAt:  now.Add(-time.Minute).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("SubmitResult(daily child) failed: %v", err)
	}
	if subChild.HouseholdRank != 1 || subChild.TotalHouseholdEntries != 2 {
		t.Fatalf("expected child rank 1/2, got %+v", subChild)
	}

	// 2. Starter-bank standard puzzle authoritative lookup + noHintsOnly filter.
	starterRec, found, err := sudoku.GenerateStarterBankPuzzle("hs-0.1.0-dev-easy-0000000000000001")
	if err != nil || !found {
		t.Fatalf("GenerateStarterBankPuzzle failed: found=%v err=%v", found, err)
	}
	subStarter, err := lbSvc.SubmitResult(ctx, boot.Household.ID, SubmitResultInput{
		ProfileID:    child.ID,
		GameID:       GameSudoku,
		PuzzleID:     starterRec.ID,
		Mode:         ModeStandard,
		SolutionGrid: starterRec.Solution,
		ElapsedMs:    62_000,
		HintsUsed:    0,
	})
	if err != nil || !subStarter.Created {
		t.Fatalf("SubmitResult(starter) failed: %v", err)
	}

	// 3. SQLite bank puzzle authoritative lookup.
	bankGen, err := sudoku.Generate(1000042, sudoku.DifficultyMedium)
	if err != nil {
		t.Fatalf("Generate bank puzzle failed: %v", err)
	}
	techJSON, _ := json.Marshal(bankGen.TechniquesRequired)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO puzzles (id, game_id, kind, difficulty, seed, engine_version, clues, solution, techniques_required, created_at)
		VALUES (?, 'sudoku', 'bank', ?, ?, ?, ?, ?, ?, ?)
	`, bankGen.ID, string(bankGen.Difficulty), int64(bankGen.Seed), bankGen.EngineVersion, bankGen.Clues, bankGen.Solution, string(techJSON), wantClamped); err != nil {
		t.Fatalf("insert bank puzzle failed: %v", err)
	}
	if _, err := puzzleSvc.GetByID(ctx, bankGen.ID); err != nil {
		t.Fatalf("GetByID bank puzzle failed: %v", err)
	}
	subBank, err := lbSvc.SubmitResult(ctx, boot.Household.ID, SubmitResultInput{
		ProfileID:    adultID,
		GameID:       GameSudoku,
		PuzzleID:     bankGen.ID,
		Mode:         ModeStandard,
		SolutionGrid: bankGen.Solution,
		ElapsedMs:    88_000,
		HintsUsed:    2,
	})
	if err != nil || !subBank.Created {
		t.Fatalf("SubmitResult(bank) failed: %v", err)
	}

	dailyBoard, err := lbSvc.GetDailyLeaderboard(ctx, boot.Household.ID, DailyQueryOptions{
		Date:        dailyDate,
		Difficulty:  "easy",
		Scope:       ScopeHousehold,
		NoHintsOnly: true,
	})
	if err != nil {
		t.Fatalf("GetDailyLeaderboard(noHintsOnly) failed: %v", err)
	}
	if len(dailyBoard.Entries) != 1 || dailyBoard.Entries[0].ProfileID != child.ID {
		t.Fatalf("expected only hint-free child entry, got %+v", dailyBoard.Entries)
	}
}
