package sudoku

import (
	"fmt"
	"math/bits"
)

// Difficulty represents the puzzle tier determined by the hardest technique required.
type Difficulty string

const (
	// DifficultyEasy covers naked and hidden singles.
	DifficultyEasy Difficulty = "easy"
	// DifficultyMedium adds pointing lines, box-line reductions, and naked/hidden pairs and triples.
	DifficultyMedium Difficulty = "medium"
	// DifficultyHard adds advanced patterns such as X-Wing, Swordfish, and XY-Wing.
	DifficultyHard Difficulty = "hard"
)

// Technique identifies a specific human Sudoku solving deduction.
type Technique string

const (
	// TechniqueNakedSingle identifies a cell with only one remaining candidate.
	TechniqueNakedSingle Technique = "naked_single"
	// TechniqueHiddenSingle identifies a digit with only one remaining cell in a unit.
	TechniqueHiddenSingle Technique = "hidden_single"
	// TechniquePointingLine identifies candidates in a box confined to a single row or column.
	TechniquePointingLine Technique = "pointing_line"
	// TechniqueBoxLineReduction identifies candidates in a row or column confined to a single box.
	TechniqueBoxLineReduction Technique = "box_line_reduction"
	// TechniqueNakedPair identifies two cells in a unit sharing the exact same two candidates.
	TechniqueNakedPair Technique = "naked_pair"
	// TechniqueHiddenPair identifies two digits in a unit restricted to the exact same two cells.
	TechniqueHiddenPair Technique = "hidden_pair"
	// TechniqueNakedTriple identifies three cells in a unit whose candidate union has size three.
	TechniqueNakedTriple Technique = "naked_triple"
	// TechniqueHiddenTriple identifies three digits in a unit restricted to three cells total.
	TechniqueHiddenTriple Technique = "hidden_triple"
	// TechniqueSkyscraper identifies two parallel lines sharing one base column/row for a digit.
	TechniqueSkyscraper Technique = "skyscraper"
	// TechniqueXWing identifies two parallel lines sharing the exact same two candidate columns/rows for a digit.
	TechniqueXWing Technique = "x_wing"
	// TechniqueWWing identifies two identical bivalue cells connected by a strong link on one digit.
	TechniqueWWing Technique = "w_wing"
	// TechniqueXYWing identifies a bivalue pivot linked to two bivalue pincers sharing a common elimination digit.
	TechniqueXYWing Technique = "xy_wing"
	// TechniqueSwordfish identifies three parallel lines whose candidates for a digit span only three orthogonal lines.
	TechniqueSwordfish Technique = "swordfish"
)

// Difficulty returns the difficulty tier for this technique.
func (t Technique) Difficulty() Difficulty {
	switch t {
	case TechniqueNakedSingle, TechniqueHiddenSingle:
		return DifficultyEasy
	case TechniquePointingLine,
		TechniqueBoxLineReduction,
		TechniqueNakedPair,
		TechniqueHiddenPair,
		TechniqueNakedTriple,
		TechniqueHiddenTriple:
		return DifficultyMedium
	default:
		return DifficultyHard
	}
}

// RegionKind identifies the board region driving a deduction.
type RegionKind string

const (
	// RegionCell targets an individual cell (0..80).
	RegionCell RegionKind = "cell"
	// RegionRow targets a row (0..8).
	RegionRow RegionKind = "row"
	// RegionColumn targets a column (0..8).
	RegionColumn RegionKind = "column"
	// RegionBox targets a 3x3 box (0..8).
	RegionBox RegionKind = "box"
)

// Region describes the primary board region associated with a step.
type Region struct {
	Kind  RegionKind `json:"kind"`
	Index int        `json:"index"`
}

// Placement records a digit placement produced by a deduction step.
type Placement struct {
	Cell  int   `json:"cell"`
	Digit uint8 `json:"digit"`
}

// Elimination records a candidate digit removed from a cell by a deduction step.
type Elimination struct {
	Cell  int   `json:"cell"`
	Digit uint8 `json:"digit"`
}

// Step records one logical solving deduction with full trace data for grading and 4-tier UI hints.
type Step struct {
	Technique    Technique     `json:"technique"`
	Difficulty   Difficulty    `json:"difficulty"`
	Region       Region        `json:"region"`
	DrivingCells []int         `json:"drivingCells"`
	Placements   []Placement   `json:"placements"`
	Eliminations []Elimination `json:"eliminations"`
}

