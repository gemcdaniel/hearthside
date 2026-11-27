// Command genbank generates and verifies deterministic Sudoku puzzle banks.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
)

const (
	// BankSchemaVersion identifies the JSON format version emitted by genbank.
	BankSchemaVersion = 1
	defaultOutPath    = "games/sudoku/src/data/starter-bank.json"
)

// BankCounts records the puzzle counts per difficulty tier inside a PuzzleBank.
type BankCounts struct {
	Easy   int `json:"easy"`
	Medium int `json:"medium"`
	Hard   int `json:"hard"`
}

// PuzzleBank is the top-level JSON structure serialized by genbank.
type PuzzleBank struct {
	SchemaVersion int                   `json:"schemaVersion"`
	EngineVersion string                `json:"engineVersion"`
	SeedStart     uint64                `json:"seedStart"`
	Counts        BankCounts            `json:"counts"`
	Puzzles       []sudoku.PuzzleRecord `json:"puzzles"`
}

type genJob struct {
	index      int
	seed       uint64
	difficulty sudoku.Difficulty
}

type tierStats struct {
	count      int
	minClues   int
	maxClues   int
	totalClues int
	techCounts map[sudoku.Technique]int
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "genbank error: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("genbank", flag.ContinueOnError)
	fs.SetOutput(stderr)

	easyCount := fs.Int("easy", 50, "number of easy puzzles to generate")
	mediumCount := fs.Int("medium", 50, "number of medium puzzles to generate")
	hardCount := fs.Int("hard", 50, "number of hard puzzles to generate")
	seedStart := fs.Uint64("seed-start", 1, "starting deterministic seed per difficulty tier")
	outPath := fs.String("out", defaultOutPath, "output JSON path")
	verifyPath := fs.String("verify", "", "verify an existing puzzle bank JSON file and exit")

	if err := fs.Parse(args); err != nil {
		return err
	}

	if *verifyPath != "" {
		return runVerify(*verifyPath, stdout)
	}
	return runGenerate(*easyCount, *mediumCount, *hardCount, *seedStart, *outPath, stdout)
}

func runGenerate(easyCount, mediumCount, hardCount int, seedStart uint64, outPath string, stdout io.Writer) error {
	if easyCount < 0 || mediumCount < 0 || hardCount < 0 {
		return errors.New("difficulty counts must be non-negative")
	}
	total := easyCount + mediumCount + hardCount
	if total == 0 {
		return errors.New("at least one puzzle must be requested")
	}
	if strings.TrimSpace(outPath) == "" {
		return errors.New("output path must not be empty")
	}

	start := time.Now()
	jobs := buildJobs(easyCount, mediumCount, hardCount, seedStart)
	puzzles, err := executeJobs(jobs)
	if err != nil {
		return err
	}

	bank := PuzzleBank{
		SchemaVersion: BankSchemaVersion,
		EngineVersion: sudoku.Version(),
		SeedStart:     seedStart,
		Counts: BankCounts{
			Easy:   easyCount,
			Medium: mediumCount,
			Hard:   hardCount,
		},
		Puzzles: puzzles,
	}

	encoded, err := json.MarshalIndent(bank, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal puzzle bank: %w", err)
	}
	encoded = append(encoded, '\n')

	dir := filepath.Dir(outPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create output directory %q: %w", dir, err)
		}
	}
	if err := os.WriteFile(outPath, encoded, 0o644); err != nil {
		return fmt.Errorf("write output file %q: %w", outPath, err)
	}

	elapsed := time.Since(start)
	printSummary(stdout, "Generated", outPath, bank, elapsed)
	return nil
}

func buildJobs(easyCount, mediumCount, hardCount int, seedStart uint64) []genJob {
	total := easyCount + mediumCount + hardCount
	jobs := make([]genJob, 0, total)
	tiers := []struct {
		diff  sudoku.Difficulty
		count int
	}{
		{diff: sudoku.DifficultyEasy, count: easyCount},
		{diff: sudoku.DifficultyMedium, count: mediumCount},
		{diff: sudoku.DifficultyHard, count: hardCount},
	}

	idx := 0
	for _, tier := range tiers {
		for offset := range tier.count {
			jobs = append(jobs, genJob{
				index:      idx,
				seed:       seedStart + uint64(offset),
				difficulty: tier.diff,
			})
			idx++
		}
	}
	return jobs
}

