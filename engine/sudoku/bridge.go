package sudoku

import (
	"encoding/json"
	"fmt"
	"strings"
)

// HintStatus classifies the outcome of NextHintJSON for client UI handling.
type HintStatus string

const (
	// HintStatusOK indicates a logical next step was found.
	HintStatusOK HintStatus = "ok"
	// HintStatusConflict indicates the current board has conflicting peer placements.
	HintStatusConflict HintStatus = "conflict"
	// HintStatusWrongEntry indicates the board has no peer conflicts, but at least one entry disagrees with solution.
	HintStatusWrongEntry HintStatus = "wrong_entry"
	// HintStatusUnsolvable indicates the current board has zero valid solutions.
	HintStatusUnsolvable HintStatus = "unsolvable"
	// HintStatusSolved indicates all 81 cells are validly filled.
	HintStatusSolved HintStatus = "solved"
	// HintStatusNoLogicalStep indicates the board is valid and solvable, but requires guessing beyond implemented techniques.
	HintStatusNoLogicalStep HintStatus = "no_logical_step"
)

type boardRequest struct {
	Board  string  `json:"board"`
	Puzzle string  `json:"puzzle"`
	Clues  string  `json:"clues"`
	Digits []uint8 `json:"digits"`
}

type nextHintRequest struct {
	Board    string  `json:"board"`
	Puzzle   string  `json:"puzzle"`
	Clues    string  `json:"clues"`
	Digits   []uint8 `json:"digits"`
	Solution string  `json:"solution"`
}

type nextHintResponse struct {
	OK            bool       `json:"ok"`
	EngineVersion string     `json:"engineVersion"`
	Status        HintStatus `json:"status,omitempty"`
	ConflictCells []int      `json:"conflictCells,omitempty"`
	WrongCells    []int      `json:"wrongCells,omitempty"`
	Step          *Step      `json:"step,omitempty"`
	Error         string     `json:"error,omitempty"`
}

type nextStepResponse struct {
	OK            bool   `json:"ok"`
	EngineVersion string `json:"engineVersion"`
	Found         bool   `json:"found"`
	Step          *Step  `json:"step,omitempty"`
	Error         string `json:"error,omitempty"`
}

type countSolutionsResponse struct {
	OK            bool   `json:"ok"`
	EngineVersion string `json:"engineVersion"`
	Solutions     int    `json:"solutions"`
	Unique        bool   `json:"unique"`
	Error         string `json:"error,omitempty"`
}

type generatePuzzleRequest struct {
	Seed       uint64     `json:"seed"`
	Difficulty Difficulty `json:"difficulty"`
}

type generatePuzzleResponse struct {
	OK            bool          `json:"ok"`
	EngineVersion string        `json:"engineVersion"`
	Puzzle        *PuzzleRecord `json:"puzzle,omitempty"`
	Error         string        `json:"error,omitempty"`
}

type gradePuzzleResponse struct {
	OK            bool         `json:"ok"`
	EngineVersion string       `json:"engineVersion"`
	Grade         *GradeResult `json:"grade,omitempty"`
	Error         string       `json:"error,omitempty"`
}

func parseRawDigitsString(s string) ([BoardSize]uint8, error) {
	var digits [BoardSize]uint8
	trimmed := strings.TrimSpace(s)
	if len(trimmed) != BoardSize {
		return digits, fmt.Errorf("%w: expected %d chars, got %d", ErrInvalidInput, BoardSize, len(trimmed))
	}

	for i := range BoardSize {
		ch := trimmed[i]
		switch {
		case ch == '0' || ch == '.':
			digits[i] = 0
		case ch >= '1' && ch <= '9':
			digits[i] = ch - '0'
		default:
			return [BoardSize]uint8{}, fmt.Errorf("%w: invalid char %q at index %d", ErrInvalidInput, ch, i)
		}
	}
	return digits, nil
}

