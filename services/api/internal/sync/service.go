package sync

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const canonicalTimestampLayout = "2006-01-02T15:04:05.000000Z"

// Service coordinates household-scoped cloud sync operations against SQLite.
type Service struct {
	db  *sql.DB
	now func() time.Time
}

// NewService constructs a sync Service backed by database.
func NewService(database *sql.DB, nowFn func() time.Time) *Service {
	if nowFn == nil {
		nowFn = time.Now
	}
	return &Service{
		db:  database,
		now: nowFn,
	}
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *Service) nowUTCFormatted() string {
	return s.now().UTC().Format(canonicalTimestampLayout)
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

// PullProfileSync returns synced saves, puzzle records, and preferences for profileID within householdID.
func (s *Service) PullProfileSync(ctx context.Context, householdID, profileID string, opts PullOptions) (*PullSnapshot, error) {
	if err := authorizeProfile(ctx, s.db, householdID, profileID); err != nil {
		return nil, err
	}

	gameID := strings.TrimSpace(opts.GameID)
	if gameID != "" && !isValidSlug(gameID, 64) {
		return nil, fmt.Errorf("%w: invalid gameId", ErrInvalidInput)
	}

	var sinceNorm string
	if rawSince := strings.TrimSpace(opts.Since); rawSince != "" {
		parsedSince, err := parseTimestamp(rawSince)
		if err != nil {
			return nil, fmt.Errorf("%w: since must be valid RFC3339", ErrInvalidInput)
		}
		sinceNorm = parsedSince.UTC().Format(canonicalTimestampLayout)
	}

	saves, err := s.querySaves(ctx, profileID, gameID, sinceNorm)
	if err != nil {
		return nil, err
	}

	records, err := s.queryRecords(ctx, profileID, gameID, sinceNorm)
	if err != nil {
		return nil, err
	}

	prefs, err := s.queryPreferences(ctx, profileID, sinceNorm)
	if err != nil {
		return nil, err
	}

	return &PullSnapshot{
		ProfileID:   strings.TrimSpace(profileID),
		Saves:       saves,
		Records:     records,
		Preferences: prefs,
		ServerTime:  s.nowUTCFormatted(),
	}, nil
}

func (s *Service) querySaves(ctx context.Context, profileID, gameID, sinceNorm string) ([]Save, error) {
	query := `
		SELECT profile_id, game_id, slot, schema_version, revision, puzzle_id,
		       completed, deleted, elapsed_ms, filled_cells, payload_json, client_updated_at, updated_at
		FROM game_saves
		WHERE profile_id = ?
	`
	args := []any{profileID}
	if gameID != "" {
		query += ` AND game_id = ?`
		args = append(args, gameID)
	}
	if sinceNorm != "" {
		query += ` AND updated_at > ?`
		args = append(args, sinceNorm)
	}
	query += ` ORDER BY updated_at ASC, game_id ASC, slot ASC`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query game_saves: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	saves := make([]Save, 0)
	for rows.Next() {
		save, scanErr := scanSave(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan game_save: %w", scanErr)
		}
		saves = append(saves, save)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate game_saves: %w", err)
	}
	return saves, nil
}

func (s *Service) queryRecords(ctx context.Context, profileID, gameID, sinceNorm string) ([]PuzzleRecord, error) {
	query := `
		SELECT profile_id, game_id, puzzle_id, difficulty, mode, daily_date,
		       status, elapsed_ms, hints_used, started_at, completed_at, updated_at
		FROM game_puzzle_records
		WHERE profile_id = ?
	`
	args := []any{profileID}
	if gameID != "" {
		query += ` AND game_id = ?`
		args = append(args, gameID)
	}
	if sinceNorm != "" {
		query += ` AND updated_at > ?`
		args = append(args, sinceNorm)
	}
	query += ` ORDER BY updated_at ASC, game_id ASC, puzzle_id ASC`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query game_puzzle_records: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	records := make([]PuzzleRecord, 0)
	for rows.Next() {
		rec, scanErr := scanPuzzleRecord(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan game_puzzle_record: %w", scanErr)
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate game_puzzle_records: %w", err)
	}
	return records, nil
}

func (s *Service) queryPreferences(ctx context.Context, profileID, sinceNorm string) (*Preferences, error) {
	query := `
		SELECT profile_id, theme, mode, gameplay_json, updated_at, server_updated_at
		FROM profile_preferences
		WHERE profile_id = ?
	`
	args := []any{profileID}
	if sinceNorm != "" {
		query += ` AND server_updated_at > ?`
		args = append(args, sinceNorm)
	}

	var pref Preferences
	var gameplayJSON string
	err := s.db.QueryRowContext(ctx, query, args...).Scan(
		&pref.ProfileID,
		&pref.Theme,
		&pref.Mode,
		&gameplayJSON,
		&pref.UpdatedAt,
		&pref.ServerUpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query profile_preferences: %w", err)
	}
	pref.Gameplay = json.RawMessage(gameplayJSON)
	return &pref, nil
}

// UpsertSave writes or tombstones a profile save slot using D30 revision checks and completion auto-resolution.
func (s *Service) UpsertSave(ctx context.Context, householdID, profileID, gameID, slot string, in UpsertSaveInput) (*UpsertSaveResult, error) {
	cleanGameID := strings.TrimSpace(gameID)
	cleanSlot := strings.TrimSpace(slot)
	cleanPuzzleID := strings.TrimSpace(in.PuzzleID)

	if !isValidSlug(cleanGameID, 64) {
		return nil, fmt.Errorf("%w: invalid gameId", ErrInvalidInput)
	}
	if !isValidSlot(cleanSlot, 128) {
		return nil, fmt.Errorf("%w: invalid slot", ErrInvalidInput)
	}
	if in.SchemaVersion < 1 {
		return nil, fmt.Errorf("%w: schemaVersion must be >= 1", ErrInvalidInput)
	}
	if in.BaseRevision < 0 || in.ElapsedMs < 0 || in.FilledCells < 0 {
		return nil, fmt.Errorf("%w: baseRevision, elapsedMs, and filledCells must be non-negative", ErrInvalidInput)
	}
	clientTime, err := parseTimestamp(in.ClientUpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("%w: clientUpdatedAt must be valid RFC3339", ErrInvalidInput)
	}
	clientUpdatedNorm := clientTime.UTC().Format(canonicalTimestampLayout)

	if len(in.Payload) > MaxSavePayloadBytes {
		return nil, ErrPayloadTooLarge
	}

	payloadJSON, err := validateSavePayload(in.Payload, in.Deleted, cleanPuzzleID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin save tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := authorizeProfile(ctx, tx, householdID, profileID); err != nil {
		return nil, err
	}

	existing, found, err := loadSaveTx(ctx, tx, profileID, cleanGameID, cleanSlot)
	if err != nil {
		return nil, err
	}

	nowNorm := s.nowUTCFormatted()
	completedInt := boolToInt(in.Completed)
	deletedInt := boolToInt(in.Deleted)

	if !found {
		if in.BaseRevision != 0 && !in.Force {
			return nil, fmt.Errorf("%w: baseRevision must be 0 when creating a save slot", ErrInvalidInput)
		}
		saved, insertErr := insertSaveTx(ctx, tx, Save{
			ProfileID:       profileID,
			GameID:          cleanGameID,
			Slot:            cleanSlot,
			SchemaVersion:   in.SchemaVersion,
			Revision:        1,
			PuzzleID:        cleanPuzzleID,
			Completed:       in.Completed,
			Deleted:         in.Deleted,
			ElapsedMs:       in.ElapsedMs,
			FilledCells:     in.FilledCells,
			Payload:         payloadJSON,
			ClientUpdatedAt: clientUpdatedNorm,
			UpdatedAt:       nowNorm,
		}, completedInt, deletedInt)
		if insertErr != nil {
			return nil, insertErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return nil, fmt.Errorf("commit save tx: %w", commitErr)
		}
		return &UpsertSaveResult{Save: saved, Resolution: ResolutionApplied}, nil
	}

	resolution := ResolutionApplied
	if !in.Force && in.BaseRevision != existing.Revision {
		if existing.PuzzleID != "" && existing.PuzzleID == cleanPuzzleID && !existing.Deleted && !in.Deleted {
			if in.Completed && !existing.Completed {
				resolution = ResolutionAutoCompletedLocal
			} else if existing.Completed {
				return &UpsertSaveResult{Save: existing, Resolution: ResolutionAutoCompletedRemote}, nil
			} else {
				return nil, &ConflictError{ServerSave: existing}
			}
		} else {
			return nil, &ConflictError{ServerSave: existing}
		}
	}

	nextRev := existing.Revision + 1
	updated, updateErr := updateSaveTx(ctx, tx, Save{
		ProfileID:       profileID,
		GameID:          cleanGameID,
		Slot:            cleanSlot,
		SchemaVersion:   in.SchemaVersion,
		Revision:        nextRev,
		PuzzleID:        cleanPuzzleID,
		Completed:       in.Completed,
		Deleted:         in.Deleted,
		ElapsedMs:       in.ElapsedMs,
		FilledCells:     in.FilledCells,
		Payload:         payloadJSON,
		ClientUpdatedAt: clientUpdatedNorm,
		UpdatedAt:       nowNorm,
	}, completedInt, deletedInt)
	if updateErr != nil {
		return nil, updateErr
	}
	if commitErr := tx.Commit(); commitErr != nil {
		return nil, fmt.Errorf("commit save tx: %w", commitErr)
	}
	return &UpsertSaveResult{Save: updated, Resolution: resolution}, nil
}

func validateSavePayload(raw json.RawMessage, deleted bool, puzzleID string) (json.RawMessage, error) {
	if !deleted && (len(puzzleID) == 0 || len(puzzleID) > 128) {
		return nil, fmt.Errorf("%w: puzzleId is required for non-deleted saves", ErrInvalidInput)
	}
	if deleted && len(puzzleID) > 128 {
		return nil, fmt.Errorf("%w: puzzleId exceeds maximum length", ErrInvalidInput)
	}

	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		if !deleted {
			return nil, fmt.Errorf("%w: payload is required", ErrInvalidInput)
		}
		trimmed = []byte("{}")
	}

	if !json.Valid(trimmed) {
		return nil, fmt.Errorf("%w: payload must be valid JSON", ErrInvalidInput)
	}
	if !deleted && bytes.Equal(trimmed, []byte("null")) {
		return nil, fmt.Errorf("%w: payload must not be null", ErrInvalidInput)
	}

	var compacted bytes.Buffer
	if err := json.Compact(&compacted, trimmed); err != nil {
		return nil, fmt.Errorf("%w: payload must be valid JSON", ErrInvalidInput)
	}
	if compacted.Len() > MaxSavePayloadBytes {
		return nil, ErrPayloadTooLarge
	}
	return json.RawMessage(compacted.Bytes()), nil
}

func loadSaveTx(ctx context.Context, tx *sql.Tx, profileID, gameID, slot string) (Save, bool, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT profile_id, game_id, slot, schema_version, revision, puzzle_id,
		       completed, deleted, elapsed_ms, filled_cells, payload_json, client_updated_at, updated_at
		FROM game_saves
		WHERE profile_id = ? AND game_id = ? AND slot = ?
	`, profileID, gameID, slot)
	save, err := scanSave(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Save{}, false, nil
	}
	if err != nil {
		return Save{}, false, fmt.Errorf("query existing game_save: %w", err)
	}
	return save, true, nil
}

func insertSaveTx(ctx context.Context, tx *sql.Tx, save Save, completedInt, deletedInt int) (Save, error) {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO game_saves (
			profile_id, game_id, slot, schema_version, revision, puzzle_id,
			completed, deleted, elapsed_ms, filled_cells, payload_json, client_updated_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, save.ProfileID, save.GameID, save.Slot, save.SchemaVersion, save.Revision, save.PuzzleID,
		completedInt, deletedInt, save.ElapsedMs, save.FilledCells, string(save.Payload),
		save.ClientUpdatedAt, save.UpdatedAt)
	if err != nil {
		return Save{}, fmt.Errorf("insert game_save: %w", err)
	}
	return save, nil
}

func updateSaveTx(ctx context.Context, tx *sql.Tx, save Save, completedInt, deletedInt int) (Save, error) {
	_, err := tx.ExecContext(ctx, `
		UPDATE game_saves
		SET schema_version = ?, revision = ?, puzzle_id = ?, completed = ?, deleted = ?,
		    elapsed_ms = ?, filled_cells = ?, payload_json = ?, client_updated_at = ?, updated_at = ?
		WHERE profile_id = ? AND game_id = ? AND slot = ?
	`, save.SchemaVersion, save.Revision, save.PuzzleID, completedInt, deletedInt,
		save.ElapsedMs, save.FilledCells, string(save.Payload), save.ClientUpdatedAt, save.UpdatedAt,
		save.ProfileID, save.GameID, save.Slot)
	if err != nil {
		return Save{}, fmt.Errorf("update game_save: %w", err)
	}
	return save, nil
}

// UpsertRecordsBatch atomically merges up to 500 immutable puzzle records for profileID (D31).
func (s *Service) UpsertRecordsBatch(ctx context.Context, householdID, profileID string, inputs []PuzzleRecordInput) (*BatchRecordsResult, error) {
	if len(inputs) > MaxRecordsBatchSize {
		return nil, fmt.Errorf("%w: batch size exceeds limit of %d", ErrInvalidInput, MaxRecordsBatchSize)
	}

	normalized := make([]PuzzleRecord, 0, len(inputs))
	nowNorm := s.nowUTCFormatted()
	for _, item := range inputs {
		rec, err := validateRecordInput(profileID, item, nowNorm)
		if err != nil {
			return nil, err
		}
		normalized = append(normalized, rec)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin records batch tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := authorizeProfile(ctx, tx, householdID, profileID); err != nil {
		return nil, err
	}

	type recordKey struct {
		gameID   string
		puzzleID string
	}
	order := make([]recordKey, 0, len(normalized))
	latestByKey := make(map[recordKey]PuzzleRecord, len(normalized))
	appliedCount := 0

	for _, incoming := range normalized {
		key := recordKey{gameID: incoming.GameID, puzzleID: incoming.PuzzleID}
		if _, seen := latestByKey[key]; !seen {
			order = append(order, key)
		}

		existing, found, loadErr := loadRecordTx(ctx, tx, profileID, incoming.GameID, incoming.PuzzleID)
		if loadErr != nil {
			return nil, loadErr
		}

		if !found {
			if insertErr := insertRecordTx(ctx, tx, incoming); insertErr != nil {
				return nil, insertErr
			}
			appliedCount++
			latestByKey[key] = incoming
			continue
		}

		merged, changed, mergeErr := mergePuzzleRecords(existing, incoming, nowNorm)
		if mergeErr != nil {
			return nil, mergeErr
		}
		if changed {
			if updateErr := updateRecordTx(ctx, tx, merged); updateErr != nil {
				return nil, updateErr
			}
			appliedCount++
		}
		latestByKey[key] = merged
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit records batch tx: %w", err)
	}

	out := make([]PuzzleRecord, 0, len(order))
	for _, key := range order {
		out = append(out, latestByKey[key])
	}
	return &BatchRecordsResult{
		AppliedCount: appliedCount,
		Records:      out,
	}, nil
}

func validateRecordInput(profileID string, item PuzzleRecordInput, nowNorm string) (PuzzleRecord, error) {
	gameID := strings.TrimSpace(item.GameID)
	puzzleID := strings.TrimSpace(item.PuzzleID)
	difficulty := strings.TrimSpace(item.Difficulty)
	mode := strings.TrimSpace(item.Mode)
	status := strings.TrimSpace(item.Status)

	if !isValidSlug(gameID, 64) {
		return PuzzleRecord{}, fmt.Errorf("%w: invalid gameId", ErrInvalidInput)
	}
	if puzzleID == "" || len(puzzleID) > 128 {
		return PuzzleRecord{}, fmt.Errorf("%w: invalid puzzleId", ErrInvalidInput)
	}
	if difficulty == "" || len(difficulty) > 40 {
		return PuzzleRecord{}, fmt.Errorf("%w: invalid difficulty", ErrInvalidInput)
	}
	if mode != RecordModeStandard && mode != RecordModeDaily {
		return PuzzleRecord{}, fmt.Errorf("%w: mode must be standard or daily", ErrInvalidInput)
	}
	if status != RecordStatusStarted && status != RecordStatusCompleted {
		return PuzzleRecord{}, fmt.Errorf("%w: status must be started or completed", ErrInvalidInput)
	}
	if item.ElapsedMs < 0 || item.HintsUsed < 0 {
		return PuzzleRecord{}, fmt.Errorf("%w: elapsedMs and hintsUsed must be non-negative", ErrInvalidInput)
	}

	var dailyDate *string
	if item.DailyDate != nil && strings.TrimSpace(*item.DailyDate) != "" {
		cleanDate := strings.TrimSpace(*item.DailyDate)
		if _, err := time.Parse("2006-01-02", cleanDate); err != nil {
			return PuzzleRecord{}, fmt.Errorf("%w: dailyDate must be YYYY-MM-DD", ErrInvalidInput)
		}
		dailyDate = &cleanDate
	}
	if mode == RecordModeDaily && dailyDate == nil {
		return PuzzleRecord{}, fmt.Errorf("%w: dailyDate is required when mode is daily", ErrInvalidInput)
	}

	startedAt, err := parseTimestamp(item.StartedAt)
	if err != nil {
		return PuzzleRecord{}, fmt.Errorf("%w: startedAt must be valid RFC3339", ErrInvalidInput)
	}
	startedNorm := startedAt.UTC().Format(canonicalTimestampLayout)

	var completedAt *string
	if item.CompletedAt != nil && strings.TrimSpace(*item.CompletedAt) != "" {
		parsedCompleted, parseErr := parseTimestamp(*item.CompletedAt)
		if parseErr != nil {
			return PuzzleRecord{}, fmt.Errorf("%w: completedAt must be valid RFC3339", ErrInvalidInput)
		}
		norm := parsedCompleted.UTC().Format(canonicalTimestampLayout)
		completedAt = &norm
	}
	if status == RecordStatusCompleted && completedAt == nil {
		return PuzzleRecord{}, fmt.Errorf("%w: completedAt is required when status is completed", ErrInvalidInput)
	}
	if status == RecordStatusStarted {
		completedAt = nil
	}

	return PuzzleRecord{
		ProfileID:   strings.TrimSpace(profileID),
		GameID:      gameID,
		PuzzleID:    puzzleID,
		Difficulty:  difficulty,
		Mode:        mode,
		DailyDate:   dailyDate,
		Status:      status,
		ElapsedMs:   item.ElapsedMs,
		HintsUsed:   item.HintsUsed,
		StartedAt:   startedNorm,
		CompletedAt: completedAt,
		UpdatedAt:   nowNorm,
	}, nil
}

func loadRecordTx(ctx context.Context, tx *sql.Tx, profileID, gameID, puzzleID string) (PuzzleRecord, bool, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT profile_id, game_id, puzzle_id, difficulty, mode, daily_date,
		       status, elapsed_ms, hints_used, started_at, completed_at, updated_at
		FROM game_puzzle_records
		WHERE profile_id = ? AND game_id = ? AND puzzle_id = ?
	`, profileID, gameID, puzzleID)
	rec, err := scanPuzzleRecord(row)
	if errors.Is(err, sql.ErrNoRows) {
		return PuzzleRecord{}, false, nil
	}
	if err != nil {
		return PuzzleRecord{}, false, fmt.Errorf("query existing game_puzzle_record: %w", err)
	}
	return rec, true, nil
}

func insertRecordTx(ctx context.Context, tx *sql.Tx, rec PuzzleRecord) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO game_puzzle_records (
			profile_id, game_id, puzzle_id, difficulty, mode, daily_date,
			status, elapsed_ms, hints_used, started_at, completed_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, rec.ProfileID, rec.GameID, rec.PuzzleID, rec.Difficulty, rec.Mode, rec.DailyDate,
		rec.Status, rec.ElapsedMs, rec.HintsUsed, rec.StartedAt, rec.CompletedAt, rec.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert game_puzzle_record: %w", err)
	}
	return nil
}

