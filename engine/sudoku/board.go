package sudoku

import (
	"errors"
	"fmt"
	"strings"
)

const (
	// GridSize is the width and height of a standard Sudoku grid.
	GridSize = 9
	// BoxSize is the width and height of a 3x3 Sudoku box.
	BoxSize = 3
	// BoardSize is the total number of cells in a 9x9 Sudoku board.
	BoardSize = GridSize * GridSize
	// AllCandidates is the 9-bit mask containing digits 1 through 9 (bits 1<<1 through 1<<9).
	AllCandidates uint16 = 0x3FE
	// UnitCount is the total number of Sudoku units (9 rows + 9 columns + 9 boxes).
	UnitCount = 27
)

var (
	// ErrInvalidBoard indicates a board with out-of-range digits or conflicting placements.
	ErrInvalidBoard = errors.New("sudoku: invalid board")
	// ErrInvalidInput indicates malformed input payload or board length.
	ErrInvalidInput = errors.New("sudoku: invalid input")
)

// Peers holds the 20 unique peer indices (same row, column, or 3x3 box) for each cell.
var Peers [BoardSize][20]int

// Units holds the 9 cell indices for each of the 27 units (rows 0-8, cols 9-17, boxes 18-26).
var Units [UnitCount][GridSize]int

// UnitNames holds human-readable names for each unit index in Units.
var UnitNames [UnitCount]string

func init() {
	for r := range GridSize {
		UnitNames[r] = fmt.Sprintf("row %d", r+1)
		UnitNames[GridSize+r] = fmt.Sprintf("column %d", r+1)
		UnitNames[2*GridSize+r] = fmt.Sprintf("box %d", r+1)
		for c := range GridSize {
			Units[r][c] = r*GridSize + c
			Units[GridSize+c][r] = r*GridSize + c
			boxIdx := (r/BoxSize)*BoxSize + (c / BoxSize)
			boxPos := (r%BoxSize)*BoxSize + (c % BoxSize)
			Units[2*GridSize+boxIdx][boxPos] = r*GridSize + c
		}
	}

	for idx := range BoardSize {
		r := idx / GridSize
		c := idx % GridSize
		boxRow := (r / BoxSize) * BoxSize
		boxCol := (c / BoxSize) * BoxSize

		var seen [BoardSize]bool
		seen[idx] = true
		n := 0

		for col := range GridSize {
			peer := r*GridSize + col
			if !seen[peer] {
				seen[peer] = true
				Peers[idx][n] = peer
				n++
			}
		}
		for row := range GridSize {
			peer := row*GridSize + c
			if !seen[peer] {
				seen[peer] = true
				Peers[idx][n] = peer
				n++
			}
		}
		for br := range BoxSize {
			for bc := range BoxSize {
				peer := (boxRow+br)*GridSize + (boxCol + bc)
				if !seen[peer] {
					seen[peer] = true
					Peers[idx][n] = peer
					n++
				}
			}
		}
	}
}

// DigitMask returns the 9-bit candidate mask for a digit 1..9, or 0 otherwise.
func DigitMask(d uint8) uint16 {
	if d < 1 || d > GridSize {
		return 0
	}
	return uint16(1) << d
}

// Cell represents one square on a Sudoku board.
type Cell struct {
	Value      uint8
	Given      bool
	Candidates uint16
}

// Board represents an 81-cell Sudoku board with 9-bit candidate masks.
type Board struct {
	Cells [BoardSize]Cell
}

// NewBoardFromDigits builds a Board from 81 digits (0 for empty, 1..9 for filled)
// and rejects boards containing out-of-range digits or duplicate peer placements.
func NewBoardFromDigits(digits [BoardSize]uint8) (Board, error) {
	var b Board
	for i, d := range digits {
		if d > GridSize {
			return Board{}, fmt.Errorf("%w: digit %d at cell %d", ErrInvalidBoard, d, i)
		}
		b.Cells[i] = Cell{
			Value: d,
			Given: d != 0,
		}
	}
	if b.HasConflict() {
		return Board{}, fmt.Errorf("%w: conflicting peer digits", ErrInvalidBoard)
	}
	b.RecomputeCandidates()
	return b, nil
}

// ParseBoardString parses an 81-character Sudoku string ('0' or '.' for empty, '1'-'9' for digits).
func ParseBoardString(s string) (Board, error) {
	trimmed := strings.TrimSpace(s)
	if len(trimmed) != BoardSize {
		return Board{}, fmt.Errorf("%w: expected %d chars, got %d", ErrInvalidInput, BoardSize, len(trimmed))
	}

	var digits [BoardSize]uint8
	for i := range BoardSize {
		ch := trimmed[i]
		switch {
		case ch == '0' || ch == '.':
			digits[i] = 0
		case ch >= '1' && ch <= '9':
			digits[i] = ch - '0'
		default:
			return Board{}, fmt.Errorf("%w: invalid char %q at index %d", ErrInvalidInput, ch, i)
		}
	}
	return NewBoardFromDigits(digits)
}

// RecomputeCandidates refreshes the 9-bit candidate mask for every cell from current placements.
func (b *Board) RecomputeCandidates() {
	for i := range BoardSize {
		if b.Cells[i].Value != 0 {
			b.Cells[i].Candidates = 0
			continue
		}
		mask := AllCandidates
		for _, peer := range Peers[i] {
			if pv := b.Cells[peer].Value; pv != 0 {
				mask &^= DigitMask(pv)
			}
		}
		b.Cells[i].Candidates = mask
	}
}

// HasConflict reports whether any non-zero cell shares its digit with a peer or holds an invalid digit.
func (b *Board) HasConflict() bool {
	for i := range BoardSize {
		v := b.Cells[i].Value
		if v == 0 {
			continue
		}
		if v > GridSize {
			return true
		}
		for _, peer := range Peers[i] {
			if b.Cells[peer].Value == v {
				return true
			}
		}
	}
	return false
}

// IsSolved reports whether all 81 cells are filled without conflicts.
func (b *Board) IsSolved() bool {
	if b.HasConflict() {
		return false
	}
	for i := range BoardSize {
		if b.Cells[i].Value == 0 {
			return false
		}
	}
	return true
}

// Digits returns a copy of the 81 cell values.
func (b *Board) Digits() [BoardSize]uint8 {
	var out [BoardSize]uint8
	for i := range BoardSize {
		out[i] = b.Cells[i].Value
	}
	return out
}