func parseRawBoardPayload(board, puzzle, clues string, digits []uint8) ([BoardSize]uint8, error) {
	if board != "" {
		return parseRawDigitsString(board)
	}
	if puzzle != "" {
		return parseRawDigitsString(puzzle)
	}
	if clues != "" {
		return parseRawDigitsString(clues)
	}
	if len(digits) > 0 {
		if len(digits) != BoardSize {
			return [BoardSize]uint8{}, fmt.Errorf("%w: expected %d digits, got %d", ErrInvalidInput, BoardSize, len(digits))
		}
		var out [BoardSize]uint8
		for i, d := range digits {
			if d > GridSize {
				return [BoardSize]uint8{}, fmt.Errorf("%w: digit %d out of range at cell %d", ErrInvalidInput, d, i)
			}
			out[i] = d
		}
		return out, nil
	}
	return [BoardSize]uint8{}, fmt.Errorf("%w: expected 'board', 'puzzle', 'clues', or 'digits'", ErrInvalidInput)
}

func parseBoardRequest(payloadJSON string) (Board, error) {
	var req boardRequest
	if err := json.Unmarshal([]byte(payloadJSON), &req); err != nil {
		return Board{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	digits, err := parseRawBoardPayload(req.Board, req.Puzzle, req.Clues, req.Digits)
	if err != nil {
		return Board{}, err
	}
	return NewBoardFromDigits(digits)
}

func normalizeStep(s Step) Step {
	if s.DrivingCells == nil {
		s.DrivingCells = []int{}
	}
	if s.Placements == nil {
		s.Placements = []Placement{}
	}
	if s.Eliminations == nil {
		s.Eliminations = []Elimination{}
	}
	return s
}

func marshalString(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return `{"ok":false,"error":"internal json marshal error"}`
	}
	return string(raw)
}

func findConflictCells(digits [BoardSize]uint8) []int {
	var conflicts []int
	for i := range BoardSize {
		v := digits[i]
		if v == 0 {
			continue
		}
		for _, peer := range Peers[i] {
			if digits[peer] == v {
				conflicts = append(conflicts, i)
				break
			}
		}
	}
	return conflicts
}

func findWrongCells(digits [BoardSize]uint8, solution Board) []int {
	var wrong []int
	for i := range BoardSize {
		v := digits[i]
		if v != 0 && v != solution.Cells[i].Value {
			wrong = append(wrong, i)
		}
	}
	return wrong
}

// NextStepJSON evaluates the next logical step for a JSON board payload and returns a JSON response.
func NextStepJSON(requestJSON string) string {
	b, err := parseBoardRequest(requestJSON)
	if err != nil {
		return marshalString(nextStepResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	step, found, err := NextStep(b)
	if err != nil {
		return marshalString(nextStepResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	if !found {
		return marshalString(nextStepResponse{
			OK:            true,
			EngineVersion: EngineVersion,
			Found:         false,
		})
	}
	normalized := normalizeStep(step)
	return marshalString(nextStepResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Found:         true,
		Step:          &normalized,
	})
}

// NextHintJSON inspects a board state (with optional solution string) and returns either
// conflict/wrong-entry diagnostics, solved/unsolvable status, or the full next logical Step.
func NextHintJSON(requestJSON string) string {
	var req nextHintRequest
	if err := json.Unmarshal([]byte(requestJSON), &req); err != nil {
		return marshalString(nextHintResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         fmt.Errorf("%w: %v", ErrInvalidInput, err).Error(),
		})
	}

	digits, err := parseRawBoardPayload(req.Board, req.Puzzle, req.Clues, req.Digits)
	if err != nil {
		return marshalString(nextHintResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}

	var solBoard Board
	hasSolution := req.Solution != ""
	if hasSolution {
		solBoard, err = ParseBoardString(req.Solution)
		if err != nil {
			return marshalString(nextHintResponse{
				OK:            false,
				EngineVersion: EngineVersion,
				Error:         fmt.Errorf("invalid solution: %w", err).Error(),
			})
		}
		if !solBoard.IsSolved() {
			return marshalString(nextHintResponse{
				OK:            false,
				EngineVersion: EngineVersion,
				Error:         fmt.Errorf("%w: solution must be a complete solved board", ErrInvalidInput).Error(),
			})
		}
	}

	if conflicts := findConflictCells(digits); len(conflicts) > 0 {
		return marshalString(nextHintResponse{
			OK:            true,
			EngineVersion: EngineVersion,
			Status:        HintStatusConflict,
			ConflictCells: conflicts,
		})
	}

	if hasSolution {
		if wrong := findWrongCells(digits, solBoard); len(wrong) > 0 {
			return marshalString(nextHintResponse{
				OK:            true,
				EngineVersion: EngineVersion,
				Status:        HintStatusWrongEntry,
				WrongCells:    wrong,
			})
		}
	}

	board, err := NewBoardFromDigits(digits)
	if err != nil {
		return marshalString(nextHintResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	if board.IsSolved() {
		return marshalString(nextHintResponse{
			OK:            true,
			EngineVersion: EngineVersion,
			Status:        HintStatusSolved,
		})
	}

	if !hasSolution {
		count, countErr := board.CountSolutions(1)
		if countErr != nil {
			return marshalString(nextHintResponse{
				OK:            false,
				EngineVersion: EngineVersion,
				Error:         countErr.Error(),
			})
		}
		if count == 0 {
			return marshalString(nextHintResponse{
				OK:            true,
				EngineVersion: EngineVersion,
				Status:        HintStatusUnsolvable,
			})
		}
	}

	step, found, err := NextStep(board)
	if err != nil {
		return marshalString(nextHintResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	if !found {
		return marshalString(nextHintResponse{
			OK:            true,
			EngineVersion: EngineVersion,
			Status:        HintStatusNoLogicalStep,
		})
	}

	normalized := normalizeStep(step)
	return marshalString(nextHintResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Status:        HintStatusOK,
		Step:          &normalized,
	})
}

// GeneratePuzzleJSON generates a deterministic PuzzleRecord for a JSON {seed, difficulty} payload.
func GeneratePuzzleJSON(requestJSON string) string {
	var req generatePuzzleRequest
	if err := json.Unmarshal([]byte(requestJSON), &req); err != nil {
		return marshalString(generatePuzzleResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         fmt.Errorf("%w: %v", ErrInvalidInput, err).Error(),
		})
	}

	rec, err := Generate(req.Seed, req.Difficulty)
	if err != nil {
		return marshalString(generatePuzzleResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	if rec.TechniquesRequired == nil {
		rec.TechniquesRequired = []Technique{}
	}

	return marshalString(generatePuzzleResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Puzzle:        &rec,
	})
}

// GradePuzzleJSON validates uniqueness and logically grades a JSON puzzle payload.
func GradePuzzleJSON(requestJSON string) string {
	b, err := parseBoardRequest(requestJSON)
	if err != nil {
		return marshalString(gradePuzzleResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}

	res, err := Grade(&b)
	if err != nil {
		return marshalString(gradePuzzleResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	if res.TechniquesRequired == nil {
		res.TechniquesRequired = []Technique{}
	}
	for i := range res.Steps {
		res.Steps[i] = normalizeStep(res.Steps[i])
	}

	return marshalString(gradePuzzleResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Grade:         &res,
	})
}

// CountSolutionsJSON counts solutions (up to 2) for a JSON board payload and returns a JSON response.
func CountSolutionsJSON(requestJSON string) string {
	b, err := parseBoardRequest(requestJSON)
	if err != nil {
		return marshalString(countSolutionsResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	count, err := b.CountSolutions(2)
	if err != nil {
		return marshalString(countSolutionsResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	return marshalString(countSolutionsResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Solutions:     count,
		Unique:        count == 1,
	})
}
