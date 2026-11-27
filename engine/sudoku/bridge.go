package sudoku

import (
	"encoding/json"
	"fmt"
)

type boardRequest struct {
	Digits []uint8 `json:"digits"`
	Puzzle string  `json:"puzzle"`
}

type nextHintResponse struct {
	OK            bool      `json:"ok"`
	EngineVersion string    `json:"engineVersion"`
	Hint          *HintStep `json:"hint,omitempty"`
	Error         string    `json:"error,omitempty"`
}

type countSolutionsResponse struct {
	OK            bool   `json:"ok"`
	EngineVersion string `json:"engineVersion"`
	Solutions     int    `json:"solutions"`
	Unique        bool   `json:"unique"`
	Error         string `json:"error,omitempty"`
}

func parseBoardRequest(boardJSON string) (Board, error) {
	var req boardRequest
	if err := json.Unmarshal([]byte(boardJSON), &req); err != nil {
		return Board{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	if len(req.Digits) > 0 {
		if len(req.Digits) != BoardSize {
			return Board{}, fmt.Errorf("%w: expected %d digits, got %d", ErrInvalidInput, BoardSize, len(req.Digits))
		}
		var digits [BoardSize]uint8
		copy(digits[:], req.Digits)
		return NewBoardFromDigits(digits)
	}
	if req.Puzzle != "" {
		return ParseBoardString(req.Puzzle)
	}
	return Board{}, fmt.Errorf("%w: expected 'digits' array or 'puzzle' string", ErrInvalidInput)
}

func marshalString(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return `{"ok":false,"error":"internal json marshal error"}`
	}
	return string(raw)
}

// NextHintJSON evaluates the next logical hint for a JSON board payload and returns a JSON response.
func NextHintJSON(boardJSON string) string {
	b, err := parseBoardRequest(boardJSON)
	if err != nil {
		return marshalString(nextHintResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	hint, err := NextHint(b)
	if err != nil {
		return marshalString(nextHintResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	return marshalString(nextHintResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Hint:          &hint,
	})
}

// CountSolutionsJSON counts solutions (up to 2) for a JSON board payload and returns a JSON response.
func CountSolutionsJSON(boardJSON string) string {
	b, err := parseBoardRequest(boardJSON)
	if err != nil {
		return marshalString(countSolutionsResponse{
			OK:            false,
			EngineVersion: EngineVersion,
			Error:         err.Error(),
		})
	}
	count, err := CountSolutions(b, 2)
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
