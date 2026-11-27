-- Phase 5, Run 1: Cloud save slots, monotonic per-puzzle record logs, and split profile preferences.

CREATE TABLE IF NOT EXISTS game_saves (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    puzzle_id TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    filled_cells INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    client_updated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, game_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_game_saves_profile_updated ON game_saves(profile_id, updated_at);

CREATE TABLE IF NOT EXISTS game_puzzle_records (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('standard', 'daily')),
    daily_date TEXT,
    status TEXT NOT NULL CHECK (status IN ('started', 'completed')),
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    hints_used INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, game_id, puzzle_id)
);

CREATE INDEX IF NOT EXISTS idx_game_puzzle_records_profile_game_updated
    ON game_puzzle_records(profile_id, game_id, updated_at);

CREATE TABLE IF NOT EXISTS profile_preferences (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    theme TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('light', 'dark')),
    gameplay_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