func updateRecordTx(ctx context.Context, tx *sql.Tx, rec PuzzleRecord) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE game_puzzle_records
		SET difficulty = ?, mode = ?, daily_date = ?, status = ?, elapsed_ms = ?,
		    hints_used = ?, started_at = ?, completed_at = ?, updated_at = ?
		WHERE profile_id = ? AND game_id = ? AND puzzle_id = ?
	`, rec.Difficulty, rec.Mode, rec.DailyDate, rec.Status, rec.ElapsedMs,
		rec.HintsUsed, rec.StartedAt, rec.CompletedAt, rec.UpdatedAt,
		rec.ProfileID, rec.GameID, rec.PuzzleID)
	if err != nil {
		return fmt.Errorf("update game_puzzle_record: %w", err)
	}
	return nil
}

func mergePuzzleRecords(existing, incoming PuzzleRecord, nowNorm string) (PuzzleRecord, bool, error) {
	earliestStart, err := earlierTimestamp(existing.StartedAt, incoming.StartedAt)
	if err != nil {
		return PuzzleRecord{}, false, err
	}

	merged := existing
	merged.StartedAt = earliestStart
	if merged.DailyDate == nil && incoming.DailyDate != nil {
		merged.DailyDate = incoming.DailyDate
	}

	switch {
	case existing.Status == RecordStatusCompleted && incoming.Status == RecordStatusStarted:
		// Never downgrade completed -> started (D31); keep earliest started_at if improved.
	case existing.Status == RecordStatusStarted && incoming.Status == RecordStatusCompleted:
		merged.Status = RecordStatusCompleted
		merged.ElapsedMs = incoming.ElapsedMs
		merged.HintsUsed = incoming.HintsUsed
		merged.CompletedAt = incoming.CompletedAt
		merged.Mode = incoming.Mode
		if incoming.DailyDate != nil {
			merged.DailyDate = incoming.DailyDate
		}
	case existing.Status == RecordStatusCompleted && incoming.Status == RecordStatusCompleted:
		preferIncoming, cmpErr := isBetterCompletion(existing, incoming)
		if cmpErr != nil {
			return PuzzleRecord{}, false, cmpErr
		}
		if preferIncoming {
			merged.ElapsedMs = incoming.ElapsedMs
			merged.HintsUsed = incoming.HintsUsed
			merged.CompletedAt = incoming.CompletedAt
			merged.Mode = incoming.Mode
			if incoming.DailyDate != nil {
				merged.DailyDate = incoming.DailyDate
			}
		}
	default:
		// Both started: preserve maximum progress/hints alongside earliest start.
		if incoming.ElapsedMs > merged.ElapsedMs {
			merged.ElapsedMs = incoming.ElapsedMs
		}
		if incoming.HintsUsed > merged.HintsUsed {
			merged.HintsUsed = incoming.HintsUsed
		}
	}

	changed := recordsDiffer(existing, merged)
	if changed {
		merged.UpdatedAt = nowNorm
	}
	return merged, changed, nil
}

func isBetterCompletion(existing, incoming PuzzleRecord) (bool, error) {
	if existing.CompletedAt == nil || incoming.CompletedAt == nil {
		return incoming.CompletedAt != nil, nil
	}
	existingTime, err := parseTimestamp(*existing.CompletedAt)
	if err != nil {
		return false, err
	}
	incomingTime, err := parseTimestamp(*incoming.CompletedAt)
	if err != nil {
		return false, err
	}
	if !incomingTime.Equal(existingTime) {
		return incomingTime.Before(existingTime), nil
	}
	if incoming.ElapsedMs != existing.ElapsedMs {
		return incoming.ElapsedMs < existing.ElapsedMs, nil
	}
	return incoming.HintsUsed < existing.HintsUsed, nil
}

func recordsDiffer(a, b PuzzleRecord) bool {
	if a.Difficulty != b.Difficulty ||
		a.Mode != b.Mode ||
		a.Status != b.Status ||
		a.ElapsedMs != b.ElapsedMs ||
		a.HintsUsed != b.HintsUsed ||
		a.StartedAt != b.StartedAt {
		return true
	}
	if !equalStringPtr(a.DailyDate, b.DailyDate) {
		return true
	}
	return !equalStringPtr(a.CompletedAt, b.CompletedAt)
}

func equalStringPtr(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// UpsertPreferences updates synced visual/gameplay preferences using client LWW (D32).
func (s *Service) UpsertPreferences(ctx context.Context, householdID, profileID string, in UpsertPreferencesInput) (*UpsertPreferencesResult, error) {
	cleanTheme := strings.TrimSpace(in.Theme)
	cleanMode := strings.TrimSpace(in.Mode)
	if !isValidSlug(cleanTheme, 64) {
		return nil, fmt.Errorf("%w: invalid theme", ErrInvalidInput)
	}
	if cleanMode != PreferenceModeLight && cleanMode != PreferenceModeDark {
		return nil, fmt.Errorf("%w: mode must be light or dark", ErrInvalidInput)
	}

	incomingTime, err := parseTimestamp(in.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("%w: updatedAt must be valid RFC3339", ErrInvalidInput)
	}
	incomingNorm := incomingTime.UTC().Format(canonicalTimestampLayout)

	if len(in.Gameplay) > MaxPreferencesGameplayBytes {
		return nil, ErrPayloadTooLarge
	}
	sanitizedGameplay, err := sanitizeGameplayPreferences(in.Gameplay)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin preferences tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := authorizeProfile(ctx, tx, householdID, profileID); err != nil {
		return nil, err
	}

	var existing Preferences
	var existingGameplayJSON string
	err = tx.QueryRowContext(ctx, `
		SELECT profile_id, theme, mode, gameplay_json, updated_at, server_updated_at
		FROM profile_preferences
		WHERE profile_id = ?
	`, profileID).Scan(
		&existing.ProfileID,
		&existing.Theme,
		&existing.Mode,
		&existingGameplayJSON,
		&existing.UpdatedAt,
		&existing.ServerUpdatedAt,
	)

	found := true
	if errors.Is(err, sql.ErrNoRows) {
		found = false
	} else if err != nil {
		return nil, fmt.Errorf("query existing profile_preferences: %w", err)
	}

	if found {
		existing.Gameplay = json.RawMessage(existingGameplayJSON)
		existingTime, parseErr := parseTimestamp(existing.UpdatedAt)
		if parseErr == nil && incomingTime.Before(existingTime) {
			return &UpsertPreferencesResult{
				Preferences: existing,
				Applied:     false,
			}, nil
		}
	}

	serverUpdatedAt := s.nowUTCFormatted()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO profile_preferences (profile_id, theme, mode, gameplay_json, updated_at, server_updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(profile_id) DO UPDATE SET
			theme = excluded.theme,
			mode = excluded.mode,
			gameplay_json = excluded.gameplay_json,
			updated_at = excluded.updated_at,
			server_updated_at = excluded.server_updated_at
	`, profileID, cleanTheme, cleanMode, string(sanitizedGameplay), incomingNorm, serverUpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert profile_preferences: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit preferences tx: %w", err)
	}

	return &UpsertPreferencesResult{
		Preferences: Preferences{
			ProfileID:       strings.TrimSpace(profileID),
			Theme:           cleanTheme,
			Mode:            cleanMode,
			Gameplay:        sanitizedGameplay,
			UpdatedAt:       incomingNorm,
			ServerUpdatedAt: serverUpdatedAt,
		},
		Applied: true,
	}, nil
}