func unitRegion(unitIdx int) Region {
	switch {
	case unitIdx < GridSize:
		return Region{Kind: RegionRow, Index: unitIdx}
	case unitIdx < 2*GridSize:
		return Region{Kind: RegionColumn, Index: unitIdx - GridSize}
	default:
		return Region{Kind: RegionBox, Index: unitIdx - 2*GridSize}
	}
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

func findNakedSingle(b *Board) (Step, bool) {
	for i := range BoardSize {
		if b.Cells[i].Value != 0 {
			continue
		}
		mask := b.Cells[i].Candidates & AllCandidates
		if CandidateCount(mask) == 1 {
			digit := FirstCandidate(mask)
			return Step{
				Technique:    TechniqueNakedSingle,
				Difficulty:   DifficultyEasy,
				Region:       Region{Kind: RegionCell, Index: i},
				DrivingCells: []int{i},
				Placements:   []Placement{{Cell: i, Digit: digit}},
				Eliminations: collectPeerEliminations(b, i, digit),
			}, true
		}
	}
	return Step{}, false
}

func findHiddenSingle(b *Board) (Step, bool) {
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
				return Step{
					Technique:    TechniqueHiddenSingle,
					Difficulty:   DifficultyEasy,
					Region:       unitRegion(unitIdx),
					DrivingCells: []int{matchCell},
					Placements:   []Placement{{Cell: matchCell, Digit: d}},
					Eliminations: collectPeerEliminations(b, matchCell, d),
				}, true
			}
		}
	}
	return Step{}, false
}

