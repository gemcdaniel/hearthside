package sync

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

type syncTestHarness struct {
	svc        *Service
	householdA string
	profileA   string
	householdB string
	profileB   string
	now        time.Time
}

func newSyncTestHarness(t *testing.T) *syncTestHarness {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "sync.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	statements := []string{
		`INSERT INTO households (id, name) VALUES ('hh-a', 'Family A')`,
		`INSERT INTO households (id, name) VALUES ('hh-b', 'Family B')`,
		`INSERT INTO users (id, household_id, email, display_name, role) VALUES ('u-a', 'hh-a', 'a@example.com', 'Owner A', 'owner')`,
		`INSERT INTO users (id, household_id, email, display_name, role) VALUES ('u-b', 'hh-b', 'b@example.com', 'Owner B', 'owner')`,
		`INSERT INTO profiles (id, household_id, user_id, name, avatar_id, accent_color, is_child) VALUES ('prof-a', 'hh-a', 'u-a', 'Parent A', 'hearth', 'terracotta', 0)`,
		`INSERT INTO profiles (id, household_id, user_id, name, avatar_id, accent_color, is_child) VALUES ('prof-b', 'hh-b', 'u-b', 'Parent B', 'hearth', 'teal', 0)`,
	}
	for _, stmt := range statements {
		if _, execErr := database.ExecContext(ctx, stmt); execErr != nil {
			t.Fatalf("seed statement %q failed: %v", stmt, execErr)
		}
	}

	h := &syncTestHarness{
		householdA: "hh-a",
		profileA:   "prof-a",
		householdB: "hh-b",
		profileB:   "prof-b",
		now:        time.Date(2026, 11, 27, 16, 0, 0, 0, time.UTC),
	}
	h.svc = NewService(database, func() time.Time { return h.now })
	return h
}

