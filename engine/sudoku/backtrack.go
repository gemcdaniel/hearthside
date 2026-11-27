package sudoku

import (
	"fmt"
	"math/bits"
)

type dfsState struct {
	grid    [BoardSize]uint8
	rowMask [GridSize]uint16
	colMask [GridSize]uint16
	boxMask [GridSize]uint16
}

func newDFSState(b *Board) (dfsState, bool) {
	var st dfsState
	for i := range BoardSize {
		v := b.Cells[i].Value
		if v == 0 {
			continue
		}
		if v > GridSize {
			return dfsState{}, false
		}
		r := i / GridSize
		c := i % GridSize
		box := (r/BoxSize)*BoxSize + (c / BoxSize)
		mask := DigitMask(v)
		if (st.rowMask[r]&mask) != 0 || (st.colMask[c]&mask) != 0 || (st.boxMask[box]&mask) != 0 {
			return dfsState{}, false
		}
		st.grid[i] = v
		st.rowMask[r] |= mask
		st.colMask[c] |= mask
		st.boxMask[box] |= mask
	}
	return st, true
}

func (st *dfsState) count(limit int) int {
	bestCell := -1
	bestMask := uint16(0)
	bestCount := GridSize + 1

	for i := range BoardSize {
		if st.grid[i] != 0 {
			continue
		}
		r := i / GridSize
		c := i % GridSize
		box := (r/BoxSize)*BoxSize + (c / BoxSize)
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
		return 1
	}

	r := bestCell / GridSize
	c := bestCell % GridSize
	box := (r/BoxSize)*BoxSize + (c / BoxSize)
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
// using an MRV bitmask backtracking solver.
func CountSolutions(b Board, limit int) (int, error) {
	if limit <= 0 {
		limit = 2
	}
	for i := range BoardSize {
		if b.Cells[i].Value > GridSize {
			return 0, fmt.Errorf("%w: digit %d out of range", ErrInvalidBoard, b.Cells[i].Value)
		}
	}
	st, ok := newDFSState(&b)
	if !ok {
		return 0, nil
	}
	return st.count(limit), nil
}

// HasUniqueSolution reports whether the board has exactly one valid solution.
func HasUniqueSolution(b Board) bool {
	count, err := CountSolutions(b, 2)
	return err == nil && count == 1
}
