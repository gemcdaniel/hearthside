// Package puzzles manages SQLite-backed Sudoku puzzle banks, deterministic Daily Puzzles,
// and background puzzle replenishment using engine/sudoku.
package puzzles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
)

// Default pagination and date-window limits for puzzle endpoints.
const (
	DefaultBankLimit = 20
	MaxBankLimit     = 50
	DailyPastDays    = 30
	DailyFutureDays  = 2

	dateLayout           = "2006-01-02"
	schedulerTickPeriod  = time.Hour
	maxSeedRetryAttempts = 10
)

// Domain sentinel errors returned by Service methods.
var (
	ErrNotFound       = errors.New("puzzle not found")
	ErrInvalidInput   = errors.New("invalid puzzle input")
	ErrDateOutOfRange = errors.New("daily puzzle date outside allowed range")
)

var allDifficulties = []sudoku.Difficulty{
	sudoku.DifficultyEasy,
	sudoku.DifficultyMedium,
	sudoku.DifficultyHard,
}

// Puzzle matches the TypeScript PuzzleRecord JSON shape, with optional seq on bank responses.
type Puzzle struct {
	Seq                int64             `json:"seq,omitempty"`
	ID                 string            `json:"id"`
	Seed               uint64            `json:"seed"`
	EngineVersion      string            `json:"engineVersion"`
	Difficulty         sudoku.Difficulty `json:"difficulty"`
	TechniquesRequired []string          `json:"techniquesRequired"`
	Clues              string            `json:"clues"`
	Solution           string            `json:"solution"`
}

// DailyAll groups the three difficulty puzzles for a single UTC calendar day.
type DailyAll struct {
	Easy   Puzzle `json:"easy"`
	Medium Puzzle `json:"medium"`
	Hard   Puzzle `json:"hard"`
}

// BankPage represents a cursor-paginated slice of server-generated bank puzzles.
type BankPage struct {
	EngineVersion string            `json:"engineVersion"`
	Difficulty    sudoku.Difficulty `json:"difficulty"`
	Puzzles       []Puzzle          `json:"puzzles"`
	NextSeq       int64             `json:"nextSeq"`
	HasMore       bool              `json:"hasMore"`
}

// Service coordinates SQLite puzzle storage, deterministic Daily generation, and background top-ups.
type Service struct {
	db     *sql.DB
	cfg    config.PuzzleConfig
	logger *slog.Logger
	now    func() time.Time

	wakeCh chan struct{}
	wg     sync.WaitGroup

	mu           sync.Mutex
	started      bool
	desiredTotal map[sudoku.Difficulty]int
}

// NewService constructs a Service backed by database and cfg.
func NewService(database *sql.DB, cfg config.PuzzleConfig, logger *slog.Logger, now func() time.Time) *Service {
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	if now == nil {
		now = time.Now
	}
	if cfg.PoolTarget <= 0 {
		cfg.PoolTarget = config.DefaultPuzzlePoolTarget
	}
	if cfg.PoolLowWater < 0 {
		cfg.PoolLowWater = config.DefaultPuzzlePoolLowWater
	}
	if cfg.PoolMaxTotal < cfg.PoolTarget {
		cfg.PoolMaxTotal = max(config.DefaultPuzzlePoolMaxTotal, cfg.PoolTarget)
	}
	if cfg.DailyLookaheadDays < 0 {
		cfg.DailyLookaheadDays = config.DefaultDailyLookaheadDays
	}

	desired := make(map[sudoku.Difficulty]int, len(allDifficulties))
	for _, d := range allDifficulties {
		desired[d] = cfg.PoolTarget
	}

	return &Service{
		db:           database,
		cfg:          cfg,
		logger:       logger,
		now:          now,
		wakeCh:       make(chan struct{}, 1),
		desiredTotal: desired,
	}
}