func TestSaveFastForwardTombstoneConflictForceAndD30AutoResolve(t *testing.T) {
	ctx := context.Background()
	h := newSyncTestHarness(t)

	// 1. Fast-forward creation (0 -> 1) and update (1 -> 2).
	res1, err := h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    0,
		PuzzleID:        "puz-1",
		ElapsedMs:       12000,
		FilledCells:     15,
		Payload:         json.RawMessage(`{"cells":[1,2,3]}`),
		ClientUpdatedAt: "2026-11-27T15:59:00Z",
	})
	if err != nil {
		t.Fatalf("create save: %v", err)
	}
	if res1.Resolution != ResolutionApplied || res1.Save.Revision != 1 {
		t.Fatalf("unexpected res1: %+v", res1)
	}

	h.now = h.now.Add(5 * time.Second)
	res2, err := h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    1,
		PuzzleID:        "puz-1",
		ElapsedMs:       24000,
		FilledCells:     25,
		Payload:         json.RawMessage(`{"cells":[1,2,3,4]}`),
		ClientUpdatedAt: "2026-11-27T16:00:05Z",
	})
	if err != nil {
		t.Fatalf("fast-forward save: %v", err)
	}
	if res2.Resolution != ResolutionApplied || res2.Save.Revision != 2 {
		t.Fatalf("unexpected res2: %+v", res2)
	}

	// 2. Active divergence on different puzzleId returns ConflictError carrying serverSave.
	_, err = h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    1,
		PuzzleID:        "puz-other",
		ElapsedMs:       9000,
		FilledCells:     10,
		Payload:         json.RawMessage(`{"cells":[9]}`),
		ClientUpdatedAt: "2026-11-27T16:00:06Z",
	})
	var conflictErr *ConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected ConflictError, got %v", err)
	}
	if conflictErr.ServerSave.Revision != 2 || conflictErr.ServerSave.PuzzleID != "puz-1" {
		t.Fatalf("unexpected conflict ServerSave: %+v", conflictErr.ServerSave)
	}

	// 3. Same puzzleId active divergence (neither completed) still returns ConflictError.
	_, err = h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    1,
		PuzzleID:        "puz-1",
		Completed:       false,
		ElapsedMs:       30000,
		FilledCells:     40,
		Payload:         json.RawMessage(`{"cells":[5,6]}`),
		ClientUpdatedAt: "2026-11-27T16:00:07Z",
	})
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected ConflictError for same-puzzle active divergence, got %v", err)
	}

	// 4. D30 auto-resolve: same puzzleId diverged where local is completed wins & increments revision.
	h.now = h.now.Add(5 * time.Second)
	resLocalWin, err := h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    1,
		PuzzleID:        "puz-1",
		Completed:       true,
		ElapsedMs:       45000,
		FilledCells:     81,
		Payload:         json.RawMessage(`{"completed":true}`),
		ClientUpdatedAt: "2026-11-27T16:00:10Z",
	})
	if err != nil {
		t.Fatalf("auto_completed_local failed: %v", err)
	}
	if resLocalWin.Resolution != ResolutionAutoCompletedLocal || resLocalWin.Save.Revision != 3 || !resLocalWin.Save.Completed {
		t.Fatalf("unexpected resLocalWin: %+v", resLocalWin)
	}

	// 5. D30 auto-resolve: server already completed wins without overwriting server row.
	resRemoteWin, err := h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    1,
		PuzzleID:        "puz-1",
		Completed:       false,
		ElapsedMs:       50000,
		FilledCells:     60,
		Payload:         json.RawMessage(`{"completed":false}`),
		ClientUpdatedAt: "2026-11-27T16:00:11Z",
	})
	if err != nil {
		t.Fatalf("auto_completed_remote failed: %v", err)
	}
	if resRemoteWin.Resolution != ResolutionAutoCompletedRemote || resRemoteWin.Save.Revision != 3 || !resRemoteWin.Save.Completed {
		t.Fatalf("unexpected resRemoteWin: %+v", resRemoteWin)
	}

	// 6. Force overwrite + tombstone deletion.
	h.now = h.now.Add(5 * time.Second)
	resTombstone, err := h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "easy", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    1,
		Force:           true,
		Deleted:         true,
		ElapsedMs:       0,
		FilledCells:     0,
		ClientUpdatedAt: "2026-11-27T16:00:15Z",
	})
	if err != nil {
		t.Fatalf("force tombstone failed: %v", err)
	}
	if resTombstone.Resolution != ResolutionApplied || resTombstone.Save.Revision != 4 || !resTombstone.Save.Deleted {
		t.Fatalf("unexpected tombstone result: %+v", resTombstone)
	}

	// 7. Oversized payload returns ErrPayloadTooLarge.
	oversized := json.RawMessage(`{"blob":"` + strings.Repeat("a", MaxSavePayloadBytes+10) + `"}`)
	_, err = h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "medium", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    0,
		PuzzleID:        "puz-big",
		Payload:         oversized,
		ClientUpdatedAt: "2026-11-27T16:00:16Z",
	})
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("expected ErrPayloadTooLarge, got %v", err)
	}
}

