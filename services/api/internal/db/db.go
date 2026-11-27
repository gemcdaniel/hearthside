// Package db manages pure-Go SQLite connections, pragmas, and embedded migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // Register pure-Go sqlite driver.
)

// Open opens (or creates) a SQLite database at dbPath, applies recommended
// single-writer reliability PRAGMAs, and verifies connectivity via PingContext.
func Open(ctx context.Context, dbPath string) (*sql.DB, error) {
	if strings.TrimSpace(dbPath) == "" {
		return nil, fmt.Errorf("db path must not be empty")
	}

	isMemory := dbPath == ":memory:" || strings.HasPrefix(dbPath, "file::memory:")
	if !isMemory {
		dir := filepath.Dir(dbPath)
		if dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o750); err != nil {
				return nil, fmt.Errorf("create db directory %q: %w", dir, err)
			}
		}
	}

	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %q: %w", dbPath, err)
	}

	// Single writer connection prevents SQLITE_BUSY write contention.
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)

	pragmas := []string{
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA synchronous = NORMAL;",
	}
	if !isMemory {
		pragmas = append(pragmas, "PRAGMA journal_mode = WAL;")
	}

	for _, stmt := range pragmas {
		if _, err := database.ExecContext(ctx, stmt); err != nil {
			_ = database.Close()
			return nil, fmt.Errorf("apply %q: %w", stmt, err)
		}
	}

	if err := database.PingContext(ctx); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	return database, nil
}
