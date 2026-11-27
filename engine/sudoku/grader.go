package sudoku

import (
	"errors"
	"fmt"
)

var (
	// ErrUnsolvable indicates a board has zero valid solutions.
	ErrUnsolvable = errors.New("sudoku: puzzle has no solution")
	// ErrMultipleSolutions indicates a board has more than one valid solution.
	ErrMultipleSolutions = errors.New("sudoku: puzzle has multiple solutions")
	// ErrRequiresGuessing indicates a uniquely solvable board requires guessing beyond implemented techniques.
	ErrRequiresGuessing = errors.New("sudoku: puzzle requires guessing")
	// ErrGenerationFailed indicates the generator exceeded its bounded attempt budget for a target tier.
	ErrGenerationFailed = errors.New("sudoku: failed to generate puzzle matching target difficulty")
)

var canonicalTechniqueOrder = []Technique{
	TechniqueNakedSingle,
	TechniqueHiddenSingle,
	TechniquePointingLine,
	TechniqueBoxLineReduction,
	TechniqueNakedPair,
	TechniqueHiddenPair,
	TechniqueNakedTriple,
	TechniqueHiddenTriple,
	TechniqueSkyscraper,
	TechniqueXWing,
	TechniqueWWing,
	TechniqueXYWing,
	TechniqueSwordfish,
}

func difficultyRank(d Difficulty) int {
	switch d {
	case DifficultyEasy:
		return 1
	case DifficultyMedium:
		return 2
	case DifficultyHard:
		return 3
	default:
		return 0
	}
}

// GradeResult summarizes a puzzle's logical difficulty tier, required techniques, and solving trace.
type GradeResult struct {
	Difficulty         Difficulty  `json:"difficulty"`
	TechniquesRequired []Technique `json:"techniquesRequired"`
	StepCount          int         `json:"stepCount"`
	Steps              []Step      `json:"steps,omitempty"`
}

// Grade validates uniqueness, solves b purely through logical deductions without guessing,
// and returns the difficulty tier and deduplicated required techniques.
func Grade(b *Board) (GradeResult, error) {
	if b == nil {
		return GradeResult{}, fmt.Errorf("%w: nil board", ErrInvalidInput)
	}
	if err := b.Validate(); err != nil {
		return GradeResult{}, err
	}

	solutions, err := b.CountSolutions(2)
	if err != nil {
		return GradeResult{}, err
	}
	if solutions == 0 {
		return GradeResult{}, ErrUnsolvable
	}
	if solutions > 1 {
		return GradeResult{}, ErrMultipleSolutions
	}

	solved, steps := SolveLogical(b)
	if !solved {
		return GradeResult{}, ErrRequiresGuessing
	}

	highest := DifficultyEasy
	seen := make(map[Technique]bool, len(steps))
	for _, s := range steps {
		seen[s.Technique] = true
		if difficultyRank(s.Difficulty) > difficultyRank(highest) {
			highest = s.Difficulty
		}
	}

	techniques := make([]Technique, 0, len(seen))
	for _, tech := range canonicalTechniqueOrder {
		if seen[tech] {
			techniques = append(techniques, tech)
		}
	}

	return GradeResult{
		Difficulty:         highest,
		TechniquesRequired: techniques,
		StepCount:          len(steps),
		Steps:              steps,
	}, nil
}