func findPointingLine(b *Board) (Step, bool) {
	var cells [BoxSize]int
	for box := range GridSize {
		for d := uint8(1); d <= GridSize; d++ {
			dMask := DigitMask(d)
			n := 0
			for _, cellIdx := range Boxes[box] {
				if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
					if n < BoxSize {
						cells[n] = cellIdx
					}
					n++
				}
			}
			if n < 2 || n > BoxSize {
				continue
			}

			sameRow := true
			sameCol := true
			baseRow := RowOf[cells[0]]
			baseCol := ColOf[cells[0]]
			for i := 1; i < n; i++ {
				if RowOf[cells[i]] != baseRow {
					sameRow = false
				}
				if ColOf[cells[i]] != baseCol {
					sameCol = false
				}
			}

			if sameRow {
				var elims []Elimination
				for _, cellIdx := range Rows[baseRow] {
					if BoxOf[cellIdx] != box && b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
						elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
					}
				}
				if len(elims) > 0 {
					driving := make([]int, n)
					copy(driving, cells[:n])
					return Step{
						Technique:    TechniquePointingLine,
						Difficulty:   DifficultyMedium,
						Region:       Region{Kind: RegionBox, Index: box},
						DrivingCells: driving,
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}

			if sameCol {
				var elims []Elimination
				for _, cellIdx := range Cols[baseCol] {
					if BoxOf[cellIdx] != box && b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
						elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
					}
				}
				if len(elims) > 0 {
					driving := make([]int, n)
					copy(driving, cells[:n])
					return Step{
						Technique:    TechniquePointingLine,
						Difficulty:   DifficultyMedium,
						Region:       Region{Kind: RegionBox, Index: box},
						DrivingCells: driving,
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func findBoxLineReduction(b *Board) (Step, bool) {
	var cells [BoxSize]int
	for lineUnit := range 2 * GridSize {
		line := Units[lineUnit]
		region := unitRegion(lineUnit)
		for d := uint8(1); d <= GridSize; d++ {
			dMask := DigitMask(d)
			n := 0
			for _, cellIdx := range line {
				if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
					if n < BoxSize {
						cells[n] = cellIdx
					}
					n++
				}
			}
			if n < 2 || n > BoxSize {
				continue
			}

			box := BoxOf[cells[0]]
			sameBox := true
			for i := 1; i < n; i++ {
				if BoxOf[cells[i]] != box {
					sameBox = false
					break
				}
			}
			if !sameBox {
				continue
			}

			var elims []Elimination
			for _, cellIdx := range Boxes[box] {
				inLine := (region.Kind == RegionRow && RowOf[cellIdx] == region.Index) ||
					(region.Kind == RegionColumn && ColOf[cellIdx] == region.Index)
				if !inLine && b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
					elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
				}
			}
			if len(elims) > 0 {
				driving := make([]int, n)
				copy(driving, cells[:n])
				return Step{
					Technique:    TechniqueBoxLineReduction,
					Difficulty:   DifficultyMedium,
					Region:       region,
					DrivingCells: driving,
					Placements:   []Placement{},
					Eliminations: elims,
				}, true
			}
		}
	}
	return Step{}, false
}

func collectUnitEliminations(b *Board, unit [GridSize]int, excludedMask uint16, targetDigits uint16) []Elimination {
	var elims []Elimination
	for pos, cellIdx := range unit {
		if (excludedMask&(uint16(1)<<pos)) != 0 || b.Cells[cellIdx].Value != 0 {
			continue
		}
		overlap := b.Cells[cellIdx].Candidates & targetDigits
		if overlap == 0 {
			continue
		}
		for _, d := range CandidateDigits(overlap) {
			elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
		}
	}
	return elims
}

func collectSubsetCellEliminations(b *Board, cells []int, allowedDigits uint16) []Elimination {
	var elims []Elimination
	for _, cellIdx := range cells {
		extra := b.Cells[cellIdx].Candidates & AllCandidates &^ allowedDigits
		if extra == 0 {
			continue
		}
		for _, d := range CandidateDigits(extra) {
			elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
		}
	}
	return elims
}

func findNakedPair(b *Board) (Step, bool) {
	for unitIdx := range UnitCount {
		unit := Units[unitIdx]
		var pairPos [GridSize]int
		n := 0
		for pos, cellIdx := range unit {
			if b.Cells[cellIdx].Value == 0 && CandidateCount(b.Cells[cellIdx].Candidates) == 2 {
				pairPos[n] = pos
				n++
			}
		}
		for i := range n {
			p1 := pairPos[i]
			c1 := unit[p1]
			mask := b.Cells[c1].Candidates & AllCandidates
			for j := i + 1; j < n; j++ {
				p2 := pairPos[j]
				c2 := unit[p2]
				if (b.Cells[c2].Candidates & AllCandidates) != mask {
					continue
				}
				excluded := (uint16(1) << p1) | (uint16(1) << p2)
				elims := collectUnitEliminations(b, unit, excluded, mask)
				if len(elims) > 0 {
					return Step{
						Technique:    TechniqueNakedPair,
						Difficulty:   DifficultyMedium,
						Region:       unitRegion(unitIdx),
						DrivingCells: []int{c1, c2},
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func findHiddenPair(b *Board) (Step, bool) {
	for unitIdx := range UnitCount {
		unit := Units[unitIdx]
		var posMask [GridSize + 1]uint16
		for pos, cellIdx := range unit {
			if b.Cells[cellIdx].Value != 0 {
				continue
			}
			for _, d := range CandidateDigits(b.Cells[cellIdx].Candidates) {
				posMask[d] |= uint16(1) << pos
			}
		}

		for d1 := uint8(1); d1 <= GridSize; d1++ {
			if bits.OnesCount16(posMask[d1]) != 2 {
				continue
			}
			for d2 := d1 + 1; d2 <= GridSize; d2++ {
				if posMask[d2] != posMask[d1] {
					continue
				}
				p1 := bits.TrailingZeros16(posMask[d1])
				p2 := bits.TrailingZeros16(posMask[d1] &^ (uint16(1) << p1))
				driving := []int{unit[p1], unit[p2]}
				allowed := DigitMask(d1) | DigitMask(d2)
				elims := collectSubsetCellEliminations(b, driving, allowed)
				if len(elims) > 0 {
					return Step{
						Technique:    TechniqueHiddenPair,
						Difficulty:   DifficultyMedium,
						Region:       unitRegion(unitIdx),
						DrivingCells: driving,
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func findNakedTriple(b *Board) (Step, bool) {
	for unitIdx := range UnitCount {
		unit := Units[unitIdx]
		var candPos [GridSize]int
		n := 0
		for pos, cellIdx := range unit {
			if b.Cells[cellIdx].Value != 0 {
				continue
			}
			cnt := CandidateCount(b.Cells[cellIdx].Candidates)
			if cnt == 2 || cnt == 3 {
				candPos[n] = pos
				n++
			}
		}
		for i := range n {
			p1 := candPos[i]
			m1 := b.Cells[unit[p1]].Candidates & AllCandidates
			for j := i + 1; j < n; j++ {
				p2 := candPos[j]
				m12 := m1 | (b.Cells[unit[p2]].Candidates & AllCandidates)
				if CandidateCount(m12) > 3 {
					continue
				}
				for k := j + 1; k < n; k++ {
					p3 := candPos[k]
					union := m12 | (b.Cells[unit[p3]].Candidates & AllCandidates)
					if CandidateCount(union) != 3 {
						continue
					}
					excluded := (uint16(1) << p1) | (uint16(1) << p2) | (uint16(1) << p3)
					elims := collectUnitEliminations(b, unit, excluded, union)
					if len(elims) > 0 {
						return Step{
							Technique:    TechniqueNakedTriple,
							Difficulty:   DifficultyMedium,
							Region:       unitRegion(unitIdx),
							DrivingCells: []int{unit[p1], unit[p2], unit[p3]},
							Placements:   []Placement{},
							Eliminations: elims,
						}, true
					}
				}
			}
		}
	}
	return Step{}, false
}

func findHiddenTriple(b *Board) (Step, bool) {
	for unitIdx := range UnitCount {
		unit := Units[unitIdx]
		var posMask [GridSize + 1]uint16
		for pos, cellIdx := range unit {
			if b.Cells[cellIdx].Value != 0 {
				continue
			}
			for _, d := range CandidateDigits(b.Cells[cellIdx].Candidates) {
				posMask[d] |= uint16(1) << pos
			}
		}

		var digits [GridSize]uint8
		n := 0
		for d := uint8(1); d <= GridSize; d++ {
			cnt := bits.OnesCount16(posMask[d])
			if cnt == 2 || cnt == 3 {
				digits[n] = d
				n++
			}
		}

		for i := range n {
			d1 := digits[i]
			for j := i + 1; j < n; j++ {
				d2 := digits[j]
				pos12 := posMask[d1] | posMask[d2]
				if bits.OnesCount16(pos12) > 3 {
					continue
				}
				for k := j + 1; k < n; k++ {
					d3 := digits[k]
					posUnion := pos12 | posMask[d3]
					if bits.OnesCount16(posUnion) != 3 {
						continue
					}

					var driving []int
					tmp := posUnion
					for tmp != 0 {
						lsb := tmp & -tmp
						tmp &^= lsb
						pos := bits.TrailingZeros16(lsb)
						driving = append(driving, unit[pos])
					}
					allowed := DigitMask(d1) | DigitMask(d2) | DigitMask(d3)
					elims := collectSubsetCellEliminations(b, driving, allowed)
					if len(elims) > 0 {
						return Step{
							Technique:    TechniqueHiddenTriple,
							Difficulty:   DifficultyMedium,
							Region:       unitRegion(unitIdx),
							DrivingCells: driving,
							Placements:   []Placement{},
							Eliminations: elims,
						}, true
					}
				}
			}
		}
	}
	return Step{}, false
}

type stepFinder func(b *Board) (Step, bool)

var stepFinders = []stepFinder{
	findNakedSingle,
	findHiddenSingle,
	findPointingLine,
	findBoxLineReduction,
	findNakedPair,
	findHiddenPair,
	findNakedTriple,
	findHiddenTriple,
	findSkyscraper,
	findXWing,
	findWWing,
	findXYWing,
	findSwordfish,
}

// NextStep evaluates Easy, Medium, and Hard techniques in ascending priority order on the current board
// and returns the first applicable step, or (Step{}, false, nil) if none apply.
func NextStep(b Board) (Step, bool, error) {
	if err := b.Validate(); err != nil {
		return Step{}, false, err
	}
	if b.IsSolved() {
		return Step{}, false, nil
	}

	b.stripPeerCandidates()

	for _, find := range stepFinders {
		if step, ok := find(&b); ok {
			return step, true, nil
		}
	}

	return Step{}, false, nil
}

// ApplyStep mutates the board by applying all placements and eliminations in step.
func (b *Board) ApplyStep(step Step) error {
	for _, p := range step.Placements {
		if err := b.Place(p.Cell, p.Digit); err != nil {
			return fmt.Errorf("apply step %s: %w", step.Technique, err)
		}
	}
	for _, e := range step.Eliminations {
		b.Eliminate(e.Cell, e.Digit)
	}
	return nil
}

// SolveLogical repeatedly calls NextStep on a working copy of b, applies only the returned
// placements and eliminations without consulting any backtracking solution, and stops when
// the board is solved or no logical step applies.
func SolveLogical(b *Board) (solved bool, steps []Step) {
	if b == nil || b.Validate() != nil {
		return false, nil
	}

	work := *b
	work.RecomputeCandidates()
	steps = make([]Step, 0, BoardSize)
	for !work.IsSolved() {
		step, ok, err := NextStep(work)
		if err != nil || !ok {
			return false, steps
		}
		if err := work.ApplyStep(step); err != nil {
			return false, steps
		}
		steps = append(steps, step)
	}
	return true, steps
}