func TestRecordsBatchMonotonicMergeAndIdempotency(t *testing.T) {
	ctx := context.Background()
	h := newSyncTestHarness(t)

	dailyDate := "2026-11-27"
	completedLater := "2026-11-27T16:05:00Z"
	completedEarlier := "2026-11-27T16:03:00Z"

	// Initial started record.
	batch1, err := h.svc.UpsertRecordsBatch(ctx, h.householdA, h.profileA, []PuzzleRecordInput{
		{
			GameID:     "sudoku",
			PuzzleID:   "hs-daily-1",
			Difficulty: "easy",
			Mode:       RecordModeDaily,
			DailyDate:  &dailyDate,
			Status:     RecordStatusStarted,
			ElapsedMs:  10000,
			HintsUsed:  1,
			StartedAt:  "2026-11-27T16:00:00Z",
		},
	})
	if err != nil {
		t.Fatalf("batch1: %v", err)
	}
	if batch1.AppliedCount != 1 || batch1.Records[0].Status != RecordStatusStarted {
		t.Fatalf("unexpected batch1: %+v", batch1)
	}

	// Upgrade started -> completed with earlier started_at.
	h.now = h.now.Add(1 * time.Minute)
	batch2, err := h.svc.UpsertRecordsBatch(ctx, h.householdA, h.profileA, []PuzzleRecordInput{
		{
			GameID:      "sudoku",
			PuzzleID:    "hs-daily-1",
			Difficulty:  "easy",
			Mode:        RecordModeDaily,
			DailyDate:   &dailyDate,
			Status:      RecordStatusCompleted,
			ElapsedMs:   90000,
			HintsUsed:   2,
			StartedAt:   "2026-11-27T15:59:30Z",
			CompletedAt: &completedLater,
		},
	})
	if err != nil {
		t.Fatalf("batch2: %v", err)
	}
	if batch2.AppliedCount != 1 || batch2.Records[0].Status != RecordStatusCompleted || batch2.Records[0].StartedAt != "2026-11-27T15:59:30.000000Z" {
		t.Fatalf("unexpected batch2: %+v", batch2)
	}

	// Attempt downgrade completed -> started and replay identical record: never downgrades and reports 0 applied changes.
	h.now = h.now.Add(1 * time.Minute)
	batch3, err := h.svc.UpsertRecordsBatch(ctx, h.householdA, h.profileA, []PuzzleRecordInput{
		{
			GameID:     "sudoku",
			PuzzleID:   "hs-daily-1",
			Difficulty: "easy",
			Mode:       RecordModeDaily,
			DailyDate:  &dailyDate,
			Status:     RecordStatusStarted,
			ElapsedMs:  120000,
			HintsUsed:  5,
			StartedAt:  "2026-11-27T16:01:00Z",
		},
	})
	if err != nil {
		t.Fatalf("batch3: %v", err)
	}
	if batch3.AppliedCount != 0 || batch3.Records[0].Status != RecordStatusCompleted || batch3.Records[0].ElapsedMs != 90000 {
		t.Fatalf("expected no downgrade and 0 applied, got %+v", batch3)
	}

	// Earlier completion beats later completion; replay afterward yields 0 changes.
	h.now = h.now.Add(1 * time.Minute)
	batch4, err := h.svc.UpsertRecordsBatch(ctx, h.householdA, h.profileA, []PuzzleRecordInput{
		{
			GameID:      "sudoku",
			PuzzleID:    "hs-daily-1",
			Difficulty:  "easy",
			Mode:        RecordModeDaily,
			DailyDate:   &dailyDate,
			Status:      RecordStatusCompleted,
			ElapsedMs:   75000,
			HintsUsed:   0,
			StartedAt:   "2026-11-27T15:59:45Z",
			CompletedAt: &completedEarlier,
		},
	})
	if err != nil {
		t.Fatalf("batch4: %v", err)
	}
	if batch4.AppliedCount != 1 || batch4.Records[0].ElapsedMs != 75000 || *batch4.Records[0].CompletedAt != "2026-11-27T16:03:00.000000Z" {
		t.Fatalf("expected earlier completion to win, got %+v", batch4)
	}

	replay, err := h.svc.UpsertRecordsBatch(ctx, h.householdA, h.profileA, []PuzzleRecordInput{
		{
			GameID:      "sudoku",
			PuzzleID:    "hs-daily-1",
			Difficulty:  "easy",
			Mode:        RecordModeDaily,
			DailyDate:   &dailyDate,
			Status:      RecordStatusCompleted,
			ElapsedMs:   75000,
			HintsUsed:   0,
			StartedAt:   "2026-11-27T15:59:45Z",
			CompletedAt: &completedEarlier,
		},
	})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.AppliedCount != 0 {
		t.Fatalf("expected idempotent replay AppliedCount=0, got %d", replay.AppliedCount)
	}
}