// Start launches the serialized background scheduler goroutine if enabled in configuration.
// Calling Start does not block HTTP startup; call Wait after canceling ctx during shutdown.
func (s *Service) Start(ctx context.Context) {
	if !s.cfg.SchedulerEnabled || s.db == nil {
		return
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.mu.Unlock()

	s.wg.Add(1)
	go s.runScheduler(ctx)
}

// Wait blocks until the background scheduler goroutine exits cleanly.
func (s *Service) Wait() {
	s.wg.Wait()
}

func (s *Service) runScheduler(ctx context.Context) {
	defer s.wg.Done()

	ticker := time.NewTicker(schedulerTickPeriod)
	defer ticker.Stop()

	s.runCycle(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wakeCh:
			s.runCycle(ctx)
		case <-ticker.C:
			s.runCycle(ctx)
		}
	}
}

func (s *Service) runCycle(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	s.ensureDailyWindow(ctx)
	s.refillBankPools(ctx)
}

func (s *Service) ensureDailyWindow(ctx context.Context) {
	todayUTC := truncateUTCDate(s.now())
	for offset := -1; offset <= s.cfg.DailyLookaheadDays; offset++ {
		if ctx.Err() != nil {
			return
		}
		dateKey := todayUTC.AddDate(0, 0, offset).Format(dateLayout)
		for _, diff := range allDifficulties {
			if ctx.Err() != nil {
				return
			}
			if _, err := s.ensureDaily(ctx, dateKey, diff); err != nil && !errors.Is(err, context.Canceled) {
				s.logger.Warn("daily puzzle pre-generation failed",
					slog.String("date", dateKey),
					slog.String("difficulty", string(diff)),
					slog.String("error", err.Error()),
				)
			}
		}
	}
}

func (s *Service) refillBankPools(ctx context.Context) {
	for _, diff := range allDifficulties {
		if ctx.Err() != nil {
			return
		}
		target := s.getDesiredTotal(diff)
		if target > s.cfg.PoolMaxTotal {
			target = s.cfg.PoolMaxTotal
		}

		for ctx.Err() == nil {
			var count int
			if err := s.db.QueryRowContext(
				ctx,
				`SELECT COUNT(*) FROM puzzles WHERE kind = 'bank' AND difficulty = ?`,
				string(diff),
			).Scan(&count); err != nil {
				if !errors.Is(err, context.Canceled) {
					s.logger.Warn("count bank puzzles failed",
						slog.String("difficulty", string(diff)),
						slog.String("error", err.Error()),
					)
				}
				break
			}
			if count >= target || count >= s.cfg.PoolMaxTotal {
				break
			}
			if err := s.generateNextBankPuzzle(ctx, diff); err != nil {
				if !errors.Is(err, context.Canceled) {
					s.logger.Warn("generate bank puzzle failed",
						slog.String("difficulty", string(diff)),
						slog.String("error", err.Error()),
					)
				}
				break
			}
		}
	}
}

func (s *Service) getDesiredTotal(diff sudoku.Difficulty) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.desiredTotal[diff]
}

