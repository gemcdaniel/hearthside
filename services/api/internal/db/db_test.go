package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpenPragmasAndMigrateIdempotent(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "nested", "hearthside.db")

	database, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer func() {
		if closeErr := database.Close(); closeErr != nil {
			t.Errorf("Close failed: %v", closeErr)
		}
	}()

	var foreignKeys int
	if err := database.QueryRowContext(ctx, `PRAGMA foreign_keys;`).Scan(&foreignKeys); err != nil {
		t.Fatalf("query foreign_keys failed: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}

	var journalMode string
	if err := database.QueryRowContext(ctx, `PRAGMA journal_mode;`).Scan(&journalMode); err != nil {
		t.Fatalf("query journal_mode failed: %v", err)
	}
	if journalMode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", journalMode)
	}

	if err := Migrate(ctx, database); err != nil {
		t.Fatalf("first Migrate failed: %v", err)
	}
	if err := Migrate(ctx, database); err != nil {
		t.Fatalf("second Migrate failed (should be idempotent): %v", err)
	}

	var migrationCount int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&migrationCount); err != nil {
		t.Fatalf("count schema_migrations failed: %v", err)
	}
	if migrationCount != 1 {
		t.Fatalf("migrationCount = %d, want 1", migrationCount)
	}

	var phase string
	if err := database.QueryRowContext(ctx, `SELECT value FROM app_meta WHERE key = 'schema_initialized_phase'`).Scan(&phase); err != nil {
		t.Fatalf("query app_meta failed: %v", err)
	}
	if phase != "4.1" {
		t.Fatalf("app_meta phase = %q, want 4.1", phase)
	}
}

func TestOpenMemory(t *testing.T) {
	ctx := context.Background()
	database, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatalf("Open(:memory:) failed: %v", err)
	}
	defer func() {
		_ = database.Close()
	}()

	if err := Migrate(ctx, database); err != nil {
		t.Fatalf("Migrate(:memory:) failed: %v", err)
	}
}
