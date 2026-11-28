package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
	"github.com/gemcdaniel/hearthside/services/api/internal/leaderboards"
	"github.com/gemcdaniel/hearthside/services/api/internal/puzzles"
)

func TestLeaderboardsAndNicknameHTTPFlows(t *testing.T) {
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "lb-http.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	now := time.Date(2026, 11, 28, 14, 0, 0, 0, time.UTC)
	nowFn := func() time.Time { return now }
	cfg := config.Config{
		Addr:          config.DefaultAddr,
		PublicBaseURL: testPublicBaseURL,
		CookieSecure:  false,
	}
	handler := NewHandler(Dependencies{
		DB:     database,
		Config: cfg,
		Now:    nowFn,
	})
	env := &testAPIEnv{
		handler: handler,
		now:     &now,
	}

	// 1. Unauthenticated requests reject with 401.
	unauth := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/daily?difficulty=easy", nil, nil, nil)
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated daily leaderboard = %d, want 401", unauth.Code)
	}

	// 2. Nickname validation rejects URLs, HTML, and >24 chars on bootstrap.
	badBoot := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]string{
		"householdName": "Oakwood",
		"displayName":   "https://bad.com",
		"email":         "owner-a@example.com",
		"password":      "oakwood-pass-123",
	}, nil, nil)
	if badBoot.Code != http.StatusBadRequest || !strings.Contains(badBoot.Body.String(), `"invalid_nickname"`) {
		t.Fatalf("expected 400 invalid_nickname on bootstrap, got %d (%s)", badBoot.Code, badBoot.Body.String())
	}

	// Bootstrap Household A with valid nickname containing apostrophe & hyphen.
	bootA := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]string{
		"householdName": "Oakwood Home",
		"displayName":   "  Mia   O'Connor-1  ",
		"email":         "mia@example.com",
		"password":      "oakwood-pass-123",
	}, nil, nil)
	if bootA.Code != http.StatusCreated {
		t.Fatalf("bootstrap A = %d (%s)", bootA.Code, bootA.Body.String())
	}
	var resA auth.Result
	if err := json.NewDecoder(bootA.Body).Decode(&resA); err != nil {
		t.Fatalf("decode bootstrap A: %v", err)
	}
	cookieA := extractSessionCookie(t, bootA)
	adultA := resA.Profiles[0]
	if adultA.Name != "Mia O'Connor-1" || adultA.IsChild || !adultA.FriendsVisible {
		t.Fatalf("unexpected adult A profile: %+v", adultA)
	}

	// 3. Create child profile: check nickname rejection & friendsVisible=false default.
	badChild := env.doJSON(t, http.MethodPost, "/api/v1/household/profiles", map[string]string{
		"name": "<script>Leo</script>",
	}, cookieA, nil)
	if badChild.Code != http.StatusBadRequest || !strings.Contains(badChild.Body.String(), `"invalid_nickname"`) {
		t.Fatalf("expected 400 invalid_nickname creating child, got %d (%s)", badChild.Code, badChild.Body.String())
	}

	tooLongChild := env.doJSON(t, http.MethodPost, "/api/v1/household/profiles", map[string]string{
		"name": "1234567890123456789012345",
	}, cookieA, nil)
	if tooLongChild.Code != http.StatusBadRequest || !strings.Contains(tooLongChild.Body.String(), `"invalid_nickname"`) {
		t.Fatalf("expected 400 invalid_nickname >24 chars, got %d (%s)", tooLongChild.Code, tooLongChild.Body.String())
	}

	childCreateRec := env.doJSON(t, http.MethodPost, "/api/v1/household/profiles", map[string]string{
		"name":        "Leo-Sam",
		"avatarId":    "fox",
		"accentColor": "amber",
	}, cookieA, nil)
	if childCreateRec.Code != http.StatusCreated {
		t.Fatalf("create child = %d (%s)", childCreateRec.Code, childCreateRec.Body.String())
	}
	var childWrap struct {
		Profile auth.Profile `json:"profile"`
	}
	if err := json.NewDecoder(childCreateRec.Body).Decode(&childWrap); err != nil {
		t.Fatalf("decode child profile: %v", err)
	}
	childA := childWrap.Profile
	if !childA.IsChild || childA.FriendsVisible {
		t.Fatalf("expected child profile IsChild=true FriendsVisible=false, got %+v", childA)
	}

	// Reject bad nickname on profile PATCH.
	badPatch := env.doJSON(t, http.MethodPatch, "/api/v1/household/profiles/"+childA.ID, map[string]any{
		"name": "Bad\nControl",
	}, cookieA, nil)
	if badPatch.Code != http.StatusBadRequest || !strings.Contains(badPatch.Body.String(), `"invalid_nickname"`) {
		t.Fatalf("expected 400 invalid_nickname on patch, got %d (%s)", badPatch.Code, badPatch.Body.String())
	}

	// 4. Create Household B via new_household invite.
	invRec := env.doJSON(t, http.MethodPost, "/api/v1/invites", map[string]string{
		"mode": "new_household",
	}, cookieA, nil)
	if invRec.Code != http.StatusCreated {
		t.Fatalf("create new_household invite = %d (%s)", invRec.Code, invRec.Body.String())
	}
	var invWrap struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(invRec.Body).Decode(&invWrap); err != nil {
		t.Fatalf("decode invite: %v", err)
	}

	regB := env.doJSON(t, http.MethodPost, "/api/v1/auth/register", map[string]string{
		"inviteToken":   invWrap.Token,
		"householdName": "Birch Home",
		"displayName":   "Noah",
		"email":         "noah@example.com",
		"password":      "birch-password-123",
	}, nil, nil)
	if regB.Code != http.StatusCreated {
		t.Fatalf("register B = %d (%s)", regB.Code, regB.Body.String())
	}
	var resB auth.Result
	if err := json.NewDecoder(regB.Body).Decode(&resB); err != nil {
		t.Fatalf("decode register B: %v", err)
	}
	cookieB := extractSessionCookie(t, regB)
	adultB := resB.Profiles[0]

	// 5. Fetch today's Daily Easy puzzle and insert a SQLite server bank puzzle.
	dailyDate := "2026-11-28"
	dailyRec := env.doJSON(t, http.MethodGet, "/api/v1/puzzles/daily?date="+dailyDate+"&difficulty=easy", nil, cookieA, nil)
	if dailyRec.Code != http.StatusOK {
		t.Fatalf("GET daily = %d (%s)", dailyRec.Code, dailyRec.Body.String())
	}
	var dailyPayload struct {
		Puzzle puzzles.Puzzle `json:"puzzle"`
	}
	if err := json.NewDecoder(dailyRec.Body).Decode(&dailyPayload); err != nil {
		t.Fatalf("decode daily puzzle: %v", err)
	}
	dailyEasy := dailyPayload.Puzzle

	// Insert a server-generated bank puzzle row directly into SQLite.
	bankRec, err := sudoku.Generate(1000011, sudoku.DifficultyHard)
	if err != nil {
		t.Fatalf("sudoku.Generate bank failed: %v", err)
	}
	techJSON, _ := json.Marshal(bankRec.TechniquesRequired)
	if _, err := database.ExecContext(ctx, `
		INSERT INTO puzzles (id, game_id, kind, difficulty, seed, engine_version, clues, solution, techniques_required, created_at)
		VALUES (?, 'sudoku', 'bank', ?, ?, ?, ?, ?, ?, ?)
	`, bankRec.ID, string(bankRec.Difficulty), int64(bankRec.Seed), bankRec.EngineVersion, bankRec.Clues, bankRec.Solution, string(techJSON), "2026-11-28T12:00:00.000Z"); err != nil {
		t.Fatalf("insert bank puzzle failed: %v", err)
	}

	// 6. Security & validation error cases:
	// CSRF cross-origin rejected (403)
	csrfRec := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    20_000,
		"hintsUsed":    0,
	}, cookieA, map[string]string{"Origin": "https://evil.example"})
	if csrfRec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin submit = %d, want 403", csrfRec.Code)
	}

	// Tampered solution -> 422
	badSol := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": strings.Repeat("1", 81),
		"elapsedMs":    20_000,
		"hintsUsed":    0,
	}, cookieA, nil)
	if badSol.Code != http.StatusUnprocessableEntity {
		t.Fatalf("tampered solution = %d (%s), want 422", badSol.Code, badSol.Body.String())
	}

	// Unknown puzzleId -> 404
	unknownPuz := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     "hs-does-not-exist",
		"mode":         "standard",
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    20_000,
		"hintsUsed":    0,
	}, cookieA, nil)
	if unknownPuz.Code != http.StatusNotFound {
		t.Fatalf("unknown puzzle = %d (%s), want 404", unknownPuz.Code, unknownPuz.Body.String())
	}

	// Out-of-bounds elapsedMs (<1000, >86400000) & negative hints -> 400
	boundCases := []struct {
		name      string
		elapsedMs int64
		hintsUsed int
	}{
		{"too_fast", 999, 0},
		{"too_slow", 86_400_001, 0},
		{"negative_hints", 10_000, -1},
	}
	for _, bc := range boundCases {
		rec := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
			"profileId":    adultA.ID,
			"gameId":       "sudoku",
			"puzzleId":     dailyEasy.ID,
			"mode":         "daily",
			"dailyDate":    dailyDate,
			"solutionGrid": dailyEasy.Solution,
			"elapsedMs":    bc.elapsedMs,
			"hintsUsed":    bc.hintsUsed,
		}, cookieA, nil)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s bounds check = %d (%s), want 400", bc.name, rec.Code, rec.Body.String())
		}
	}

	// Cross-household submission (Household B submitting for Household A profile) -> 404
	crossRec := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    25_000,
		"hintsUsed":    0,
	}, cookieB, nil)
	if crossRec.Code != http.StatusNotFound {
		t.Fatalf("cross-household submit = %d (%s), want 404", crossRec.Code, crossRec.Body.String())
	}

	// 7. Verified submissions: Daily, Server Bank, and Bundled Starter Bank + first-completion lock.
	submitAdultA := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    60_000,
		"hintsUsed":    2,
		"completedAt":  "2026-11-28T13:50:00Z",
	}, cookieA, nil)
	if submitAdultA.Code != http.StatusCreated {
		t.Fatalf("submitAdultA = %d (%s)", submitAdultA.Code, submitAdultA.Body.String())
	}

	// Duplicate faster submission returns 200 with created:false and keeps 60000ms / 2 hints.
	submitDup := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    15_000,
		"hintsUsed":    0,
	}, cookieA, nil)
	if submitDup.Code != http.StatusOK {
		t.Fatalf("submitDup = %d, want 200", submitDup.Code)
	}
	var dupResp leaderboards.SubmitResultResponse
	if err := json.NewDecoder(submitDup.Body).Decode(&dupResp); err != nil {
		t.Fatalf("decode submitDup: %v", err)
	}
	if dupResp.Created || dupResp.Entry.ElapsedMs != 60_000 || dupResp.Entry.HintsUsed != 2 {
		t.Fatalf("expected locked canonical entry, got %+v", dupResp)
	}

	// Child A solves faster than Adult A (30_000ms, 0 hints).
	submitChildA := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    childA.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    30_000,
		"hintsUsed":    0,
		"completedAt":  "2026-11-28T13:55:00Z",
	}, cookieA, nil)
	if submitChildA.Code != http.StatusCreated {
		t.Fatalf("submitChildA = %d (%s)", submitChildA.Code, submitChildA.Body.String())
	}

	// Adult B solves same elapsedMs (60_000ms) with fewer hints (1 < 2) -> ranks ahead of Adult A!
	submitAdultB := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultB.ID,
		"gameId":       "sudoku",
		"puzzleId":     dailyEasy.ID,
		"mode":         "daily",
		"dailyDate":    dailyDate,
		"solutionGrid": dailyEasy.Solution,
		"elapsedMs":    60_000,
		"hintsUsed":    1,
		"completedAt":  "2026-11-28T13:59:00Z",
	}, cookieB, nil)
	if submitAdultB.Code != http.StatusCreated {
		t.Fatalf("submitAdultB = %d (%s)", submitAdultB.Code, submitAdultB.Body.String())
	}

	// Verify server bank submission + bundled starter-bank submission both succeed (201).
	submitBank := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultB.ID,
		"gameId":       "sudoku",
		"puzzleId":     bankRec.ID,
		"mode":         "standard",
		"solutionGrid": bankRec.Solution,
		"elapsedMs":    95_000,
		"hintsUsed":    0,
	}, cookieB, nil)
	if submitBank.Code != http.StatusCreated {
		t.Fatalf("submitBank = %d (%s)", submitBank.Code, submitBank.Body.String())
	}

	starterPuzzle, found, err := sudoku.GenerateStarterBankPuzzle("hs-0.1.0-dev-easy-0000000000000001")
	if err != nil || !found {
		t.Fatalf("GenerateStarterBankPuzzle failed: found=%v err=%v", found, err)
	}
	submitStarter := env.doJSON(t, http.MethodPost, "/api/v1/leaderboards/submissions", map[string]any{
		"profileId":    adultA.ID,
		"gameId":       "sudoku",
		"puzzleId":     starterPuzzle.ID,
		"mode":         "standard",
		"solutionGrid": starterPuzzle.Solution,
		"elapsedMs":    51_000,
		"hintsUsed":    0,
	}, cookieA, nil)
	if submitStarter.Code != http.StatusCreated {
		t.Fatalf("submitStarter = %d (%s)", submitStarter.Code, submitStarter.Body.String())
	}

	// Verify per-puzzle leaderboard for server bank puzzle.
	puzBoardRec := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/puzzles/"+bankRec.ID+"?scope=friends", nil, cookieA, nil)
	if puzBoardRec.Code != http.StatusOK {
		t.Fatalf("GET puzzle leaderboard = %d (%s)", puzBoardRec.Code, puzBoardRec.Body.String())
	}
	var puzBoard leaderboards.PuzzleLeaderboardResponse
	if err := json.NewDecoder(puzBoardRec.Body).Decode(&puzBoard); err != nil {
		t.Fatalf("decode puzzle leaderboard: %v", err)
	}
	if len(puzBoard.Entries) != 1 || puzBoard.Entries[0].ProfileID != adultB.ID || puzBoard.Entries[0].IsOwnHousehold {
		t.Fatalf("unexpected puzzle leaderboard entries: %+v", puzBoard.Entries)
	}

	// 8. Scope isolation: Household B household-scope sees only Noah; friends-scope excludes Child A while friendsVisible=false.
	hhBRec := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/daily?date="+dailyDate+"&difficulty=easy&scope=household", nil, cookieB, nil)
	if hhBRec.Code != http.StatusOK {
		t.Fatalf("GET household B daily = %d", hhBRec.Code)
	}
	var hhBBoard leaderboards.DailyLeaderboardResponse
	if err := json.NewDecoder(hhBRec.Body).Decode(&hhBBoard); err != nil {
		t.Fatalf("decode hhBBoard: %v", err)
	}
	if len(hhBBoard.Entries) != 1 || hhBBoard.Entries[0].ProfileID != adultB.ID {
		t.Fatalf("expected only Adult B in household B scope, got %+v", hhBBoard.Entries)
	}

	friendsBeforeOptInRec := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/daily?date="+dailyDate+"&difficulty=easy&scope=friends", nil, cookieB, nil)
	if friendsBeforeOptInRec.Code != http.StatusOK {
		t.Fatalf("GET friends daily = %d", friendsBeforeOptInRec.Code)
	}
	friendsRaw := friendsBeforeOptInRec.Body.String()
	if strings.Contains(friendsRaw, "mia@example.com") || strings.Contains(friendsRaw, "noah@example.com") || strings.Contains(friendsRaw, "userId") {
		t.Fatalf("leaderboard JSON leaked PII: %s", friendsRaw)
	}
	var friendsBefore leaderboards.DailyLeaderboardResponse
	if err := json.Unmarshal([]byte(friendsRaw), &friendsBefore); err != nil {
		t.Fatalf("decode friendsBefore: %v", err)
	}
	if len(friendsBefore.Entries) != 2 || friendsBefore.Entries[0].ProfileID != adultB.ID || friendsBefore.Entries[1].ProfileID != adultA.ID {
		t.Fatalf("expected [Adult B (60s, 1h), Adult A (60s, 2h)] excluding Child A, got %+v", friendsBefore.Entries)
	}

	// Parent opts Child A into friends visibility via PATCH.
	patchChild := env.doJSON(t, http.MethodPatch, "/api/v1/household/profiles/"+childA.ID, map[string]any{
		"friendsVisible": true,
	}, cookieA, nil)
	if patchChild.Code != http.StatusOK {
		t.Fatalf("PATCH child friendsVisible = %d (%s)", patchChild.Code, patchChild.Body.String())
	}

	friendsAfterRec := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/daily?date="+dailyDate+"&difficulty=easy&scope=friends", nil, cookieB, nil)
	if friendsAfterRec.Code != http.StatusOK {
		t.Fatalf("GET friends after opt-in = %d", friendsAfterRec.Code)
	}
	var friendsAfter leaderboards.DailyLeaderboardResponse
	if err := json.NewDecoder(friendsAfterRec.Body).Decode(&friendsAfter); err != nil {
		t.Fatalf("decode friendsAfter: %v", err)
	}
	if len(friendsAfter.Entries) != 3 ||
		friendsAfter.Entries[0].ProfileID != childA.ID ||
		friendsAfter.Entries[1].ProfileID != adultB.ID ||
		friendsAfter.Entries[2].ProfileID != adultA.ID {
		t.Fatalf("expected [Child A, Adult B, Adult A], got %+v", friendsAfter.Entries)
	}

	// Verify noHintsOnly filters out hinted entries on household board.
	noHintsRec := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/daily?date="+dailyDate+"&difficulty=easy&scope=household&noHintsOnly=true", nil, cookieA, nil)
	if noHintsRec.Code != http.StatusOK {
		t.Fatalf("GET noHintsOnly = %d", noHintsRec.Code)
	}
	var noHintsBoard leaderboards.DailyLeaderboardResponse
	if err := json.NewDecoder(noHintsRec.Body).Decode(&noHintsBoard); err != nil {
		t.Fatalf("decode noHintsBoard: %v", err)
	}
	if len(noHintsBoard.Entries) != 1 || noHintsBoard.Entries[0].ProfileID != childA.ID {
		t.Fatalf("expected only Child A in noHintsOnly, got %+v", noHintsBoard.Entries)
	}

	// 9. Household Daily Summary returns both solved & unsolved profiles across all 3 tiers.
	summaryRec := env.doJSON(t, http.MethodGet, "/api/v1/leaderboards/household/daily-summary?date="+dailyDate, nil, cookieA, nil)
	if summaryRec.Code != http.StatusOK {
		t.Fatalf("GET household daily summary = %d (%s)", summaryRec.Code, summaryRec.Body.String())
	}
	var summary leaderboards.HouseholdDailySummaryResponse
	if err := json.NewDecoder(summaryRec.Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.HouseholdName != "Oakwood Home" || len(summary.Profiles) != 2 {
		t.Fatalf("unexpected summary header/count: %+v", summary)
	}
	if summary.Profiles[0].ProfileID != adultA.ID || !summary.Profiles[0].Easy.Solved || summary.Profiles[0].Medium.Solved || summary.Profiles[0].Hard.Solved {
		t.Fatalf("unexpected adult summary: %+v", summary.Profiles[0])
	}
	if summary.Profiles[1].ProfileID != childA.ID || !summary.Profiles[1].Easy.Solved || !summary.Profiles[1].FriendsVisible || summary.Profiles[1].Medium.Solved {
		t.Fatalf("unexpected child summary: %+v", summary.Profiles[1])
	}
}