func executeJobs(jobs []genJob) ([]sudoku.PuzzleRecord, error) {
	puzzles := make([]sudoku.PuzzleRecord, len(jobs))
	workers := min(max(runtime.GOMAXPROCS(0), 1), len(jobs))

	jobCh := make(chan genJob)
	var wg sync.WaitGroup
	var errOnce sync.Once
	var firstErr error

	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobCh {
				rec, err := sudoku.Generate(job.seed, job.difficulty)
				if err != nil {
					errOnce.Do(func() {
						firstErr = fmt.Errorf("generate %s puzzle (seed=%d): %w", job.difficulty, job.seed, err)
					})
					continue
				}
				puzzles[job.index] = rec
			}
		}()
	}

	for _, job := range jobs {
		jobCh <- job
	}
	close(jobCh)
	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}
	return puzzles, nil
}

func runVerify(path string, stdout io.Writer) error {
	start := time.Now()
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read bank %q: %w", path, err)
	}

	var bank PuzzleBank
	if err := json.Unmarshal(raw, &bank); err != nil {
		return fmt.Errorf("parse bank JSON %q: %w", path, err)
	}
	if bank.SchemaVersion <= 0 {
		return fmt.Errorf("invalid schemaVersion %d", bank.SchemaVersion)
	}
	if len(bank.Puzzles) == 0 {
		return errors.New("puzzle bank contains zero puzzles")
	}

	var actualCounts BankCounts
	seenIDs := make(map[string]int, len(bank.Puzzles))
	for i, rec := range bank.Puzzles {
		if err := verifyRecord(i, rec, seenIDs); err != nil {
			return err
		}
		switch rec.Difficulty {
		case sudoku.DifficultyEasy:
			actualCounts.Easy++
		case sudoku.DifficultyMedium:
			actualCounts.Medium++
		case sudoku.DifficultyHard:
			actualCounts.Hard++
		}
	}

	if actualCounts != bank.Counts {
		return fmt.Errorf("bank counts metadata %+v does not match puzzles %+v", bank.Counts, actualCounts)
	}

	elapsed := time.Since(start)
	printSummary(stdout, "Verified", path, bank, elapsed)
	return nil
}

func verifyRecord(idx int, rec sudoku.PuzzleRecord, seenIDs map[string]int) error {
	if strings.TrimSpace(rec.ID) == "" {
		return fmt.Errorf("puzzle[%d]: empty id", idx)
	}
	if prevIdx, dup := seenIDs[rec.ID]; dup {
		return fmt.Errorf("puzzle[%d] (%s): duplicate id already seen at puzzle[%d]", idx, rec.ID, prevIdx)
	}
	seenIDs[rec.ID] = idx

	clueBoard, err := sudoku.ParseBoardString(rec.Clues)
	if err != nil {
		return fmt.Errorf("puzzle[%d] (%s): invalid clues: %w", idx, rec.ID, err)
	}
	solBoard, err := sudoku.ParseBoardString(rec.Solution)
	if err != nil {
		return fmt.Errorf("puzzle[%d] (%s): invalid solution: %w", idx, rec.ID, err)
	}
	if !solBoard.IsSolved() {
		return fmt.Errorf("puzzle[%d] (%s): solution is incomplete or invalid", idx, rec.ID)
	}
	for cell := range sudoku.BoardSize {
		cv := clueBoard.Cells[cell].Value
		if cv != 0 && cv != solBoard.Cells[cell].Value {
			return fmt.Errorf("puzzle[%d] (%s): clue at cell %d (%d) conflicts with solution (%d)",
				idx, rec.ID, cell, cv, solBoard.Cells[cell].Value)
		}
	}

	count, err := clueBoard.CountSolutions(2)
	if err != nil {
		return fmt.Errorf("puzzle[%d] (%s): CountSolutions error: %w", idx, rec.ID, err)
	}
	if count != 1 {
		return fmt.Errorf("puzzle[%d] (%s): expected unique solution (1), got %d", idx, rec.ID, count)
	}

	solved, ok, err := clueBoard.SolveBacktrack()
	if err != nil || !ok {
		return fmt.Errorf("puzzle[%d] (%s): SolveBacktrack failed (ok=%v): %v", idx, rec.ID, ok, err)
	}
	if solved.String() != solBoard.String() {
		return fmt.Errorf("puzzle[%d] (%s): stored solution disagrees with solved board", idx, rec.ID)
	}

	grade, err := sudoku.Grade(&clueBoard)
	if err != nil {
		return fmt.Errorf("puzzle[%d] (%s): logical grading failed: %w", idx, rec.ID, err)
	}
	if grade.Difficulty != rec.Difficulty {
		return fmt.Errorf("puzzle[%d] (%s): difficulty mismatch (recorded=%q, graded=%q)",
			idx, rec.ID, rec.Difficulty, grade.Difficulty)
	}
	if !slices.Equal(grade.TechniquesRequired, rec.TechniquesRequired) {
		return fmt.Errorf("puzzle[%d] (%s): techniquesRequired mismatch (recorded=%v, graded=%v)",
			idx, rec.ID, rec.TechniquesRequired, grade.TechniquesRequired)
	}
	return nil
}