func sanitizeGameplayPreferences(raw json.RawMessage) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("%w: gameplay object is required", ErrInvalidInput)
	}

	var obj map[string]any
	if err := json.Unmarshal(trimmed, &obj); err != nil || obj == nil {
		return nil, fmt.Errorf("%w: gameplay must be a JSON object", ErrInvalidInput)
	}

	stripAudioKeys(obj)
	encoded, err := json.Marshal(obj)
	if err != nil {
		return nil, fmt.Errorf("%w: gameplay must be serializable JSON", ErrInvalidInput)
	}
	if len(encoded) > MaxPreferencesGameplayBytes {
		return nil, ErrPayloadTooLarge
	}
	return json.RawMessage(encoded), nil
}

func stripAudioKeys(obj map[string]any) {
	for k, v := range obj {
		if isDeviceLocalAudioKey(k) {
			delete(obj, k)
			continue
		}
		if nested, ok := v.(map[string]any); ok {
			stripAudioKeys(nested)
		}
	}
}

func isDeviceLocalAudioKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	normalized = strings.ReplaceAll(normalized, "_", "")
	normalized = strings.ReplaceAll(normalized, "-", "")
	switch normalized {
	case "audio", "audiosettings", "sound", "soundeffects", "sfx", "sfxmuted", "sfxvolume", "music", "musicmuted", "musicvolume", "volume":
		return true
	default:
		return strings.HasPrefix(normalized, "audio") || strings.HasPrefix(normalized, "sfx") || strings.HasPrefix(normalized, "music")
	}
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSave(scanner rowScanner) (Save, error) {
	var save Save
	var completedInt, deletedInt int
	var payloadJSON string
	err := scanner.Scan(
		&save.ProfileID,
		&save.GameID,
		&save.Slot,
		&save.SchemaVersion,
		&save.Revision,
		&save.PuzzleID,
		&completedInt,
		&deletedInt,
		&save.ElapsedMs,
		&save.FilledCells,
		&payloadJSON,
		&save.ClientUpdatedAt,
		&save.UpdatedAt,
	)
	if err != nil {
		return Save{}, err
	}
	save.Completed = completedInt != 0
	save.Deleted = deletedInt != 0
	save.Payload = json.RawMessage(payloadJSON)
	return save, nil
}

