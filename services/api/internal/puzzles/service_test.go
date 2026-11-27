package puzzles

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

func openPuzzleTestDB(t *testing.T) (*Service, config.PuzzleConfig) {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "puzzles.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}
	cfg := config.PuzzleConfig{
		SchedulerEnabled:   false,
		PoolTarget:         2,
		PoolLowWater:       2,
		PoolMaxTotal:       3,
		DailyLookaheadDays: 0,
	}
	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	return NewService(database, cfg, nil, func() time.Time { return now }), cfg
}

func TestDailyGenerationCachingConcurrencyAndWindow(t *testing.T) {
	svc, _ := openPuzzleTestDB(t)
	ctx := context.Background()
	dateStr := "2026-11-27"

	const workers = 6
	results := make([]Puzzle, workers)
	errs := make([]error, workers)
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := range workers {
		go func(idx int) {
			defer wg.Done()
			results[idx], errs[idx] = svc.GetDaily(ctx, dateStr, sudoku.DifficultyEasy)
		}(i)
	}
	wg.Wait()

	wantSeed, err := sudoku.DailySeed(dateStr, sudoku.DifficultyEasy, sudoku.EngineVersion)
	if err != nil {
		t.Fatalf("DailySeed failed: %v", err)
	}

	for i := range workers {
		if errs[i] != nil {
			t.Fatalf("worker %d GetDaily failed: %v", i, errs[i])
		}
		if results[i].Seed != wantSeed || results[i].ID != results[0].ID || results[i].Clues != results[0].Clues {
			t.Fatalf("worker %d mismatch: %+v vs %+v", i, results[i], results[0])
		}
	}

	board, err := sudoku.ParseBoardString(results[0].Clues)
	if err != nil {
		t.Fatalf("ParseBoardString failed: %v", err)
	}
	if sols, countErr := sudoku.CountSolutions(board, 2); countErr != nil || sols != 1 {
		t.Fatalf("daily puzzle solutions = %d err=%v, want 1", sols, countErr)
	}

	// Out-of-window and malformed dates fail cleanly.
	if _, err := svc.GetDaily(ctx, "2026-10-27", sudoku.DifficultyEasy); !errors.Is(err, ErrDateOutOfRange) {
		t.Fatalf("expected ErrDateOutOfRange for today-31d, got %v", err)
	}
	if _, err := svc.GetDaily(ctx, "2026-11-30", sudoku.DifficultyEasy); !errors.Is(err, ErrDateOutOfRange) {
		t.Fatalf("expected ErrDateOutOfRange for today+3d, got %v", err)
	}
	if _, err := svc.GetDaily(ctx, "2026-13-01", sudoku.DifficultyEasy); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for invalid calendar date, got %v", err)
	}

	// GetByID retrieves the generated daily puzzle and returns ErrNotFound for missing IDs.
	gotByID, err := svc.GetByID(ctx, results[0].ID)
	if err != nil || gotByID.Clues != results[0].Clues {
		t.Fatalf("GetByID failed: %+v err=%v", gotByID, err)
	}
	if _, err := svc.GetByID(ctx, "does-not-exist"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestBankSchedulerPaginationLowWaterAndCap(t *testing.T) {
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "scheduler.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	defer func() {
		_ = database.Close()
	}()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	cfg := config.PuzzleConfig{
		SchedulerEnabled:   true,
		PoolTarget:         2,
		PoolLowWater:       2,
		PoolMaxTotal:       3,
		DailyLookaheadDays: 0,
	}
	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	svc := NewService(database, cfg, nil, func() time.Time { return now })

	schedCtx, cancel := context.WithCancel(ctx)
	svc.Start(schedCtx)
	defer func() {
		cancel()
		svc.Wait()
	}()

	// Wait for scheduler to reach initial PoolTarget (2) for all 3 difficulties.
	deadline := time.Now().Add(20 * time.Second)
	for {
		page, err := svc.GetBank(ctx, sudoku.DifficultyEasy, 0, 10)
		if err == nil && len(page.Puzzles) >= 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for initial bank generation")
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Page 1 (limit=1) checks cursor pagination and starter-bank non-collision seed >= 1000000.
	page1, err := svc.GetBank(ctx, sudoku.DifficultyEasy, 0, 1)
	if err != nil {
		t.Fatalf("GetBank page 1 failed: %v", err)
	}
	if len(page1.Puzzles) != 1 || !page1.HasMore || page1.NextSeq != page1.Puzzles[0].Seq {
		t.Fatalf("unexpected page1: %+v", page1)
	}
	p0 := page1.Puzzles[0]
	if p0.Seed < 1000000 || len(p0.TechniquesRequired) == 0 {
		t.Fatalf("unexpected generated bank puzzle metadata: %+v", p0)
	}
	board, err := sudoku.ParseBoardString(p0.Clues)
	if err != nil {
		t.Fatalf("ParseBoardString failed: %v", err)
	}
	if sols, countErr := sudoku.CountSolutions(board, 2); countErr != nil || sols != 1 {
		t.Fatalf("stored bank puzzle is not uniquely solvable: sols=%d err=%v", sols, countErr)
	}

	// Reading ahead past nextSeq leaves remaining < PoolLowWater (2), triggering async refill up to PoolMaxTotal (3).
	page2, err := svc.GetBank(ctx, sudoku.DifficultyEasy, page1.NextSeq, 5)
	if err != nil {
		t.Fatalf("GetBank page 2 failed: %v", err)
	}
	if len(page2.Puzzles) < 1 {
		t.Fatalf("expected at least 1 puzzle in page 2")
	}

	refillDeadline := time.Now().Add(15 * time.Second)
	for {
		var count int
		_ = database.QueryRowContext(ctx, `SELECT COUNT(*) FROM puzzles WHERE kind = 'bank' AND difficulty = 'easy'`).Scan(&count)
		if count == 3 {
			break
		}
		if count > 3 {
			t.Fatalf("exceeded PoolMaxTotal (3): got %d", count)
		}
		if time.Now().After(refillDeadline) {
			t.Fatalf("timed out waiting for low-water refill to PoolMaxTotal (3), count=%d", count)
		}
		time.Sleep(50 * time.Millisecond)
	}

	cancel()
	svc.Wait()
}
