-- Phase 6, Run 1: Leaderboard visibility opt-in on profiles and verified leaderboard entries.

ALTER TABLE profiles ADD COLUMN friends_visible INTEGER NOT NULL DEFAULT 1 CHECK (friends_visible IN (0, 1));
UPDATE profiles SET friends_visible = 0 WHERE is_child = 1;

CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL DEFAULT 'sudoku',
    puzzle_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('standard', 'daily')),
    daily_date TEXT,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    elapsed_ms INTEGER NOT NULL,
    hints_used INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE (profile_id, game_id, puzzle_id),
    CHECK (
        (mode = 'daily' AND daily_date IS NOT NULL AND length(daily_date) = 10)
        OR (mode = 'standard' AND daily_date IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_daily_rank
    ON leaderboard_entries(game_id, mode, daily_date, difficulty, elapsed_ms, hints_used, completed_at);

CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_puzzle_rank
    ON leaderboard_entries(game_id, puzzle_id, elapsed_ms, hints_used, completed_at);

CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_household_daily
    ON leaderboard_entries(household_id, mode, daily_date);
