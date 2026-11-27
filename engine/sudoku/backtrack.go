package sudoku

import (
	"fmt"
	"math/bits"
)

type dfsState struct {
	grid     [BoardSize]uint8
	solution [BoardSize]uint8
	rowMask  [GridSize]uint16
	colMask  [GridSize]uint16
	boxMask  [GridSize]uint16
}

func newDFSState(b *Board) (dfsState, error) {
	var st dfsState
	for i := range BoardSize {
		v := b.Cells[i].Value
		if v == 0 {
			continue
		}
		if v > GridSize {
			return dfsState{}, fmt.Errorf("%w: digit %d out of range at cell %d", ErrInvalidBoard, v, i)
		}
		r := RowOf[i]
		c := ColOf[i]
		box := BoxOf[i]
		mask := DigitMask(v)
		if (st.rowMask[r]&mask) != 0 || (st.colMask[c]&mask) != 0 || (st.boxMask[box]&mask) != 0 {
			return dfsState{}, fmt.Errorf("%w: conflicting digit %d at cell %d", ErrInvalidBoard, v, i)
		}
		st.grid[i] = v
		st.rowMask[r] |= mask
		st.colMask[c] |= mask
		st.boxMask[box] |= mask
	}
	return st, nil
}

func (st *dfsState) count(limit int) int {
	bestCell := -1
	bestMask := uint16(0)
	bestCount := GridSize + 1

	for i := range BoardSize {
		if st.grid[i] != 0 {
			continue
		}
		r := RowOf[i]
		c := ColOf[i]
		box := BoxOf[i]
		avail := AllCandidates &^ (st.rowMask[r] | st.colMask[c] | st.boxMask[box])
		cnt := bits.OnesCount16(avail)
		if cnt == 0 {
			return 0
		}
		if cnt < bestCount {
			bestCount = cnt
			bestCell = i
			bestMask = avail
			if cnt == 1 {
				break
			}
		}
	}

	if bestCell == -1 {
		st.solution = st.grid
		return 1
	}

	r := RowOf[bestCell]
	c := ColOf[bestCell]
	box := BoxOf[bestCell]
	total := 0

	for bestMask != 0 {
		lsb := bestMask & -bestMask
		bestMask &^= lsb
		digit := uint8(bits.TrailingZeros16(lsb))

		st.grid[bestCell] = digit
		st.rowMask[r] |= lsb
		st.colMask[c] |= lsb
		st.boxMask[box] |= lsb

		total += st.count(limit - total)

		st.grid[bestCell] = 0
		st.rowMask[r] &^= lsb
		st.colMask[c] &^= lsb
		st.boxMask[box] &^= lsb

		if total >= limit {
			return total
		}
	}

	return total
}

// CountSolutions counts valid solutions up to limit (defaulting to 2 when limit <= 0)
// using an MRV bitmask backtracking solver. Conflicting boards return 0 solutions with nil error.
func (b Board) CountSolutions(limit int) (int, error) {
	if limit <= 0 {
		limit = 2
	}
	for i := range BoardSize {
		if b.Cells[i].Value > GridSize {
			return 0, fmt.Errorf("%w: digit %d out of range", ErrInvalidBoard, b.Cells[i].Value)
		}
	}
	st, err := newDFSState(&b)
	if err != nil {
		return 0, nil
	}
	return st.count(limit), nil
}

// CountSolutions counts valid solutions on board up to limit (defaulting to 2 when limit <= 0).
func CountSolutions(b Board, limit int) (int, error) {
	return b.CountSolutions(limit)
}

// HasUniqueSolution reports whether the board has exactly one valid solution.
func (b Board) HasUniqueSolution() bool {
	count, err := b.CountSolutions(2)
	return err == nil && count == 1
}

// HasUniqueSolution reports whether board has exactly one valid solution.
func HasUniqueSolution(b Board) bool {
	return b.HasUniqueSolution()
}

// SolveBacktrack returns the solved board and true when a unique solution exists.
// It returns (Board{}, false, nil) when 0 or >1 solutions exist.
func (b Board) SolveBacktrack() (Board, bool, error) {
	for i := range BoardSize {
		if b.Cells[i].Value > GridSize {
			return Board{}, false, fmt.Errorf("%w: digit %d out of range", ErrInvalidBoard, b.Cells[i].Value)
		}
	}
	st, err := newDFSState(&b)
	if err != nil {
		return Board{}, false, nil
	}
	if st.count(2) != 1 {
		return Board{}, false, nil
	}
	solved := b
	for i := range BoardSize {
		solved.Cells[i].Value = st.solution[i]
		solved.Cells[i].Candidates = 0
	}
	return solved, true, nil
}

// SolveBacktrack returns the unique solution for board when one exists.
func SolveBacktrack(b Board) (Board, bool, error) {
	return b.SolveBacktrack()
}
