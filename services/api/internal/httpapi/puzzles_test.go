package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
	"github.com/gemcdaniel/hearthside/services/api/internal/puzzles"
)

func TestPuzzleEndpointsAuthDailyBankAndByID(t *testing.T) {
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "http-puzzles.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	defer func() {
		_ = database.Close()
	}()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	// Pre-seed 3 deterministic easy bank puzzles above starter-bank seed range.
	for i := range 3 {
		rec, genErr := sudoku.Generate(uint64(1000000+i), sudoku.DifficultyEasy)
		if genErr != nil {
			t.Fatalf("Generate easy(%d) failed: %v", i, genErr)
		}
		techJSON, _ := json.Marshal(rec.TechniquesRequired)
		if _, err := database.ExecContext(ctx, `
			INSERT INTO puzzles (id, game_id, kind, difficulty, seed, engine_version, clues, solution, techniques_required)
			VALUES (?, 'sudoku', 'bank', ?, ?, ?, ?, ?, ?)
		`, rec.ID, string(rec.Difficulty), int64(rec.Seed), rec.EngineVersion, rec.Clues, rec.Solution, string(techJSON)); err != nil {
			t.Fatalf("seed bank puzzle %d failed: %v", i, err)
		}
	}

	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	cfg := config.Config{
		Addr:          config.DefaultAddr,
		PublicBaseURL: testPublicBaseURL,
		CookieSecure:  false,
		LogLevel:      config.DefaultLogLevel,
		Puzzles: config.PuzzleConfig{
			SchedulerEnabled:   false,
			PoolTarget:         10,
			PoolLowWater:       2,
			PoolMaxTotal:       50,
			DailyLookaheadDays: 0,
		},
	}
	handler := NewHandler(Dependencies{
		DB:     database,
		Config: cfg,
		Now:    func() time.Time { return now },
	})

	// 1. All puzzle endpoints reject unauthenticated requests with 401.
	for _, path := range []string{
		"/api/v1/puzzles/daily",
		"/api/v1/puzzles/bank?difficulty=easy",
		"/api/v1/puzzles/some-id",
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated GET %s = %d, want 401", path, rec.Code)
		}
	}

	// Bootstrap user to get a valid session cookie.
	bootBody := `{"householdName":"Test Home","displayName":"Owner","email":"owner@example.com","password":"owner-password-123"}`
	bootReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/bootstrap", strings.NewReader(bootBody))
	bootReq.Header.Set("Origin", testPublicBaseURL)
	bootReq.Header.Set("Content-Type", "application/json")
	bootRec := httptest.NewRecorder()
	handler.ServeHTTP(bootRec, bootReq)
	if bootRec.Code != http.StatusCreated {
		t.Fatalf("bootstrap = %d (%s)", bootRec.Code, bootRec.Body.String())
	}
	cookie := extractSessionCookie(t, bootRec)

	doAuthGet := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// 2. Daily single difficulty returns matching DailySeed puzzle.
	singleDailyRec := doAuthGet("/api/v1/puzzles/daily?date=2026-11-27&difficulty=medium")
	if singleDailyRec.Code != http.StatusOK {
		t.Fatalf("single daily = %d (%s)", singleDailyRec.Code, singleDailyRec.Body.String())
	}
	var singleResp struct {
		Date   string         `json:"date"`
		Puzzle puzzles.Puzzle `json:"puzzle"`
	}
	if err := json.NewDecoder(singleDailyRec.Body).Decode(&singleResp); err != nil {
		t.Fatalf("decode single daily: %v", err)
	}
	wantSeed, _ := sudoku.DailySeed("2026-11-27", sudoku.DifficultyMedium, sudoku.EngineVersion)
	if singleResp.Date != "2026-11-27" || singleResp.Puzzle.Seed != wantSeed || singleResp.Puzzle.Difficulty != sudoku.DifficultyMedium {
		t.Fatalf("unexpected single daily response: %+v (want seed %d)", singleResp, wantSeed)
	}

	// 3. Daily without query params returns UTC today and all 3 difficulties.
	allDailyRec := doAuthGet("/api/v1/puzzles/daily")
	if allDailyRec.Code != http.StatusOK {
		t.Fatalf("all daily = %d (%s)", allDailyRec.Code, allDailyRec.Body.String())
	}
	var allResp struct {
		Date    string           `json:"date"`
		Puzzles puzzles.DailyAll `json:"puzzles"`
	}
	if err := json.NewDecoder(allDailyRec.Body).Decode(&allResp); err != nil {
		t.Fatalf("decode all daily: %v", err)
	}
	if allResp.Date != "2026-11-27" ||
		allResp.Puzzles.Easy.Difficulty != sudoku.DifficultyEasy ||
		allResp.Puzzles.Medium.ID != singleResp.Puzzle.ID ||
		allResp.Puzzles.Hard.Difficulty != sudoku.DifficultyHard {
		t.Fatalf("unexpected all daily response: %+v", allResp)
	}

	// Out-of-range daily date returns 400.
	if rec := doAuthGet("/api/v1/puzzles/daily?date=2020-01-01"); rec.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range daily = %d, want 400", rec.Code)
	}

	// 4. Bank endpoint validates difficulty and paginates with cursor.
	if rec := doAuthGet("/api/v1/puzzles/bank"); rec.Code != http.StatusBadRequest {
		t.Fatalf("bank without difficulty = %d, want 400", rec.Code)
	}
	if rec := doAuthGet("/api/v1/puzzles/bank?difficulty=invalid"); rec.Code != http.StatusBadRequest {
		t.Fatalf("bank invalid difficulty = %d, want 400", rec.Code)
	}

	page1Rec := doAuthGet("/api/v1/puzzles/bank?difficulty=easy&limit=2")
	if page1Rec.Code != http.StatusOK {
		t.Fatalf("bank page 1 = %d (%s)", page1Rec.Code, page1Rec.Body.String())
	}
	var page1 puzzles.BankPage
	if err := json.NewDecoder(page1Rec.Body).Decode(&page1); err != nil {
		t.Fatalf("decode bank page1: %v", err)
	}
	if len(page1.Puzzles) != 2 || !page1.HasMore || page1.NextSeq != page1.Puzzles[1].Seq {
		t.Fatalf("unexpected bank page1: %+v", page1)
	}

	// Limit clamping: limit=999 succeeds cleanly and returns remaining 1 item.
	page2Rec := doAuthGet("/api/v1/puzzles/bank?difficulty=easy&afterSeq=" + jsonInt64(page1.NextSeq) + "&limit=999")
	if page2Rec.Code != http.StatusOK {
		t.Fatalf("bank page 2 = %d", page2Rec.Code)
	}
	var page2 puzzles.BankPage
	if err := json.NewDecoder(page2Rec.Body).Decode(&page2); err != nil {
		t.Fatalf("decode bank page2: %v", err)
	}
	if len(page2.Puzzles) != 1 || page2.HasMore || page2.Puzzles[0].Seq <= page1.NextSeq {
		t.Fatalf("unexpected bank page2: %+v", page2)
	}

	// 5. GET /api/v1/puzzles/{id} returns 200 when found and 404 when missing.
	byIDRec := doAuthGet("/api/v1/puzzles/" + page1.Puzzles[0].ID)
	if byIDRec.Code != http.StatusOK || !strings.Contains(byIDRec.Body.String(), page1.Puzzles[0].Clues) {
		t.Fatalf("GET puzzle by id = %d (%s)", byIDRec.Code, byIDRec.Body.String())
	}
	if missingRec := doAuthGet("/api/v1/puzzles/hs-does-not-exist"); missingRec.Code != http.StatusNotFound {
		t.Fatalf("GET missing puzzle = %d, want 404", missingRec.Code)
	}
}

func jsonInt64(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}