func scanPuzzleRecord(scanner rowScanner) (PuzzleRecord, error) {
	var rec PuzzleRecord
	var dailyDate sql.NullString
	var completedAt sql.NullString
	err := scanner.Scan(
		&rec.ProfileID,
		&rec.GameID,
		&rec.PuzzleID,
		&rec.Difficulty,
		&rec.Mode,
		&dailyDate,
		&rec.Status,
		&rec.ElapsedMs,
		&rec.HintsUsed,
		&rec.StartedAt,
		&completedAt,
		&rec.UpdatedAt,
	)
	if err != nil {
		return PuzzleRecord{}, err
	}
	if dailyDate.Valid {
		v := dailyDate.String
		rec.DailyDate = &v
	}
	if completedAt.Valid {
		v := completedAt.String
		rec.CompletedAt = &v
	}
	return rec, nil
}

func parseTimestamp(raw string) (time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Time{}, errors.New("empty timestamp")
	}
	return time.Parse(time.RFC3339Nano, trimmed)
}

func earlierTimestamp(aRaw, bRaw string) (string, error) {
	aTime, err := parseTimestamp(aRaw)
	if err != nil {
		return "", err
	}
	bTime, err := parseTimestamp(bRaw)
	if err != nil {
		return "", err
	}
	if bTime.Before(aTime) {
		return bTime.UTC().Format(canonicalTimestampLayout), nil
	}
	return aTime.UTC().Format(canonicalTimestampLayout), nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func isValidSlug(value string, maxLen int) bool {
	if len(value) == 0 || len(value) > maxLen {
		return false
	}
	for i := range len(value) {
		c := value[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' {
			continue
		}
		return false
	}
	return true
}

func isValidSlot(value string, maxLen int) bool {
	if len(value) == 0 || len(value) > maxLen {
		return false
	}
	for i := range len(value) {
		c := value[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == ':' {
			continue
		}
		return false
	}
	return true
}
