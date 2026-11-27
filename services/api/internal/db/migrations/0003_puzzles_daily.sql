-- Phase 4, Run 3: Sudoku puzzle bank and deterministic Daily Puzzle storage.

CREATE TABLE IF NOT EXISTS puzzles (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    game_id TEXT NOT NULL DEFAULT 'sudoku',
    kind TEXT NOT NULL CHECK (kind IN ('bank', 'daily')),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    seed INTEGER NOT NULL,
    engine_version TEXT NOT NULL,
    clues TEXT NOT NULL,
    solution TEXT NOT NULL,
    techniques_required TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_puzzles_kind_difficulty_seq ON puzzles(kind, difficulty, seq);

CREATE TABLE IF NOT EXISTS daily_puzzles (
    puzzle_date TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (puzzle_date, difficulty)
);

CREATE INDEX IF NOT EXISTS idx_daily_puzzles_date ON daily_puzzles(puzzle_date);

CREATE TABLE IF NOT EXISTS puzzle_generator_state (
    difficulty TEXT PRIMARY KEY CHECK (difficulty IN ('easy', 'medium', 'hard')),
    next_seed INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO puzzle_generator_state (difficulty, next_seed)
VALUES
    ('easy', 1000000),
    ('medium', 1000000),
    ('hard', 1000000);
