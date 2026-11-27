package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	cloudsync "github.com/gemcdaniel/hearthside/services/api/internal/sync"
)

func TestCloudSyncHTTPFlowsAndSecurity(t *testing.T) {
	env := newTestAPIEnv(t, nil)

	// Bootstrap Household A.
	bootRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]string{
		"householdName": "Household A",
		"displayName":   "Parent A",
		"email":         "parent-a@example.com",
		"password":      "password-a-1234",
	}, nil, nil)
	if bootRec.Code != http.StatusCreated {
		t.Fatalf("bootstrap = %d (%s)", bootRec.Code, bootRec.Body.String())
	}
	var bootResp auth.Result
	if err := json.NewDecoder(bootRec.Body).Decode(&bootResp); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	cookieA := extractSessionCookie(t, bootRec)
	profileA := bootResp.Profiles[0].ID

	// 1. All 4 sync routes reject unauthenticated requests with 401.
	unauthCases := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/v1/sync/profiles/" + profileA, nil},
		{http.MethodPut, "/api/v1/sync/profiles/" + profileA + "/saves/sudoku/easy", map[string]any{"schemaVersion": 1}},
		{http.MethodPost, "/api/v1/sync/profiles/" + profileA + "/records/batch", map[string]any{"records": []any{}}},
		{http.MethodPut, "/api/v1/sync/profiles/" + profileA + "/preferences", map[string]any{"theme": "clean-minimal", "mode": "light", "gameplay": map[string]any{}, "updatedAt": "2026-11-27T15:00:00Z"}},
	}
	for _, tc := range unauthCases {
		rec := env.doJSON(t, tc.method, tc.path, tc.body, nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("unauth %s %s = %d, want 401", tc.method, tc.path, rec.Code)
		}
	}

	// 2. CSRF protection blocks cross-origin mutating sync requests.
	csrfRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/preferences", map[string]any{
		"theme":     "clean-minimal",
		"mode":      "light",
		"gameplay":  map[string]any{},
		"updatedAt": "2026-11-27T15:00:00Z",
	}, cookieA, map[string]string{"Origin": "https://evil.example"})
	if csrfRec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin PUT preferences = %d, want 403", csrfRec.Code)
	}

	// 3. Fast-forward save revisions (0 -> 1 -> 2), including colon-delimited daily slot.
	dailySlot := "daily:2026-11-27:easy"
	save1Rec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/"+dailySlot, map[string]any{
		"schemaVersion":   1,
		"baseRevision":    0,
		"puzzleId":        "daily-puz-1",
		"elapsedMs":       11000,
		"filledCells":     12,
		"payload":         map[string]any{"board": "initial"},
		"clientUpdatedAt": "2026-11-27T15:00:00Z",
	}, cookieA, nil)
	if save1Rec.Code != http.StatusOK {
		t.Fatalf("save 1 = %d (%s)", save1Rec.Code, save1Rec.Body.String())
	}
	var save1Resp cloudsync.UpsertSaveResult
	if err := json.NewDecoder(save1Rec.Body).Decode(&save1Resp); err != nil {
		t.Fatalf("decode save1: %v", err)
	}
	if save1Resp.Save.Revision != 1 || save1Resp.Resolution != cloudsync.ResolutionApplied || save1Resp.Save.Slot != dailySlot {
		t.Fatalf("unexpected save1Resp: %+v", save1Resp)
	}

	*env.now = env.now.Add(10 * time.Second)
	save2Rec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/"+dailySlot, map[string]any{
		"schemaVersion":   1,
		"baseRevision":    1,
		"puzzleId":        "daily-puz-1",
		"elapsedMs":       22000,
		"filledCells":     24,
		"payload":         map[string]any{"board": "midgame"},
		"clientUpdatedAt": "2026-11-27T15:00:10Z",
	}, cookieA, nil)
	if save2Rec.Code != http.StatusOK {
		t.Fatalf("save 2 = %d (%s)", save2Rec.Code, save2Rec.Body.String())
	}
	var save2Resp cloudsync.UpsertSaveResult
	if err := json.NewDecoder(save2Rec.Body).Decode(&save2Resp); err != nil {
		t.Fatalf("decode save2: %v", err)
	}
	if save2Resp.Save.Revision != 2 {
		t.Fatalf("save2 revision = %d, want 2", save2Resp.Save.Revision)
	}

	// 4. Payload exceeding 256 KiB returns 413 Request Entity Too Large.
	bigRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/medium", map[string]any{
		"schemaVersion":   1,
		"baseRevision":    0,
		"puzzleId":        "puz-big",
		"payload":         map[string]string{"pad": strings.Repeat("x", cloudsync.MaxSavePayloadBytes+100)},
		"clientUpdatedAt": "2026-11-27T15:00:12Z",
	}, cookieA, nil)
	if bigRec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized save = %d, want 413 (%s)", bigRec.Code, bigRec.Body.String())
	}

	// 5. Active divergence returns 409 Conflict with serverSave, resolved by force: true.
	conflictRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/"+dailySlot, map[string]any{
		"schemaVersion":   1,
		"baseRevision":    1,
		"puzzleId":        "daily-puz-1",
		"completed":       false,
		"elapsedMs":       19000,
		"filledCells":     20,
		"payload":         map[string]any{"board": "diverged"},
		"clientUpdatedAt": "2026-11-27T15:00:15Z",
	}, cookieA, nil)
	if conflictRec.Code != http.StatusConflict {
		t.Fatalf("conflict = %d, want 409 (%s)", conflictRec.Code, conflictRec.Body.String())
	}
	var conflictBody syncConflictResponse
	if err := json.NewDecoder(conflictRec.Body).Decode(&conflictBody); err != nil {
		t.Fatalf("decode conflictBody: %v", err)
	}
	if conflictBody.Error.Code != "sync_conflict" || conflictBody.ServerSave.Revision != 2 || conflictBody.ServerSave.FilledCells != 24 {
		t.Fatalf("unexpected conflictBody: %+v", conflictBody)
	}

	// 6. D30 auto-resolution: local completed wins and increments revision; subsequent stale uncompleted write preserves server.
	*env.now = env.now.Add(10 * time.Second)
	autoLocalRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/"+dailySlot, map[string]any{
		"schemaVersion":   1,
		"baseRevision":    1,
		"puzzleId":        "daily-puz-1",
		"completed":       true,
		"elapsedMs":       35000,
		"filledCells":     81,
		"payload":         map[string]any{"board": "solved"},
		"clientUpdatedAt": "2026-11-27T15:00:20Z",
	}, cookieA, nil)
	if autoLocalRec.Code != http.StatusOK {
		t.Fatalf("auto_completed_local = %d (%s)", autoLocalRec.Code, autoLocalRec.Body.String())
	}
	var autoLocalResp cloudsync.UpsertSaveResult
	if err := json.NewDecoder(autoLocalRec.Body).Decode(&autoLocalResp); err != nil {
		t.Fatalf("decode autoLocalResp: %v", err)
	}
	if autoLocalResp.Resolution != cloudsync.ResolutionAutoCompletedLocal || autoLocalResp.Save.Revision != 3 || !autoLocalResp.Save.Completed {
		t.Fatalf("unexpected autoLocalResp: %+v", autoLocalResp)
	}

	autoRemoteRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/"+dailySlot, map[string]any{
		"schemaVersion":   1,
		"baseRevision":    1,
		"puzzleId":        "daily-puz-1",
		"completed":       false,
		"elapsedMs":       18000,
		"filledCells":     19,
		"payload":         map[string]any{"board": "stale"},
		"clientUpdatedAt": "2026-11-27T15:00:21Z",
	}, cookieA, nil)
	if autoRemoteRec.Code != http.StatusOK {
		t.Fatalf("auto_completed_remote = %d (%s)", autoRemoteRec.Code, autoRemoteRec.Body.String())
	}
	var autoRemoteResp cloudsync.UpsertSaveResult
	if err := json.NewDecoder(autoRemoteRec.Body).Decode(&autoRemoteResp); err != nil {
		t.Fatalf("decode autoRemoteResp: %v", err)
	}
	if autoRemoteResp.Resolution != cloudsync.ResolutionAutoCompletedRemote || autoRemoteResp.Save.Revision != 3 {
		t.Fatalf("unexpected autoRemoteResp: %+v", autoRemoteResp)
	}

	// Tombstone with force: true succeeds and increments revision to 4.
	*env.now = env.now.Add(10 * time.Second)
	forceRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/saves/sudoku/"+dailySlot, map[string]any{
		"schemaVersion":   1,
		"baseRevision":    1,
		"force":           true,
		"deleted":         true,
		"clientUpdatedAt": "2026-11-27T15:00:30Z",
	}, cookieA, nil)
	if forceRec.Code != http.StatusOK {
		t.Fatalf("force tombstone = %d (%s)", forceRec.Code, forceRec.Body.String())
	}
	var forceResp cloudsync.UpsertSaveResult
	if err := json.NewDecoder(forceRec.Body).Decode(&forceResp); err != nil {
		t.Fatalf("decode forceResp: %v", err)
	}
	if forceResp.Save.Revision != 4 || !forceResp.Save.Deleted {
		t.Fatalf("unexpected forceResp: %+v", forceResp)
	}

	// 7. D31 batch records merge & idempotent replay.
	*env.now = env.now.Add(10 * time.Second)
	recBatch1 := env.doJSON(t, http.MethodPost, "/api/v1/sync/profiles/"+profileA+"/records/batch", map[string]any{
		"records": []map[string]any{
			{
				"gameId":      "sudoku",
				"puzzleId":    "hs-rec-1",
				"difficulty":  "medium",
				"mode":        "standard",
				"status":      "completed",
				"elapsedMs":   62000,
				"hintsUsed":   1,
				"startedAt":   "2026-11-27T14:58:00Z",
				"completedAt": "2026-11-27T14:59:10Z",
			},
		},
	}, cookieA, nil)
	if recBatch1.Code != http.StatusOK {
		t.Fatalf("records batch 1 = %d (%s)", recBatch1.Code, recBatch1.Body.String())
	}
	recBatchReplay := env.doJSON(t, http.MethodPost, "/api/v1/sync/profiles/"+profileA+"/records/batch", map[string]any{
		"records": []map[string]any{
			{
				"gameId":     "sudoku",
				"puzzleId":   "hs-rec-1",
				"difficulty": "medium",
				"mode":       "standard",
				"status":     "started",
				"elapsedMs":  5000,
				"hintsUsed":  0,
				"startedAt":  "2026-11-27T14:58:10Z",
			},
		},
	}, cookieA, nil)
	if recBatchReplay.Code != http.StatusOK {
		t.Fatalf("records batch replay = %d", recBatchReplay.Code)
	}
	var batchResp cloudsync.BatchRecordsResult
	if err := json.NewDecoder(recBatchReplay.Body).Decode(&batchResp); err != nil {
		t.Fatalf("decode batchResp: %v", err)
	}
	if batchResp.AppliedCount != 0 || len(batchResp.Records) != 1 || batchResp.Records[0].Status != "completed" {
		t.Fatalf("unexpected batchResp: %+v", batchResp)
	}

	// 8. D32 LWW preferences + audio exclusion.
	*env.now = env.now.Add(10 * time.Second)
	prefNewRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/preferences", map[string]any{
		"theme": "warm-hearthside",
		"mode":  "dark",
		"gameplay": map[string]any{
			"sudoku": map[string]any{
				"flagDuplicateConflicts": true,
				"flagWrongValues":        true,
			},
			"sfxMuted": true,
			"music":    map[string]any{"volume": 0.9},
		},
		"updatedAt": "2026-11-27T15:00:50Z",
	}, cookieA, nil)
	if prefNewRec.Code != http.StatusOK {
		t.Fatalf("pref new = %d (%s)", prefNewRec.Code, prefNewRec.Body.String())
	}
	var prefNewResp cloudsync.UpsertPreferencesResult
	if err := json.NewDecoder(prefNewRec.Body).Decode(&prefNewResp); err != nil {
		t.Fatalf("decode prefNewResp: %v", err)
	}
	if !prefNewResp.Applied || strings.Contains(string(prefNewResp.Preferences.Gameplay), "sfx") || strings.Contains(string(prefNewResp.Preferences.Gameplay), "music") {
		t.Fatalf("unexpected prefNewResp: %+v", prefNewResp)
	}

	prefOldRec := env.doJSON(t, http.MethodPut, "/api/v1/sync/profiles/"+profileA+"/preferences", map[string]any{
		"theme":     "clean-minimal",
		"mode":      "light",
		"gameplay":  map[string]any{"sudoku": map[string]any{"flagDuplicateConflicts": false}},
		"updatedAt": "2026-11-27T15:00:00Z",
	}, cookieA, nil)
	if prefOldRec.Code != http.StatusOK {
		t.Fatalf("pref old = %d", prefOldRec.Code)
	}
	var prefOldResp cloudsync.UpsertPreferencesResult
	if err := json.NewDecoder(prefOldRec.Body).Decode(&prefOldResp); err != nil {
		t.Fatalf("decode prefOldResp: %v", err)
	}
	if prefOldResp.Applied || prefOldResp.Preferences.Theme != "warm-hearthside" {
		t.Fatalf("expected stale preference rejected, got %+v", prefOldResp)
	}

	// 9. Full pull & incremental since pull.
	fullPullRec := env.doJSON(t, http.MethodGet, "/api/v1/sync/profiles/"+profileA, nil, cookieA, nil)
	if fullPullRec.Code != http.StatusOK {
		t.Fatalf("full pull = %d (%s)", fullPullRec.Code, fullPullRec.Body.String())
	}
	var fullSnap cloudsync.PullSnapshot
	if err := json.NewDecoder(fullPullRec.Body).Decode(&fullSnap); err != nil {
		t.Fatalf("decode fullSnap: %v", err)
	}
	if len(fullSnap.Saves) != 1 || len(fullSnap.Records) != 1 || fullSnap.Preferences == nil {
		t.Fatalf("unexpected fullSnap: %+v", fullSnap)
	}

	sinceFuture := env.now.Add(time.Minute).Format(time.RFC3339Nano)
	emptySinceRec := env.doJSON(t, http.MethodGet, "/api/v1/sync/profiles/"+profileA+"?gameId=sudoku&since="+sinceFuture, nil, cookieA, nil)
	if emptySinceRec.Code != http.StatusOK {
		t.Fatalf("since pull = %d", emptySinceRec.Code)
	}
	var sinceSnap cloudsync.PullSnapshot
	if err := json.NewDecoder(emptySinceRec.Body).Decode(&sinceSnap); err != nil {
		t.Fatalf("decode sinceSnap: %v", err)
	}
	if len(sinceSnap.Saves) != 0 || len(sinceSnap.Records) != 0 || sinceSnap.Preferences != nil {
		t.Fatalf("expected empty incremental pull, got %+v", sinceSnap)
	}

	// 10. Create Household B via new_household invite and verify 404 isolation across households.
	inviteRec := env.doJSON(t, http.MethodPost, "/api/v1/invites", map[string]any{
		"mode": auth.InviteModeNewHousehold,
	}, cookieA, nil)
	if inviteRec.Code != http.StatusCreated {
		t.Fatalf("create invite = %d (%s)", inviteRec.Code, inviteRec.Body.String())
	}
	var inviteResp createInviteResponse
	if err := json.NewDecoder(inviteRec.Body).Decode(&inviteResp); err != nil {
		t.Fatalf("decode inviteResp: %v", err)
	}

	regBRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/register", map[string]string{
		"inviteToken":   inviteResp.Token,
		"householdName": "Household B",
		"displayName":   "Parent B",
		"email":         "parent-b@example.com",
		"password":      "password-b-1234",
	}, nil, nil)
	if regBRec.Code != http.StatusCreated {
		t.Fatalf("register B = %d (%s)", regBRec.Code, regBRec.Body.String())
	}
	cookieB := extractSessionCookie(t, regBRec)

	for _, tc := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/v1/sync/profiles/" + profileA, nil},
		{http.MethodPut, "/api/v1/sync/profiles/" + profileA + "/saves/sudoku/easy", map[string]any{"schemaVersion": 1, "baseRevision": 0, "puzzleId": "x", "payload": map[string]any{}, "clientUpdatedAt": "2026-11-27T15:01:00Z"}},
		{http.MethodPost, "/api/v1/sync/profiles/" + profileA + "/records/batch", map[string]any{"records": []any{}}},
		{http.MethodPut, "/api/v1/sync/profiles/" + profileA + "/preferences", map[string]any{"theme": "clean-minimal", "mode": "light", "gameplay": map[string]any{}, "updatedAt": "2026-11-27T15:01:00Z"}},
	} {
		rec := env.doJSON(t, tc.method, tc.path, tc.body, cookieB, nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("Household B %s %s = %d, want 404 (%s)", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}

	// Sanity check: server logs contain zero PII/save payloads.
	logs := env.logBuf.String()
	for _, secret := range []string{"parent-a@example.com", "parent-b@example.com", "diverged", "midgame"} {
		if strings.Contains(logs, secret) {
			t.Fatalf("expected server logs not to contain %q, logs=%s", secret, logs)
		}
	}
}
