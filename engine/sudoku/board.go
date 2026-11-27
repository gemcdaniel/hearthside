package sudoku

import (
	"errors"
	"fmt"
	"math/bits"
	"slices"
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
	// ErrInvalidInput indicates malformed input payload, cell index, digit, or string length.
	ErrInvalidInput = errors.New("sudoku: invalid input")
)

// RowOf maps each cell index 0..80 to its row index 0..8.
var RowOf [BoardSize]int

// ColOf maps each cell index 0..80 to its column index 0..8.
var ColOf [BoardSize]int

// BoxOf maps each cell index 0..80 to its 3x3 box index 0..8.
var BoxOf [BoardSize]int

// Rows holds the 9 cell indices for each row 0..8.
var Rows [GridSize][GridSize]int

// Cols holds the 9 cell indices for each column 0..8.
var Cols [GridSize][GridSize]int

// Boxes holds the 9 cell indices for each 3x3 box 0..8.
var Boxes [GridSize][GridSize]int

// Peers holds the 20 unique peer indices (same row, column, or 3x3 box) for each cell, sorted ascending.
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
			idx := r*GridSize + c
			boxIdx := (r/BoxSize)*BoxSize + (c / BoxSize)
			boxPos := (r%BoxSize)*BoxSize + (c % BoxSize)

			RowOf[idx] = r
			ColOf[idx] = c
			BoxOf[idx] = boxIdx

			Rows[r][c] = idx
			Cols[c][r] = idx
			Boxes[boxIdx][boxPos] = idx

			Units[r][c] = idx
			Units[GridSize+c][r] = idx
			Units[2*GridSize+boxIdx][boxPos] = idx
		}
	}

	for idx := range BoardSize {
		r := RowOf[idx]
		c := ColOf[idx]
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
		slices.Sort(Peers[idx][:])
	}
}

// DigitMask returns the 9-bit candidate mask for a digit 1..9, or 0 otherwise.
func DigitMask(d uint8) uint16 {
	if d < 1 || d > GridSize {
		return 0
	}
	return uint16(1) << d
}

// CandidateCount returns the number of active candidate digits in mask (1..9).
func CandidateCount(mask uint16) int {
	return bits.OnesCount16(mask & AllCandidates)
}

// FirstCandidate returns the lowest active candidate digit (1..9) in mask, or 0 if empty.
func FirstCandidate(mask uint16) uint8 {
	m := mask & AllCandidates
	if m == 0 {
		return 0
	}
	return uint8(bits.TrailingZeros16(m))
}

// CandidateDigits returns the active candidate digits in ascending order.
func CandidateDigits(mask uint16) []uint8 {
	m := mask & AllCandidates
	digits := make([]uint8, 0, bits.OnesCount16(m))
	for m != 0 {
		lsb := m & -m
		m &^= lsb
		digits = append(digits, uint8(bits.TrailingZeros16(lsb)))
	}
	return digits
}

// HasCandidate reports whether digit d (1..9) is enabled in mask.
func HasCandidate(mask uint16, d uint8) bool {
	return (mask & DigitMask(d)) != 0
}

// ArePeers reports whether two distinct cell indices share a row, column, or 3x3 box.
func ArePeers(a, b int) bool {
	if a < 0 || a >= BoardSize || b < 0 || b >= BoardSize || a == b {
		return false
	}
	return RowOf[a] == RowOf[b] || ColOf[a] == ColOf[b] || BoxOf[a] == BoxOf[b]
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
	if err := b.Validate(); err != nil {
		return Board{}, err
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

// String serializes the board into its canonical 81-character representation using '0' for empty cells.
func (b Board) String() string {
	var buf [BoardSize]byte
	for i := range BoardSize {
		v := b.Cells[i].Value
		if v >= 1 && v <= GridSize {
			buf[i] = '0' + v
		} else {
			buf[i] = '0'
		}
	}
	return string(buf[:])
}

// DotString serializes the board into an 81-character string using '.' for empty cells.
func (b Board) DotString() string {
	var buf [BoardSize]byte
	for i := range BoardSize {
		v := b.Cells[i].Value
		if v >= 1 && v <= GridSize {
			buf[i] = '0' + v
		} else {
			buf[i] = '.'
		}
	}
	return string(buf[:])
}

// Validate checks that all digits are in 0..9 and no two peers hold the same non-zero digit.
func (b *Board) Validate() error {
	for i := range BoardSize {
		v := b.Cells[i].Value
		if v == 0 {
			continue
		}
		if v > GridSize {
			return fmt.Errorf("%w: digit %d out of range at cell %d", ErrInvalidBoard, v, i)
		}
		for _, peer := range Peers[i] {
			if b.Cells[peer].Value == v {
				return fmt.Errorf("%w: conflicting digit %d at cells %d and %d", ErrInvalidBoard, v, i, peer)
			}
		}
	}
	return nil
}

// HasConflict reports whether any non-zero cell shares its digit with a peer or holds an invalid digit.
func (b *Board) HasConflict() bool {
	return b.Validate() != nil
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

// stripPeerCandidates removes candidate bits invalidated by placed peers without restoring prior eliminations.
func (b *Board) stripPeerCandidates() {
	for i := range BoardSize {
		if b.Cells[i].Value != 0 {
			b.Cells[i].Candidates = 0
			continue
		}
		for _, peer := range Peers[i] {
			if pv := b.Cells[peer].Value; pv != 0 {
				b.Cells[i].Candidates &^= DigitMask(pv)
			}
		}
	}
}

// Place writes digit 1..9 into an empty cell and clears that digit from all peer candidate masks.
func (b *Board) Place(cell int, digit uint8) error {
	if cell < 0 || cell >= BoardSize {
		return fmt.Errorf("%w: cell index %d out of range", ErrInvalidInput, cell)
	}
	if digit < 1 || digit > GridSize {
		return fmt.Errorf("%w: digit %d out of range", ErrInvalidInput, digit)
	}
	if b.Cells[cell].Value != 0 {
		return fmt.Errorf("%w: cell %d is already filled", ErrInvalidBoard, cell)
	}
	for _, peer := range Peers[cell] {
		if b.Cells[peer].Value == digit {
			return fmt.Errorf("%w: placing %d at cell %d conflicts with peer %d", ErrInvalidBoard, digit, cell, peer)
		}
	}

	b.Cells[cell].Value = digit
	b.Cells[cell].Candidates = 0
	mask := DigitMask(digit)
	for _, peer := range Peers[cell] {
		b.Cells[peer].Candidates &^= mask
	}
	return nil
}

// Eliminate removes digit (1..9) from cell's candidate mask and reports whether it was present.
func (b *Board) Eliminate(cell int, digit uint8) bool {
	if cell < 0 || cell >= BoardSize || digit < 1 || digit > GridSize {
		return false
	}
	if b.Cells[cell].Value != 0 {
		return false
	}
	mask := DigitMask(digit)
	if (b.Cells[cell].Candidates & mask) == 0 {
		return false
	}
	b.Cells[cell].Candidates &^= mask
	return true
}
