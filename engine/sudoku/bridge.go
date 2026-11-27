package sudoku

import (
	"encoding/json"
	"fmt"
)

type boardRequest struct {
	Digits []uint8 `json:"digits"`
	Puzzle string  `json:"puzzle"`
}

// HintSummary preserves the Phase 0 Spike A hint response shape while delegating to NextStep.
type HintSummary struct {
	Found        bool          `json:"found"`
	Technique    Technique     `json:"technique,omitempty"`
	Cell         int           `json:"cell"`
	Digit        uint8         `json:"digit"`
	Eliminations []Elimination `json:"eliminations"`
}

type nextHintResponse struct {
	OK            bool         `json:"ok"`
	EngineVersion string       `json:"engineVersion"`
	Hint          *HintSummary `json:"hint,omitempty"`
	Step          *Step        `json:"step,omitempty"`
	Error         string       `json:"error,omitempty"`
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

// NextStepJSON evaluates the next logical step for a JSON board payload and returns a JSON response.
func NextStepJSON(boardJSON string) string {
	b, err := parseBoardRequest(boardJSON)
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
	return marshalString(nextStepResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Found:         true,
		Step:          &step,
	})
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
	step, found, err := NextStep(b)
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
			Hint: &HintSummary{
				Found:        false,
				Cell:         -1,
				Eliminations: []Elimination{},
			},
		})
	}

	cell := -1
	digit := uint8(0)
	if len(step.Placements) > 0 {
		cell = step.Placements[0].Cell
		digit = step.Placements[0].Digit
	} else if len(step.DrivingCells) > 0 {
		cell = step.DrivingCells[0]
	}

	return marshalString(nextHintResponse{
		OK:            true,
		EngineVersion: EngineVersion,
		Hint: &HintSummary{
			Found:        true,
			Technique:    step.Technique,
			Cell:         cell,
			Digit:        digit,
			Eliminations: step.Eliminations,
		},
		Step: &step,
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
