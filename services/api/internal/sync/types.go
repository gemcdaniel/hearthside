// Package sync provides household-scoped cloud save slots, monotonic puzzle records,
// and split LWW profile preference synchronization backed by SQLite.
package sync

import (
	"encoding/json"
	"errors"
	"fmt"
)

// Validation bounds and resolution outcomes enforced by the sync service.
const (
	MaxSavePayloadBytes         = 256 * 1024
	MaxPreferencesGameplayBytes = 16 * 1024
	MaxRecordsBatchSize         = 500

	ResolutionApplied             = "applied"
	ResolutionAutoCompletedLocal  = "auto_completed_local"
	ResolutionAutoCompletedRemote = "auto_completed_remote"

	RecordStatusStarted   = "started"
	RecordStatusCompleted = "completed"

	RecordModeStandard = "standard"
	RecordModeDaily    = "daily"

	PreferenceModeLight = "light"
	PreferenceModeDark  = "dark"
)

// Domain sentinel errors returned by Service methods.
var (
	ErrNotFound        = errors.New("sync profile or resource not found")
	ErrInvalidInput    = errors.New("invalid sync input")
	ErrPayloadTooLarge = errors.New("sync payload exceeds size limit")
)

// ConflictError indicates an active save-slot revision divergence (D30).
type ConflictError struct {
	ServerSave Save
}

// Error implements the error interface.
func (e *ConflictError) Error() string {
	return fmt.Sprintf("save slot %s/%s conflict at server revision %d", e.ServerSave.GameID, e.ServerSave.Slot, e.ServerSave.Revision)
}

// Save represents a server-persisted per-game save slot snapshot.
type Save struct {
	ProfileID       string          `json:"profileId"`
	GameID          string          `json:"gameId"`
	Slot            string          `json:"slot"`
	SchemaVersion   int             `json:"schemaVersion"`
	Revision        int64           `json:"revision"`
	PuzzleID        string          `json:"puzzleId"`
	Completed       bool            `json:"completed"`
	Deleted         bool            `json:"deleted"`
	ElapsedMs       int64           `json:"elapsedMs"`
	FilledCells     int             `json:"filledCells"`
	Payload         json.RawMessage `json:"payload"`
	ClientUpdatedAt string          `json:"clientUpdatedAt"`
	UpdatedAt       string          `json:"updatedAt"`
}

// PuzzleRecord represents a canonical immutable attempt/completion log entry (D31).
type PuzzleRecord struct {
	ProfileID   string  `json:"profileId"`
	GameID      string  `json:"gameId"`
	PuzzleID    string  `json:"puzzleId"`
	Difficulty  string  `json:"difficulty"`
	Mode        string  `json:"mode"`
	DailyDate   *string `json:"dailyDate,omitempty"`
	Status      string  `json:"status"`
	ElapsedMs   int64   `json:"elapsedMs"`
	HintsUsed   int     `json:"hintsUsed"`
	StartedAt   string  `json:"startedAt"`
	CompletedAt *string `json:"completedAt,omitempty"`
	UpdatedAt   string  `json:"updatedAt"`
}

// Preferences represents synced visual theme and game-scoped gameplay settings (D32).
type Preferences struct {
	ProfileID       string          `json:"profileId"`
	Theme           string          `json:"theme"`
	Mode            string          `json:"mode"`
	Gameplay        json.RawMessage `json:"gameplay"`
	UpdatedAt       string          `json:"updatedAt"`
	ServerUpdatedAt string          `json:"serverUpdatedAt"`
}

// PullOptions filters a profile sync pull snapshot.
type PullOptions struct {
	GameID string
	Since  string
}

// PullSnapshot contains synced saves, puzzle records, and preferences for a profile.
type PullSnapshot struct {
	ProfileID   string         `json:"profileId"`
	Saves       []Save         `json:"saves"`
	Records     []PuzzleRecord `json:"records"`
	Preferences *Preferences   `json:"preferences"`
	ServerTime  string         `json:"serverTime"`
}

// UpsertSaveInput describes a save slot write or tombstone deletion request.
type UpsertSaveInput struct {
	SchemaVersion   int             `json:"schemaVersion"`
	BaseRevision    int64           `json:"baseRevision"`
	Force           bool            `json:"force"`
	PuzzleID        string          `json:"puzzleId"`
	Completed       bool            `json:"completed"`
	Deleted         bool            `json:"deleted"`
	ElapsedMs       int64           `json:"elapsedMs"`
	FilledCells     int             `json:"filledCells"`
	Payload         json.RawMessage `json:"payload"`
	ClientUpdatedAt string          `json:"clientUpdatedAt"`
}

// UpsertSaveResult describes the persisted save row and D30 resolution outcome.
type UpsertSaveResult struct {
	Save       Save   `json:"save"`
	Resolution string `json:"resolution"`
}

// PuzzleRecordInput represents one item in a batch puzzle record upload.
type PuzzleRecordInput struct {
	GameID      string  `json:"gameId"`
	PuzzleID    string  `json:"puzzleId"`
	Difficulty  string  `json:"difficulty"`
	Mode        string  `json:"mode"`
	DailyDate   *string `json:"dailyDate,omitempty"`
	Status      string  `json:"status"`
	ElapsedMs   int64   `json:"elapsedMs"`
	HintsUsed   int     `json:"hintsUsed"`
	StartedAt   string  `json:"startedAt"`
	CompletedAt *string `json:"completedAt,omitempty"`
}

// BatchRecordsResult returns how many submitted records changed server state and all merged rows.
type BatchRecordsResult struct {
	AppliedCount int            `json:"appliedCount"`
	Records      []PuzzleRecord `json:"records"`
}

// UpsertPreferencesInput updates theme, mode, and game-scoped gameplay settings via LWW.
type UpsertPreferencesInput struct {
	Theme     string          `json:"theme"`
	Mode      string          `json:"mode"`
	Gameplay  json.RawMessage `json:"gameplay"`
	UpdatedAt string          `json:"updatedAt"`
}

// UpsertPreferencesResult reports whether the incoming preferences won LWW.
type UpsertPreferencesResult struct {
	Preferences Preferences `json:"preferences"`
	Applied     bool        `json:"applied"`
}