func TestPreferencesLWWAudioExclusionPullSinceAndIsolation(t *testing.T) {
	ctx := context.Background()
	h := newSyncTestHarness(t)

	// Empty pull returns initialized slices.
	emptySnap, err := h.svc.PullProfileSync(ctx, h.householdA, h.profileA, PullOptions{})
	if err != nil {
		t.Fatalf("empty pull: %v", err)
	}
	if len(emptySnap.Saves) != 0 || len(emptySnap.Records) != 0 || emptySnap.Preferences != nil {
		t.Fatalf("expected empty snapshot, got %+v", emptySnap)
	}

	// Upsert preferences strips device-local audio keys cleanly.
	pref1, err := h.svc.UpsertPreferences(ctx, h.householdA, h.profileA, UpsertPreferencesInput{
		Theme:     "warm-hearthside",
		Mode:      PreferenceModeDark,
		Gameplay:  json.RawMessage(`{"sudoku":{"flagDuplicateConflicts":true,"flagWrongValues":false},"audio":{"sfxMuted":false,"musicVolume":0.8},"sfxVolume":0.5}`),
		UpdatedAt: "2026-11-27T16:00:00Z",
	})
	if err != nil {
		t.Fatalf("pref1: %v", err)
	}
	if !pref1.Applied || strings.Contains(string(pref1.Preferences.Gameplay), "sfx") || strings.Contains(string(pref1.Preferences.Gameplay), "audio") {
		t.Fatalf("expected audio keys stripped and Applied=true, got %+v", pref1)
	}

	// Older client timestamp loses LWW cleanly.
	prefStale, err := h.svc.UpsertPreferences(ctx, h.householdA, h.profileA, UpsertPreferencesInput{
		Theme:     "clean-minimal",
		Mode:      PreferenceModeLight,
		Gameplay:  json.RawMessage(`{"sudoku":{"flagDuplicateConflicts":false,"flagWrongValues":true}}`),
		UpdatedAt: "2026-11-27T15:55:00Z",
	})
	if err != nil {
		t.Fatalf("prefStale: %v", err)
	}
	if prefStale.Applied || prefStale.Preferences.Theme != "warm-hearthside" {
		t.Fatalf("expected stale preference rejected with existing retained, got %+v", prefStale)
	}

	// Incremental pull via since filters out older items and includes newer ones.
	sinceCutoff := h.now.Format(time.RFC3339Nano)
	h.now = h.now.Add(10 * time.Second)
	_, err = h.svc.UpsertSave(ctx, h.householdA, h.profileA, "sudoku", "hard", UpsertSaveInput{
		SchemaVersion:   1,
		BaseRevision:    0,
		PuzzleID:        "puz-hard",
		ElapsedMs:       1500,
		FilledCells:     2,
		Payload:         json.RawMessage(`{"ok":true}`),
		ClientUpdatedAt: "2026-11-27T16:00:10Z",
	})
	if err != nil {
		t.Fatalf("save after cutoff: %v", err)
	}

	incSnap, err := h.svc.PullProfileSync(ctx, h.householdA, h.profileA, PullOptions{
		GameID: "sudoku",
		Since:  sinceCutoff,
	})
	if err != nil {
		t.Fatalf("incremental pull: %v", err)
	}
	if len(incSnap.Saves) != 1 || incSnap.Saves[0].Slot != "hard" || incSnap.Preferences != nil {
		t.Fatalf("unexpected incremental snapshot: %+v", incSnap)
	}

	// Cross-household access always returns ErrNotFound.
	if _, err := h.svc.PullProfileSync(ctx, h.householdB, h.profileA, PullOptions{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-household PullProfileSync = %v, want ErrNotFound", err)
	}
	if _, err := h.svc.UpsertPreferences(ctx, h.householdB, h.profileA, UpsertPreferencesInput{
		Theme:     "clean-minimal",
		Mode:      PreferenceModeLight,
		Gameplay:  json.RawMessage(`{}`),
		UpdatedAt: "2026-11-27T16:05:00Z",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-household UpsertPreferences = %v, want ErrNotFound", err)
	}
}
