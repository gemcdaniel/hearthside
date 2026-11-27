package sudoku

import (
	"fmt"
	"math/bits"
)

const (
	// TechniqueNakedSingle identifies a cell with only one legal candidate.
	TechniqueNakedSingle = "naked_single"
	// TechniqueHiddenSingle identifies a digit that can go in only one cell of a unit.
	TechniqueHiddenSingle = "hidden_single"
)

// Elimination records a candidate digit removed from a peer cell by a hint step.
type Elimination struct {
	Cell  int   `json:"cell"`
	Digit uint8 `json:"digit"`
}

// HintStep describes the next logical deduction on the current board.
type HintStep struct {
	Found        bool          `json:"found"`
	Technique    string        `json:"technique,omitempty"`
	Cell         int           `json:"cell"`
	Digit        uint8         `json:"digit"`
	Unit         string        `json:"unit,omitempty"`
	Eliminations []Elimination `json:"eliminations"`
}

func collectPeerEliminations(b *Board, cell int, digit uint8) []Elimination {
	mask := DigitMask(digit)
	elims := make([]Elimination, 0, 8)
	for _, peer := range Peers[cell] {
		if b.Cells[peer].Value == 0 && (b.Cells[peer].Candidates&mask) != 0 {
			elims = append(elims, Elimination{
				Cell:  peer,
				Digit: digit,
			})
		}
	}
	return elims
}

// NextHint finds the simplest next logical placement (naked single, then hidden single)
// evaluated against the current board state.
func NextHint(b Board) (HintStep, error) {
	if b.HasConflict() {
		return HintStep{Cell: -1, Eliminations: []Elimination{}}, fmt.Errorf("%w: board has conflicting digits", ErrInvalidBoard)
	}
	if b.IsSolved() {
		return HintStep{Found: false, Cell: -1, Eliminations: []Elimination{}}, nil
	}

	b.RecomputeCandidates()

	// 1. Naked singles: cell with exactly one candidate bit set.
	for i := range BoardSize {
		if b.Cells[i].Value != 0 {
			continue
		}
		mask := b.Cells[i].Candidates
		if bits.OnesCount16(mask) == 1 {
			digit := uint8(bits.TrailingZeros16(mask))
			return HintStep{
				Found:        true,
				Technique:    TechniqueNakedSingle,
				Cell:         i,
				Digit:        digit,
				Eliminations: collectPeerEliminations(&b, i, digit),
			}, nil
		}
	}

	// 2. Hidden singles: digit appearing as a candidate in exactly one empty cell of a unit.
	for unitIdx := range UnitCount {
		unit := Units[unitIdx]
		var placedMask uint16
		for _, cellIdx := range unit {
			if v := b.Cells[cellIdx].Value; v != 0 {
				placedMask |= DigitMask(v)
			}
		}

		for d := uint8(1); d <= GridSize; d++ {
			dMask := DigitMask(d)
			if (placedMask & dMask) != 0 {
				continue
			}

			matchCell := -1
			matchCount := 0
			for _, cellIdx := range unit {
				if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
					matchCell = cellIdx
					matchCount++
					if matchCount > 1 {
						break
					}
				}
			}

			if matchCount == 1 {
				return HintStep{
					Found:        true,
					Technique:    TechniqueHiddenSingle,
					Cell:         matchCell,
					Digit:        d,
					Unit:         UnitNames[unitIdx],
					Eliminations: collectPeerEliminations(&b, matchCell, d),
				}, nil
			}
		}
	}

	return HintStep{Found: false, Cell: -1, Eliminations: []Elimination{}}, nil
}

// SolveLogical iteratively applies NextHint steps until the board is solved or no naked/hidden single remains.
func SolveLogical(b Board) (Board, []HintStep, bool) {
	if b.HasConflict() {
		return b, nil, false
	}

	steps := make([]HintStep, 0, BoardSize)
	for !b.IsSolved() {
		step, err := NextHint(b)
		if err != nil || !step.Found {
			return b, steps, false
		}
		b.Cells[step.Cell].Value = step.Digit
		b.RecomputeCandidates()
		steps = append(steps, step)
	}
	return b, steps, true
}