func (s *Service) generateNextBankPuzzle(ctx context.Context, diff sudoku.Difficulty) error {
	var startSeed int64
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT next_seed FROM puzzle_generator_state WHERE difficulty = ?`,
		string(diff),
	).Scan(&startSeed); err != nil {
		return fmt.Errorf("read next_seed for %s: %w", diff, err)
	}
	if startSeed < 1000000 {
		startSeed = 1000000
	}

	var rec sudoku.PuzzleRecord
	var usedSeed int64
	var genErr error
	for attempt := range maxSeedRetryAttempts {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		candidateSeed := startSeed + int64(attempt)
		rec, genErr = sudoku.Generate(uint64(candidateSeed), diff)
		if genErr == nil {
			usedSeed = candidateSeed
			break
		}
	}
	if genErr != nil {
		return fmt.Errorf("generate %s puzzle from seed %d: %w", diff, startSeed, genErr)
	}

	techJSON, err := marshalTechniques(rec.TechniquesRequired)
	if err != nil {
		return err
	}
	nowStr := s.now().UTC().Format("2006-01-02T15:04:05.000Z")

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin bank insert tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO puzzles (id, game_id, kind, difficulty, seed, engine_version, clues, solution, techniques_required, created_at)
		VALUES (?, 'sudoku', 'bank', ?, ?, ?, ?, ?, ?, ?)
	`, rec.ID, string(rec.Difficulty), int64(rec.Seed), rec.EngineVersion, rec.Clues, rec.Solution, techJSON, nowStr); err != nil {
		return fmt.Errorf("insert bank puzzle: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO puzzle_generator_state (difficulty, next_seed, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT (difficulty) DO UPDATE SET
			next_seed = MAX(puzzle_generator_state.next_seed, excluded.next_seed),
			updated_at = excluded.updated_at
	`, string(diff), usedSeed+1, nowStr); err != nil {
		return fmt.Errorf("update puzzle_generator_state: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit bank insert tx: %w", err)
	}
	return nil
}

// GetDaily returns the cached or freshly generated deterministic Daily Puzzle for dateYYYYMMDD and diff,
// enforcing the on-demand date window [today - 30d .. today + 2d] UTC.
func (s *Service) GetDaily(ctx context.Context, dateYYYYMMDD string, diff sudoku.Difficulty) (Puzzle, error) {
	if _, err := validateDifficulty(string(diff)); err != nil {
		return Puzzle{}, err
	}
	if err := s.validateOnDemandDate(dateYYYYMMDD); err != nil {
		return Puzzle{}, err
	}
	return s.ensureDaily(ctx, dateYYYYMMDD, diff)
}

// GetDailyAll returns all three difficulty Daily Puzzles for dateYYYYMMDD.
func (s *Service) GetDailyAll(ctx context.Context, dateYYYYMMDD string) (DailyAll, error) {
	if err := s.validateOnDemandDate(dateYYYYMMDD); err != nil {
		return DailyAll{}, err
	}
	easy, err := s.ensureDaily(ctx, dateYYYYMMDD, sudoku.DifficultyEasy)
	if err != nil {
		return DailyAll{}, err
	}
	medium, err := s.ensureDaily(ctx, dateYYYYMMDD, sudoku.DifficultyMedium)
	if err != nil {
		return DailyAll{}, err
	}
	hard, err := s.ensureDaily(ctx, dateYYYYMMDD, sudoku.DifficultyHard)
	if err != nil {
		return DailyAll{}, err
	}
	return DailyAll{Easy: easy, Medium: medium, Hard: hard}, nil
}

func (s *Service) ensureDaily(ctx context.Context, dateYYYYMMDD string, diff sudoku.Difficulty) (Puzzle, error) {
	if p, ok, err := s.lookupDaily(ctx, dateYYYYMMDD, diff); err != nil {
		return Puzzle{}, err
	} else if ok {
		return p, nil
	}

	seed, err := sudoku.DailySeed(dateYYYYMMDD, diff, sudoku.EngineVersion)
	if err != nil {
		return Puzzle{}, fmt.Errorf("%w: %w", ErrInvalidInput, err)
	}

	rec, err := sudoku.Generate(seed, diff)
	if err != nil {
		return Puzzle{}, fmt.Errorf("generate daily puzzle (%s, %s): %w", dateYYYYMMDD, diff, err)
	}

	techJSON, err := marshalTechniques(rec.TechniquesRequired)
	if err != nil {
		return Puzzle{}, err
	}
	nowStr := s.now().UTC().Format("2006-01-02T15:04:05.000Z")

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Puzzle{}, fmt.Errorf("begin daily insert tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO puzzles (id, game_id, kind, difficulty, seed, engine_version, clues, solution, techniques_required, created_at)
		VALUES (?, 'sudoku', 'daily', ?, ?, ?, ?, ?, ?, ?)
	`, rec.ID, string(rec.Difficulty), int64(rec.Seed), rec.EngineVersion, rec.Clues, rec.Solution, techJSON, nowStr); err != nil {
		return Puzzle{}, fmt.Errorf("insert daily puzzle record: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO daily_puzzles (puzzle_date, difficulty, puzzle_id, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (puzzle_date, difficulty) DO NOTHING
	`, dateYYYYMMDD, string(diff), rec.ID, nowStr); err != nil {
		return Puzzle{}, fmt.Errorf("insert daily_puzzles mapping: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return Puzzle{}, fmt.Errorf("commit daily insert tx: %w", err)
	}

	p, ok, err := s.lookupDaily(ctx, dateYYYYMMDD, diff)
	if err != nil {
		return Puzzle{}, err
	}
	if !ok {
		return Puzzle{}, ErrNotFound
	}
	return p, nil
}

func (s *Service) lookupDaily(ctx context.Context, dateYYYYMMDD string, diff sudoku.Difficulty) (Puzzle, bool, error) {
	var p Puzzle
	var seedInt int64
	var diffStr, techJSON string

	err := s.db.QueryRowContext(ctx, `
		SELECT p.id, p.seed, p.engine_version, p.difficulty, p.techniques_required, p.clues, p.solution
		FROM daily_puzzles dp
		JOIN puzzles p ON p.id = dp.puzzle_id
		WHERE dp.puzzle_date = ? AND dp.difficulty = ?
	`, dateYYYYMMDD, string(diff)).Scan(
		&p.ID, &seedInt, &p.EngineVersion, &diffStr, &techJSON, &p.Clues, &p.Solution,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Puzzle{}, false, nil
		}
		return Puzzle{}, false, fmt.Errorf("query daily puzzle: %w", err)
	}

	p.Seed = uint64(seedInt)
	p.Difficulty = sudoku.Difficulty(diffStr)
	techs, err := unmarshalTechniques(techJSON)
	if err != nil {
		return Puzzle{}, false, err
	}
	p.TechniquesRequired = techs
	return p, true, nil
}

// GetBank returns a cursor-paginated batch of bank puzzles for diff after afterSeq
// and signals an async pool refill if remaining puzzles fall below PoolLowWater.
func (s *Service) GetBank(ctx context.Context, diff sudoku.Difficulty, afterSeq int64, limit int) (BankPage, error) {
	if _, err := validateDifficulty(string(diff)); err != nil {
		return BankPage{}, err
	}
	if afterSeq < 0 {
		return BankPage{}, fmt.Errorf("%w: afterSeq must be >= 0", ErrInvalidInput)
	}
	if limit == 0 {
		limit = DefaultBankLimit
	} else if limit < 0 {
		return BankPage{}, fmt.Errorf("%w: limit must be positive", ErrInvalidInput)
	}
	if limit > MaxBankLimit {
		limit = MaxBankLimit
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT seq, id, seed, engine_version, difficulty, techniques_required, clues, solution
		FROM puzzles
		WHERE kind = 'bank' AND difficulty = ? AND seq > ?
		ORDER BY seq ASC
		LIMIT ?
	`, string(diff), afterSeq, limit+1)
	if err != nil {
		return BankPage{}, fmt.Errorf("query puzzle bank: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	items := make([]Puzzle, 0, limit)
	hasMore := false
	for rows.Next() {
		var p Puzzle
		var seedInt int64
		var diffStr, techJSON string
		if err := rows.Scan(&p.Seq, &p.ID, &seedInt, &p.EngineVersion, &diffStr, &techJSON, &p.Clues, &p.Solution); err != nil {
			return BankPage{}, fmt.Errorf("scan bank puzzle: %w", err)
		}
		if len(items) == limit {
			hasMore = true
			continue
		}
		p.Seed = uint64(seedInt)
		p.Difficulty = sudoku.Difficulty(diffStr)
		techs, err := unmarshalTechniques(techJSON)
		if err != nil {
			return BankPage{}, err
		}
		p.TechniquesRequired = techs
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return BankPage{}, fmt.Errorf("iterate bank puzzles: %w", err)
	}

	nextSeq := afterSeq
	if len(items) > 0 {
		nextSeq = items[len(items)-1].Seq
	}

	s.maybeTriggerLowWaterRefill(ctx, diff, nextSeq)

	return BankPage{
		EngineVersion: sudoku.EngineVersion,
		Difficulty:    diff,
		Puzzles:       items,
		NextSeq:       nextSeq,
		HasMore:       hasMore,
	}, nil
}

func (s *Service) maybeTriggerLowWaterRefill(ctx context.Context, diff sudoku.Difficulty, afterSeq int64) {
	var remaining, total int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM puzzles WHERE kind = 'bank' AND difficulty = ? AND seq > ?`,
		string(diff), afterSeq,
	).Scan(&remaining); err != nil {
		return
	}
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM puzzles WHERE kind = 'bank' AND difficulty = ?`,
		string(diff),
	).Scan(&total); err != nil {
		return
	}

	if remaining >= s.cfg.PoolLowWater || total >= s.cfg.PoolMaxTotal {
		return
	}

	needed := max(s.cfg.PoolTarget-remaining, 1)
	desired := min(s.cfg.PoolMaxTotal, max(s.cfg.PoolTarget, total+needed))

	s.mu.Lock()
	if desired > s.desiredTotal[diff] {
		s.desiredTotal[diff] = desired
	}
	s.mu.Unlock()

	select {
	case s.wakeCh <- struct{}{}:
	default:
	}
}

// GetByID fetches a single puzzle record by its canonical ID.
func (s *Service) GetByID(ctx context.Context, id string) (Puzzle, error) {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return Puzzle{}, fmt.Errorf("%w: puzzle id required", ErrInvalidInput)
	}

	var p Puzzle
	var seedInt int64
	var diffStr, techJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, seed, engine_version, difficulty, techniques_required, clues, solution
		FROM puzzles
		WHERE id = ?
	`, trimmed).Scan(&p.ID, &seedInt, &p.EngineVersion, &diffStr, &techJSON, &p.Clues, &p.Solution)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Puzzle{}, ErrNotFound
		}
		return Puzzle{}, fmt.Errorf("query puzzle by id: %w", err)
	}

	p.Seed = uint64(seedInt)
	p.Difficulty = sudoku.Difficulty(diffStr)
	techs, err := unmarshalTechniques(techJSON)
	if err != nil {
		return Puzzle{}, err
	}
	p.TechniquesRequired = techs
	return p, nil
}

func (s *Service) validateOnDemandDate(dateYYYYMMDD string) error {
	if len(dateYYYYMMDD) != len(dateLayout) {
		return fmt.Errorf("%w: invalid date %q (expected YYYY-MM-DD)", ErrInvalidInput, dateYYYYMMDD)
	}
	parsed, err := time.Parse(dateLayout, dateYYYYMMDD)
	if err != nil || parsed.Format(dateLayout) != dateYYYYMMDD {
		return fmt.Errorf("%w: invalid date %q (expected YYYY-MM-DD)", ErrInvalidInput, dateYYYYMMDD)
	}

	todayUTC := truncateUTCDate(s.now())
	minDate := todayUTC.AddDate(0, 0, -DailyPastDays)
	maxDate := todayUTC.AddDate(0, 0, DailyFutureDays)
	if parsed.Before(minDate) || parsed.After(maxDate) {
		return fmt.Errorf("%w: date %s outside [%s .. %s]", ErrDateOutOfRange, dateYYYYMMDD, minDate.Format(dateLayout), maxDate.Format(dateLayout))
	}
	return nil
}

func truncateUTCDate(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

func validateDifficulty(raw string) (sudoku.Difficulty, error) {
	diff := sudoku.Difficulty(strings.TrimSpace(raw))
	switch diff {
	case sudoku.DifficultyEasy, sudoku.DifficultyMedium, sudoku.DifficultyHard:
		return diff, nil
	default:
		return "", fmt.Errorf("%w: unsupported difficulty %q (expected easy, medium, or hard)", ErrInvalidInput, raw)
	}
}

func marshalTechniques(techs []sudoku.Technique) (string, error) {
	out := make([]string, 0, len(techs))
	for _, tech := range techs {
		out = append(out, string(tech))
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return "", fmt.Errorf("marshal techniques: %w", err)
	}
	return string(raw), nil
}

func unmarshalTechniques(raw string) ([]string, error) {
	var techs []string
	if err := json.Unmarshal([]byte(raw), &techs); err != nil {
		return nil, fmt.Errorf("unmarshal techniques: %w", err)
	}
	if techs == nil {
		techs = []string{}
	}
	return techs, nil
}