func countClues(clues string) int {
	n := 0
	for i := range len(clues) {
		if clues[i] >= '1' && clues[i] <= '9' {
			n++
		}
	}
	return n
}

func printSummary(w io.Writer, action, path string, bank PuzzleBank, elapsed time.Duration) {
	tiers := []sudoku.Difficulty{sudoku.DifficultyEasy, sudoku.DifficultyMedium, sudoku.DifficultyHard}
	statsByTier := make(map[sudoku.Difficulty]*tierStats, len(tiers))
	for _, tier := range tiers {
		statsByTier[tier] = &tierStats{
			minClues:   sudoku.BoardSize + 1,
			techCounts: make(map[sudoku.Technique]int),
		}
	}

	for _, rec := range bank.Puzzles {
		st, ok := statsByTier[rec.Difficulty]
		if !ok {
			continue
		}
		clues := countClues(rec.Clues)
		st.count++
		st.totalClues += clues
		if clues < st.minClues {
			st.minClues = clues
		}
		if clues > st.maxClues {
			st.maxClues = clues
		}
		for _, tech := range rec.TechniquesRequired {
			st.techCounts[tech]++
		}
	}

	_, _ = fmt.Fprintf(w, "%s puzzle bank: %s\n", action, path)
	_, _ = fmt.Fprintf(w, "Schema: v%d | Engine: %s | Seed start: %d | Total: %d puzzles | Elapsed: %s\n\n",
		bank.SchemaVersion, bank.EngineVersion, bank.SeedStart, len(bank.Puzzles), elapsed.Round(time.Millisecond))

	_, _ = fmt.Fprintf(w, "Clue Counts by Difficulty:\n")
	_, _ = fmt.Fprintf(w, "%-8s  %5s  %5s  %6s  %5s\n", "Tier", "Count", "Min", "Avg", "Max")
	for _, tier := range tiers {
		st := statsByTier[tier]
		if st.count == 0 {
			_, _ = fmt.Fprintf(w, "%-8s  %5d  %5s  %6s  %5s\n", tier, 0, "-", "-", "-")
			continue
		}
		avg := float64(st.totalClues) / float64(st.count)
		_, _ = fmt.Fprintf(w, "%-8s  %5d  %5d  %6.2f  %5d\n", tier, st.count, st.minClues, avg, st.maxClues)
	}

	techniques := sudoku.AllTechniques()
	_, _ = fmt.Fprintf(w, "\nTechnique Frequency Distribution (puzzles requiring each technique):\n")
	for _, tier := range tiers {
		st := statsByTier[tier]
		if st.count == 0 {
			continue
		}
		_, _ = fmt.Fprintf(w, "  %s (%d puzzles):\n", tier, st.count)
		for _, tech := range techniques {
			cnt := st.techCounts[tech]
			if cnt == 0 {
				continue
			}
			pct := 100.0 * float64(cnt) / float64(st.count)
			_, _ = fmt.Fprintf(w, "    %-20s %3d (%5.1f%%)\n", tech, cnt, pct)
		}
	}
}
